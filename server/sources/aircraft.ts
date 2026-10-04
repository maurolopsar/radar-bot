// Aeronaves en tiempo real a partir de agregadores ADS-B/MLAT gratuitos
// (adsb.lol, airplanes.live, adsb.fi) y OpenSky Network como respaldo.
//
// - Zona alrededor del usuario: se consultan todos los proveedores a la vez y
//   se usa el primero que responde.
// - Flota DGT en toda España: se combinan búsquedas por matrícula, por tipo de
//   aeronave y barridos de toda España, en todos los proveedores, porque cada
//   uno ve aeronaves distintas según sus receptores.

import {
  DEFAULT_DGT_MATCHER,
  DGT_TYPES,
  fromOpenSky,
  fromReadsb,
  type DgtMatcher,
  type OpenSkyState,
  type ReadsbAircraft,
} from '../../shared/aircraft';
import { bboxAround, distanceM, kmToNm } from '../../shared/geo';
import type { Aircraft, AircraftResponse } from '../../shared/types';
import { errorMessage, fetchJson, fetchText } from '../lib/http';

interface ReadsbResponse {
  ac?: ReadsbAircraft[];
  aircraft?: ReadsbAircraft[];
}

interface Provider {
  name: string;
  point: (lat: number, lon: number, nm: number) => string;
  reg?: (regs: string[]) => string;
  type?: (type: string) => string;
  /** Intervalo mínimo entre peticiones (ms), por los límites de cada servicio. */
  spacing: number;
}

const PROVIDERS: Provider[] = [
  {
    name: 'adsb.lol',
    point: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nm}`,
    reg: (regs) => `https://api.adsb.lol/v2/reg/${regs.join(',')}`,
    type: (t) => `https://api.adsb.lol/v2/type/${t}`,
    spacing: 300,
  },
  {
    name: 'airplanes.live',
    point: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nm}`,
    reg: (regs) => `https://api.airplanes.live/v2/reg/${regs.join(',')}`,
    type: (t) => `https://api.airplanes.live/v2/type/${t}`,
    spacing: 1100,
  },
  {
    name: 'adsb.fi',
    point: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${nm}`,
    reg: (regs) => `https://opendata.adsb.fi/api/v2/registration/${regs.join(',')}`,
    type: (t) => `https://opendata.adsb.fi/api/v2/type/${t}`,
    spacing: 1100,
  },
];

const enabled = (): Provider[] => {
  const only = process.env.AIRCRAFT_PROVIDERS?.split(',').map((s) => s.trim().toLowerCase());
  return only?.length ? PROVIDERS.filter((p) => only.includes(p.name)) : PROVIDERS;
};

// Cola por proveedor para respetar sus límites de peticiones por segundo.
const queues = new Map<string, Promise<unknown>>();
function throttled<T>(p: Provider, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(p.name) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(async () => {
    try {
      return await fn();
    } finally {
      await new Promise((r) => setTimeout(r, p.spacing));
    }
  });
  queues.set(p.name, run);
  return run;
}

const list = (r: ReadsbResponse) => r.ac ?? r.aircraft ?? [];

/** Estado de la última consulta a cada proveedor (para el diagnóstico). */
export const providerStatus = new Map<string, { ok: boolean; at: string; ms: number; count?: number; error?: string }>();

async function readsb(p: Provider, url: string, timeoutMs = 8000): Promise<ReadsbAircraft[]> {
  const t0 = Date.now();
  try {
    const data = await throttled(p, () => fetchJson<ReadsbResponse>(url, { timeoutMs }));
    const ac = list(data);
    providerStatus.set(p.name, { ok: true, at: new Date().toISOString(), ms: Date.now() - t0, count: ac.length });
    return ac;
  } catch (err) {
    providerStatus.set(p.name, { ok: false, at: new Date().toISOString(), ms: Date.now() - t0, error: errorMessage(err) });
    throw new Error(`${p.name}: ${errorMessage(err)}`);
  }
}

// ---------------------------------------------------------------------------
// OpenSky (anónimo con cuota pequeña, u OAuth2 con OPENSKY_CLIENT_ID/SECRET)

let openskyToken: { value: string; exp: number } | null = null;

async function openskyHeaders(): Promise<Record<string, string>> {
  const id = process.env.OPENSKY_CLIENT_ID;
  const secret = process.env.OPENSKY_CLIENT_SECRET;
  if (!id || !secret) return {};
  if (!openskyToken || openskyToken.exp < Date.now() + 60_000) {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret });
    const txt = await fetchText('https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token', {
      method: 'POST',
      body,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeoutMs: 10_000,
    });
    const tok = JSON.parse(txt) as { access_token: string; expires_in: number };
    openskyToken = { value: tok.access_token, exp: Date.now() + tok.expires_in * 1000 };
  }
  return { Authorization: `Bearer ${openskyToken.value}` };
}

