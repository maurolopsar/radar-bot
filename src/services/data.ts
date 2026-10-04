// Carga y refresco periódico de datos: radares, incidencias, aeronaves, avisos,
// gasolineras y cámaras.

import { bboxAround, distanceM } from '../../shared/geo';
import { FEED_URL, parseFeed, todayInSpain, type FeedCollection } from '../../shared/feed';
import { mergeRadars } from '../../shared/merge';
import { OVERPASS_ENDPOINTS, overpassRadarQuery, parseOverpassRadars, type OverpassResult } from '../../shared/osm';
import type { RadarDataset, UserReport } from '../../shared/types';
import { settings } from '../state/settings';
import {
  aircraft,
  aircraftInfo,
  cameras,
  dataset,
  datasetState,
  eventSources,
  events,
  fleet,
  fleetInfo,
  fuel,
  importedRadars,
  position,
  reports,
  showToast,
} from '../state/store';
import { DEFAULT_DGT_MATCHER, fromReadsb, type ReadsbAircraft } from '../../shared/aircraft';
import { api, matcherParams } from './api';
import { onFix } from './geolocation';
import { load, save } from './storage';
import { updateWeather } from './weather';

const DS_KEY = 'radars:dataset';
const ETAG_KEY = 'radars:etag';
const IMPORTS_KEY = 'radars:imports';
const REPORTS_KEY = 'reports:local';

let serverOk: boolean | null = null;
export const hasServer = () => serverOk === true;

// ---------------------------------------------------------------------------
// Radares

export async function loadCachedRadars(): Promise<void> {
  const [cached, imports, localReports] = await Promise.all([
    load<RadarDataset>(DS_KEY),
    load<{ name: string; radars: [] }[]>(IMPORTS_KEY),
    load<UserReport[]>(REPORTS_KEY),
  ]);
  if (cached && !dataset.value) {
    dataset.value = cached;
    datasetState.value = { loading: false, source: 'cache' };
  }
  if (imports) importedRadars.value = imports;
  if (localReports) reports.value = activeReports(localReports);
}

/** Descarga de la base de datos fusionada. Sin servidor, usa fuentes directas. */
export async function refreshRadars(force = false): Promise<void> {
  datasetState.value = { ...datasetState.value, loading: true, error: undefined };
  try {
    const etag = force ? undefined : await load<string>(ETAG_KEY);
    const { dataset: ds, etag: newTag } = await api.radars(dataset.value ? etag : undefined);
    serverOk = true;
    if (ds) {
      dataset.value = ds;
      await save(DS_KEY, ds);
      if (newTag) await save(ETAG_KEY, newTag);
    }
    const failing = (ds ?? dataset.value)?.sources.filter((s) => !s.ok && !s.stale).length ?? 0;
    datasetState.value = { loading: false, source: 'server', error: failing ? `${failing} fuente(s) sin datos` : undefined };
    // Si alguna fuente aún no ha respondido (primer arranque del servidor), reintenta pronto.
    if (failing) setTimeout(() => void refreshRadars(), 3 * 60_000);
  } catch (err) {
    serverOk = false;
    await refreshRadarsDirect(err as Error);
  }
}

/** Respaldo sin servidor: feed agregado (GitHub Pages) + OSM de la zona. */
async function refreshRadarsDirect(cause: Error): Promise<void> {
  try {
    const p = position.value;
    const [feedRes, osmRes] = await Promise.allSettled([
      fetch(FEED_URL).then((r) => {
        if (!r.ok) throw new Error(`feed ${r.status}`);
        return r.json() as Promise<FeedCollection>;
      }),
      p
        ? fetch(OVERPASS_ENDPOINTS[0], {
            method: 'POST',
            body: new URLSearchParams({ data: overpassRadarQuery(bboxAround(p.lat, p.lon, 80_000), 60) }),
          }).then((r) => {
            if (!r.ok) throw new Error(`overpass ${r.status}`);
            return r.json() as Promise<OverpassResult>;
          })
        : Promise.reject(new Error('sin posición')),
    ]);
    if (!p) {
      // OSM se consulta por zona: se repite en cuanto haya posición.
      const off = onFix(() => {
        off();
        void refreshRadars();
      });
    }
    const feedPart = feedRes.status === 'fulfilled' ? parseFeed(feedRes.value, todayInSpain()) : { radars: [], stretches: [] };
    const osmPart = osmRes.status === 'fulfilled' ? parseOverpassRadars(osmRes.value) : { radars: [], stretches: [] };
    if (!feedPart.radars.length && !osmPart.radars.length) throw cause;
    const ds: RadarDataset = {
      generatedAt: new Date().toISOString(),
      radars: mergeRadars([feedPart.radars, osmPart.radars]),
      stretches: [...feedPart.stretches, ...osmPart.stretches],
      sources: [
        { key: 'feed', label: 'Radares Anunciados (directo)', ok: feedRes.status === 'fulfilled', count: feedPart.radars.length },
        { key: 'osm', label: 'OpenStreetMap (zona actual)', ok: osmRes.status === 'fulfilled', count: osmPart.radars.length },
      ],
    };
    dataset.value = ds;
    await save(DS_KEY, ds);
    datasetState.value = { loading: false, source: 'direct', error: 'Sin servidor: datos parciales' };
  } catch {
    datasetState.value = {
      loading: false,
      offline: true,
      source: dataset.value ? 'cache' : undefined,
      error: dataset.value ? 'Sin conexión: usando copia guardada' : `No se pudieron cargar radares (${cause.message})`,
    };
  }
}

