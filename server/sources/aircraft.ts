// Aeronaves en tiempo real a partir de agregadores ADS-B/MLAT gratuitos.
// Orden de preferencia: adsb.lol -> airplanes.live -> adsb.fi -> OpenSky Network.

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
import { errorMessage, fetchJson } from '../lib/http';

interface ReadsbResponse {
  ac?: ReadsbAircraft[];
  aircraft?: ReadsbAircraft[];
}

interface Provider {
  name: string;
  point?: (lat: number, lon: number, nm: number) => string;
  reg?: (regs: string[]) => string;
  type?: (types: string[]) => string;
}

const READSB_PROVIDERS: Provider[] = [
  {
    name: 'adsb.lol',
    point: (lat, lon, nm) => `https://api.adsb.lol/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nm}`,
    reg: (regs) => `https://api.adsb.lol/v2/reg/${regs.join(',')}`,
    type: (types) => `https://api.adsb.lol/v2/type/${types.join(',')}`,
  },
  {
    name: 'airplanes.live',
    point: (lat, lon, nm) => `https://api.airplanes.live/v2/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${nm}`,
    reg: (regs) => `https://api.airplanes.live/v2/reg/${regs.join(',')}`,
    type: (types) => `https://api.airplanes.live/v2/type/${types.join(',')}`,
  },
  {
    name: 'adsb.fi',
    point: (lat, lon, nm) => `https://opendata.adsb.fi/api/v2/lat/${lat.toFixed(4)}/lon/${lon.toFixed(4)}/dist/${nm}`,
    reg: (regs) => `https://opendata.adsb.fi/api/v2/registration/${regs.join(',')}`,
  },
];

const list = (r: ReadsbResponse) => r.ac ?? r.aircraft ?? [];

async function openSkyArea(lat: number, lon: number, radiusKm: number, m: DgtMatcher): Promise<Aircraft[]> {
  const b = bboxAround(lat, lon, radiusKm * 1000);
  const url =
    `https://opensky-network.org/api/states/all?lamin=${b.south.toFixed(3)}&lomin=${b.west.toFixed(3)}` +
    `&lamax=${b.north.toFixed(3)}&lomax=${b.east.toFixed(3)}&extended=1`;
  const data = await fetchJson<{ time: number; states: OpenSkyState[] | null }>(url, { timeoutMs: 15_000 });
  return (data.states ?? []).map((s) => fromOpenSky(s, data.time, m)).filter((a): a is Aircraft => !!a);
}

/** Todas las aeronaves en un radio (km) alrededor de un punto. */
export async function aircraftNear(lat: number, lon: number, radiusKm: number, m: DgtMatcher = DEFAULT_DGT_MATCHER): Promise<AircraftResponse> {
  const nm = Math.max(1, Math.min(250, Math.ceil(kmToNm(radiusKm))));
  const errors: string[] = [];
  for (const p of READSB_PROVIDERS) {
    if (!p.point) continue;
    try {
      const data = await fetchJson<ReadsbResponse>(p.point(lat, lon, nm), { timeoutMs: 12_000 });
      const aircraft = list(data)
        .map((ac) => fromReadsb(ac, p.name, m))
        .filter((a): a is Aircraft => !!a && distanceM(lat, lon, a.lat, a.lon) <= radiusKm * 1000);
      return { aircraft, provider: p.name, fetchedAt: new Date().toISOString() };
    } catch (err) {
      errors.push(`${p.name}: ${errorMessage(err)}`);
    }
  }
  try {
    const aircraft = (await openSkyArea(lat, lon, radiusKm, m)).filter((a) => distanceM(lat, lon, a.lat, a.lon) <= radiusKm * 1000);
    return { aircraft, provider: 'opensky', fetchedAt: new Date().toISOString() };
  } catch (err) {
    errors.push(`opensky: ${errorMessage(err)}`);
  }
  return { aircraft: [], provider: 'none', fetchedAt: new Date().toISOString(), error: errors.join(' · ') };
}

/** Caja de España (península, Baleares, Canarias, Ceuta y Melilla) con margen. */
const SPAIN = [
  { south: 35.0, west: -10.5, north: 44.5, east: 5.0 },
  { south: 27.3, west: -18.5, north: 29.6, east: -13.0 },
];

const inSpain = (a: Aircraft) => SPAIN.some((b) => a.lat >= b.south && a.lat <= b.north && a.lon >= b.west && a.lon <= b.east);

/**
 * Flota de la DGT en vuelo en toda España: búsqueda por matrícula y, como
 * respaldo, por tipo de aeronave filtrando las que encajan con la DGT.
 */
export async function dgtFleet(m: DgtMatcher = DEFAULT_DGT_MATCHER): Promise<AircraftResponse> {
  const errors: string[] = [];
  const found = new Map<string, Aircraft>();
  let provider = 'none';
  for (const p of READSB_PROVIDERS) {
    const urls = [p.reg?.(m.registrations), p.type?.(DGT_TYPES)].filter((u): u is string => !!u);
    let ok = false;
    for (const url of urls) {
      try {
        const data = await fetchJson<ReadsbResponse>(url, { timeoutMs: 15_000 });
        ok = true;
        for (const ac of list(data)) {
          const a = fromReadsb(ac, p.name, m);
          if (a && a.isDgt && inSpain(a)) found.set(a.hex, a);
        }
      } catch (err) {
        errors.push(`${p.name}: ${errorMessage(err)}`);
      }
    }
    if (ok) {
      provider = p.name;
      break;
    }
  }
  return {
    aircraft: [...found.values()],
    provider,
    fetchedAt: new Date().toISOString(),
    error: provider === 'none' ? errors.join(' · ') : undefined,
  };
}
