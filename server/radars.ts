// Agrega todas las bases de datos de radares en un único conjunto fusionado.

import { FEED_URL, parseFeed, todayInSpain, type FeedCollection } from '../shared/feed';
import { mergeRadars } from '../shared/merge';
import { OVERPASS_ENDPOINTS, overpassRadarQuery, parseOverpassRadars, type OverpassResult } from '../shared/osm';
import type { Radar, RadarDataset, SourceStatus, Stretch } from '../shared/types';
import { CachedResource } from './lib/cache';
import { errorMessage, fetchJson } from './lib/http';
import { fetchDgtInvive, fetchDgtRadars } from './sources/dgt-radars';
import { fetchMadrid } from './sources/madrid';
import { fetchSct } from './sources/sct';

interface Part {
  radars: Radar[];
  stretches: Stretch[];
}

const H = 3_600_000;

async function fetchOsm(): Promise<Part> {
  let lastErr: unknown;
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const json = await fetchJson<OverpassResult>(url, {
        method: 'POST',
        body: new URLSearchParams({ data: overpassRadarQuery('ES', 240) }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeoutMs: 260_000,
      });
      return parseOverpassRadars(json);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

async function fetchFeedRaw(): Promise<FeedCollection> {
  return fetchJson<FeedCollection>(FEED_URL, { timeoutMs: 60_000 });
}

/** Fuentes directas. La clave coincide con el campo `source` del feed agregado. */
const DIRECT = [
  { key: 'dgt', label: 'DGT · radares fijos y de tramo', res: new CachedResource<Part>('dgt', 12 * H, fetchDgtRadars, { persist: true, retryMs: 10 * 60_000 }) },
  { key: 'dgt_invive', label: 'DGT · tramos con radar móvil', res: new CachedResource<Part>('dgt_invive', 24 * H, fetchDgtInvive, { persist: true, retryMs: 10 * 60_000 }) },
  { key: 'sct', label: 'Servei Català de Trànsit', res: new CachedResource<Part>('sct', 24 * H, fetchSct, { persist: true, retryMs: 10 * 60_000 }) },
  { key: 'madrid', label: 'Ayuntamiento de Madrid', res: new CachedResource<Part>('madrid', 24 * H, fetchMadrid, { persist: true, retryMs: 10 * 60_000 }) },
  { key: 'osm', label: 'OpenStreetMap', res: new CachedResource<Part>('osm', 24 * H, fetchOsm, { persist: true, retryMs: 30 * 60_000 }) },
];

/** Fuentes del feed que se omiten si su descarga directa funciona. */
const FEED_ALIASES: Record<string, string[]> = {
  dgt: ['dgt'],
  dgt_invive: ['dgt_invive'],
  sct: ['sct', 'sct_remolc'],
  madrid: ['madrid'],
  osm: ['osm'],
};

const feed = new CachedResource<FeedCollection>('feed', 3 * H, fetchFeedRaw, { persist: true, retryMs: 10 * 60_000 });

let built: { key: string; dataset: RadarDataset } | null = null;

/**
 * Devuelve el conjunto fusionado. La primera vez espera (como mucho `waitMs`)
 * a que respondan las fuentes; después sirve la copia en caché y recarga en
 * segundo plano.
 */
export async function getRadarDataset(waitMs = 45_000): Promise<RadarDataset> {
  const [direct, feedVal] = await Promise.all([
    Promise.all(DIRECT.map(async (s) => ({ s, v: await s.res.get({ waitMs }) }))),
    feed.get({ waitMs }),
  ]);

  const skip = new Set<string>();
  for (const { s, v } of direct) if (v.value && !v.error) FEED_ALIASES[s.key]?.forEach((k) => skip.add(k));

  const key = [...direct.map(({ v }) => v.updatedAt ?? 0), feedVal.updatedAt ?? 0, todayInSpain(), [...skip].join()].join('|');
  if (built?.key === key) return built.dataset;

  const sources: SourceStatus[] = direct.map(({ s, v }) => ({
    key: s.key,
    label: s.label,
    ok: !!v.value && !v.error,
    stale: v.stale && !!v.value,
    count: (v.value?.radars.length ?? 0) + (v.value?.stretches.length ?? 0),
    updatedAt: v.updatedAt ? new Date(v.updatedAt).toISOString() : undefined,
    error: v.error,
  }));

  let feedPart: Part = { radars: [], stretches: [] };
  if (feedVal.value) {
    try {
      feedPart = parseFeed(feedVal.value, todayInSpain(), skip);
    } catch (err) {
      feedVal.error = errorMessage(err);
    }
  }
  sources.push({
    key: 'feed',
    label: 'Radares Anunciados (Euskadi, Navarra, municipios…)',
    ok: !!feedVal.value && !feedVal.error,
    stale: feedVal.stale && !!feedVal.value,
    count: feedPart.radars.length + feedPart.stretches.length,
    updatedAt: feedVal.updatedAt ? new Date(feedVal.updatedAt).toISOString() : undefined,
    error: feedVal.error,
  });

  const parts = [...direct.map(({ v }) => v.value).filter((p): p is Part => !!p), feedPart];
  const radars = mergeRadars(parts.map((p) => p.radars));
  const stretches = dedupeStretches(parts.flatMap((p) => p.stretches));
  const dataset: RadarDataset = { generatedAt: new Date().toISOString(), radars, stretches, sources };
  built = { key, dataset };
  return dataset;
}

function dedupeStretches(list: Stretch[]): Stretch[] {
  const seen = new Map<string, Stretch>();
  for (const s of list) {
    const a = s.coords[0];
    const b = s.coords[s.coords.length - 1];
    const k = `${s.kind}:${a[0].toFixed(3)},${a[1].toFixed(3)}:${b[0].toFixed(3)},${b[1].toFixed(3)}`;
    const prev = seen.get(k);
    if (!prev) seen.set(k, s);
    else {
      for (const src of s.sources) if (!prev.sources.includes(src)) prev.sources.push(src);
      prev.maxspeed ??= s.maxspeed;
      if (s.coords.length > prev.coords.length) prev.coords = s.coords;
    }
  }
  return [...seen.values()];
}

/** Lanza la descarga inicial en segundo plano. */
export function warmUpRadars(): void {
  getRadarDataset(0).catch((err) => console.warn('[radars] warm-up:', errorMessage(err)));
}