export async function saveImports(list: { name: string; radars: import('../../shared/types').Radar[] }[]): Promise<void> {
  importedRadars.value = list;
  await save(IMPORTS_KEY, list);
}

// ---------------------------------------------------------------------------
// Avisos propios

function activeReports(list: UserReport[]): UserReport[] {
  const now = Date.now();
  return list.filter((r) => !r.expiresAt || Date.parse(r.expiresAt) > now);
}

export async function addReport(r: UserReport): Promise<void> {
  reports.value = [...reports.value.filter((x) => x.id !== r.id), r];
  await save(REPORTS_KEY, reports.value);
  try {
    await api.addReport(r);
  } catch {
    // queda guardado localmente
  }
}

export async function removeReport(id: string): Promise<void> {
  reports.value = reports.value.filter((x) => x.id !== id);
  await save(REPORTS_KEY, reports.value);
  try {
    await api.deleteReport(id);
  } catch {
    // ignorar
  }
}

async function syncReports(): Promise<void> {
  try {
    const remote = await api.reports();
    const map = new Map<string, UserReport>();
    for (const r of [...reports.value, ...remote]) map.set(r.id, r);
    reports.value = activeReports([...map.values()]);
    await save(REPORTS_KEY, reports.value);
  } catch {
    reports.value = activeReports(reports.value);
  }
}

// ---------------------------------------------------------------------------
// Bucles de refresco

interface Loop {
  last: number;
  lastPos?: { lat: number; lon: number };
  running: boolean;
}

const loops: Record<string, Loop> = {};

async function every(name: string, intervalMs: number, moveM: number, fn: (lat: number, lon: number) => Promise<void>): Promise<void> {
  const p = position.value;
  if (!p) return;
  const l = (loops[name] ??= { last: 0, running: false });
  if (l.running) return;
  const moved = l.lastPos ? distanceM(l.lastPos.lat, l.lastPos.lon, p.lat, p.lon) : Infinity;
  if (Date.now() - l.last < intervalMs && moved < moveM) return;
  l.running = true;
  l.last = Date.now();
  l.lastPos = { lat: p.lat, lon: p.lon };
  try {
    await fn(p.lat, p.lon);
  } catch (err) {
    console.warn(`[${name}]`, (err as Error).message);
  } finally {
    l.running = false;
  }
}

let lastServerCheck = 0;