async function openSkyArea(b: { south: number; west: number; north: number; east: number }, m: DgtMatcher): Promise<Aircraft[]> {
  const url =
    `https://opensky-network.org/api/states/all?lamin=${b.south.toFixed(3)}&lomin=${b.west.toFixed(3)}` +
    `&lamax=${b.north.toFixed(3)}&lomax=${b.east.toFixed(3)}&extended=1`;
  const t0 = Date.now();
  try {
    const data = await fetchJson<{ time: number; states: OpenSkyState[] | null }>(url, { timeoutMs: 12_000, headers: await openskyHeaders() });
    const out = (data.states ?? []).map((s) => fromOpenSky(s, data.time, m)).filter((a): a is Aircraft => !!a);
    providerStatus.set('opensky', { ok: true, at: new Date().toISOString(), ms: Date.now() - t0, count: out.length });
    return out;
  } catch (err) {
    providerStatus.set('opensky', { ok: false, at: new Date().toISOString(), ms: Date.now() - t0, error: errorMessage(err) });
    throw new Error(`opensky: ${errorMessage(err)}`);
  }
}

// ---------------------------------------------------------------------------

/** Todas las aeronaves en un radio (km): todos los proveedores a la vez, gana el primero. */
export async function aircraftNear(lat: number, lon: number, radiusKm: number, m: DgtMatcher = DEFAULT_DGT_MATCHER): Promise<AircraftResponse> {
  const nm = Math.max(1, Math.min(250, Math.ceil(kmToNm(radiusKm))));
  const within = (a: Aircraft) => distanceM(lat, lon, a.lat, a.lon) <= radiusKm * 1000;
  const attempts = enabled().map((p) =>
    readsb(p, p.point(lat, lon, nm), 7000).then((ac) => ({
      provider: p.name,
      aircraft: ac.map((x) => fromReadsb(x, p.name, m)).filter((a): a is Aircraft => !!a && within(a)),
    })),
  );
  try {
    const first = await Promise.any(attempts);
    return { ...first, fetchedAt: new Date().toISOString() };
  } catch (agg) {
    const errors = (agg as AggregateError).errors?.map(errorMessage) ?? [errorMessage(agg)];
    try {
      const aircraft = (await openSkyArea(bboxAround(lat, lon, radiusKm * 1000), m)).filter(within);
      return { aircraft, provider: 'opensky', fetchedAt: new Date().toISOString() };
    } catch (err) {
      errors.push(errorMessage(err));
    }
    return { aircraft: [], provider: 'none', fetchedAt: new Date().toISOString(), error: errors.join(' · ') };
  }
}

/** Círculos (lat, lon, millas náuticas) que cubren España, Baleares y Canarias. */
const SPAIN_SCAN: [number, number, number][] = [
  [40.3, -4.2, 250],
  [41.3, 0.8, 200],
  [37.4, -4.5, 160],
  [28.4, -15.8, 200],
];

const SPAIN_BOXES = [
  { south: 35.0, west: -10.5, north: 44.5, east: 5.0 },
  { south: 27.3, west: -18.5, north: 29.6, east: -13.0 },
];
const inSpain = (a: Aircraft) => SPAIN_BOXES.some((b) => a.lat >= b.south && a.lat <= b.north && a.lon >= b.west && a.lon <= b.east);

/**
 * Flota de la DGT en vuelo en toda España. Combina, en todos los proveedores:
 * búsqueda por matrículas, por tipos (AS355, EC135, EC120) y un barrido de
 * España completa filtrando por matrícula, operador o indicativo.
 */
export async function dgtFleet(m: DgtMatcher = DEFAULT_DGT_MATCHER): Promise<AircraftResponse> {
  const found = new Map<string, Aircraft>();
  const ok = new Set<string>();
  const errors: string[] = [];
  const add = (p: Provider, ac: ReadsbAircraft[]) => {
    ok.add(p.name);
    for (const x of ac) {
      const a = fromReadsb(x, p.name, m);
      if (!a || !a.isDgt || !inSpain(a)) continue;
      const prev = found.get(a.hex);
      if (!prev || (a.seenPosS ?? 99) < (prev.seenPosS ?? 99)) found.set(a.hex, a);
    }
  };
  await Promise.all(
    enabled().map(async (p) => {
      const urls = [
        ...(p.reg ? [p.reg(m.registrations)] : []),
        ...(p.type ? DGT_TYPES.map((t) => p.type!(t)) : []),
        ...SPAIN_SCAN.map(([lat, lon, nm]) => p.point(lat, lon, nm)),
      ];
      for (const url of urls) {
        try {
          add(p, await readsb(p, url, 15_000));
        } catch (err) {
          errors.push(errorMessage(err));
        }
      }
    }),
  );
  if (m.hexes.length && (process.env.OPENSKY_CLIENT_ID || !ok.size)) {
    try {
      for (const b of SPAIN_BOXES) for (const a of await openSkyArea(b, m)) if (a.isDgt) found.set(a.hex, a);
      ok.add('opensky');
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }
  return {
    aircraft: [...found.values()],
    provider: ok.size ? [...ok].join(' + ') : 'none',
    fetchedAt: new Date().toISOString(),
    error: ok.size ? undefined : [...new Set(errors)].slice(0, 6).join(' · '),
  };
}