function tick(): void {
  const s = settings.value;
  // Sin servidor (p. ej. dormido en un plan gratuito): se reintenta cada minuto.
  if (serverOk === false && Date.now() - lastServerCheck > 60_000) {
    lastServerCheck = Date.now();
    void checkServer(true).then((ok) => {
      if (ok) {
        showToast('Conectado al servidor');
        void refreshRadars();
      }
    });
  }
  if (serverOk !== false) {
    if (s.dgtIncidents || s.waze) {
      void every('events', 60_000, s.eventsRadiusKm * 300, async (lat, lon) => {
        const r = await api.events(lat, lon, s.eventsRadiusKm, { dgt: s.dgtIncidents, waze: s.waze });
        events.value = r.events;
        eventSources.value = r.sources;
      });
    } else if (events.value.length) events.value = [];

    if (s.aircraft) {
      void every('aircraft', s.aircraftPollS * 1000, 2000, async (lat, lon) => {
        // Se pide algo más que el radio de aviso para verlos venir en el mapa.
        try {
          const r = await api.aircraft(lat, lon, Math.max(s.aircraftRangeKm * 1.5, 25));
          if (r.provider === 'none') {
            // El servidor no llega a ningún proveedor: se intenta desde el propio móvil.
            await aircraftDirect(lat, lon, Math.max(s.aircraftRangeKm * 1.5, 25));
            if (aircraftInfo.value.error) aircraftInfo.value = { error: `Servidor: ${r.error ?? 'sin proveedor'} · Directo: ${aircraftInfo.value.error}` };
            return;
          }
          aircraft.value = r.aircraft;
          aircraftInfo.value = { provider: r.provider, error: r.error, fetchedAt: r.fetchedAt };
        } catch (err) {
          aircraftInfo.value = { ...aircraftInfo.value, error: (err as Error).message };
        }
      });
    } else if (aircraft.value.length) aircraft.value = [];

    if (s.aircraft && s.fleetTracking) {
      void every('fleet', 30_000, Infinity, async () => {
        try {
          const r = await api.fleet();
          fleet.value = r.aircraft;
          fleetInfo.value = { provider: r.provider, error: r.error, fetchedAt: r.fetchedAt };
        } catch (err) {
          fleetInfo.value = { ...fleetInfo.value, error: (err as Error).message };
        }
      });
    }

    if (s.layers.fuel) {
      void every('fuel', 20 * 60_000, 8000, async (lat, lon) => {
        fuel.value = await api.fuel(lat, lon, 15);
      });
    }
    if (s.layers.cameras) {
      void every('cameras', 60 * 60_000, 10_000, async (lat, lon) => {
        cameras.value = await api.cameras(lat, lon, 40);
      });
    }
    void every('reports', 2 * 60_000, Infinity, () => syncReports());
  } else {
    if (s.aircraft) void every('aircraft', Math.max(15, s.aircraftPollS) * 1000, 2000, (lat, lon) => aircraftDirect(lat, lon, Math.max(s.aircraftRangeKm * 1.5, 25)));
    void every('reports-local', 60_000, Infinity, async () => {
      reports.value = activeReports(reports.value);
    });
  }
  void every('weather', 10 * 60_000, 15_000, (lat, lon) => updateWeather(lat, lon));
}

let timer: number | undefined;

export function startDataLoops(): void {
  if (timer) return;
  timer = window.setInterval(tick, 2000);
  tick();
  // Radares: al arrancar y cada 6 h.
  void refreshRadars();
  window.setInterval(() => void refreshRadars(), 6 * 3600_000);
}

/** Fuerza el refresco de un bucle en el siguiente ciclo. */
export function poke(name: 'events' | 'aircraft' | 'fleet' | 'fuel' | 'cameras' | 'reports'): void {
  if (loops[name]) loops[name].last = 0;
  if (loops[name]) loops[name].lastPos = undefined;
}

export async function checkServer(quiet = false): Promise<boolean> {
  lastServerCheck = Date.now();
  try {
    const h = await api.health();
    serverOk = !h.tokenRequired || h.authorized !== false;
    if (!serverOk && !quiet) showToast('El servidor pide token: configúralo en Ajustes → Servidor');
  } catch {
    serverOk = false;
    if (!quiet) showToast('Servidor no disponible: modo directo (datos parciales)');
  }
  return serverOk;
}

/** Sin servidor: consulta directa a adsb.lol (solo funciona si permite CORS). */
async function aircraftDirect(lat: number, lon: number, radiusKm: number): Promise<void> {
  const m = matcherParams();
  const matcher = {
    registrations: [...DEFAULT_DGT_MATCHER.registrations, ...m.regs.split(',').filter(Boolean)],
    hexes: m.hex.split(',').filter(Boolean),
    callsignPrefixes: [...DEFAULT_DGT_MATCHER.callsignPrefixes, ...m.cs.split(',').filter(Boolean)],
  };
  const nm = Math.min(250, Math.ceil(radiusKm / 1.852));
  try {
    const res = await fetch(`https://api.adsb.lol/v2/point/${lat.toFixed(3)}/${lon.toFixed(3)}/${nm}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { ac?: ReadsbAircraft[] };
    aircraft.value = (data.ac ?? []).map((a) => fromReadsb(a, 'adsb.lol', matcher)).filter((a): a is NonNullable<typeof a> => !!a);
    aircraftInfo.value = { provider: 'adsb.lol (directo)', fetchedAt: new Date().toISOString() };
  } catch (err) {
    aircraftInfo.value = { error: `Sin servidor (${(err as Error).message})` };
  }
}
