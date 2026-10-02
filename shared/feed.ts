// Feed abierto "Radares Anunciados" (https://github.com/GeiserX/radares-anunciados):
// GeoJSON que se regenera cada 6 h con DGT, SCT, Euskadi, Navarra, Madrid,
// Salamanca, Donostia, León, Murcia (radares móviles anunciados) y OSM.
// Datos bajo ODbL 1.0 con la atribución de cada fuente.

import type { Radar, RadarKind, Stretch } from './types';

export const FEED_URL = 'https://geiserx.github.io/radares-anunciados/feed.geojson';

interface FeedFeature {
  type: 'Feature';
  id?: string;
  geometry: { type: 'Point'; coordinates: [number, number] } | { type: 'LineString'; coordinates: [number, number][] };
  properties: {
    name?: string;
    source?: string;
    kind?: string;
    active?: boolean;
    valid_from?: string | null;
    valid_to?: string | null;
    maxspeed?: number | null;
    direction?: string | null;
    road?: string | null;
    km_from?: number | null;
    km_to?: number | null;
  };
}

export interface FeedCollection {
  type: 'FeatureCollection';
  features: FeedFeature[];
}

const KIND: Record<string, RadarKind | undefined> = {
  fixed: 'fixed',
  section: 'section',
  trailer: 'trailer',
  mobile_announced: 'mobile',
  // Los círculos a lo largo de un tramo de radar móvil se representan con la línea.
  mobile_stretch: undefined,
};

/**
 * Convierte el feed. `skipSources` permite omitir las fuentes que ya se
 * descargan directamente (para no duplicar trabajo de fusión).
 */
export function parseFeed(fc: FeedCollection, today: string, skipSources: Set<string> = new Set()) {
  const radars: Radar[] = [];
  const stretches: Stretch[] = [];
  for (const f of fc.features ?? []) {
    const p = f.properties ?? {};
    const src = p.source ?? 'feed';
    if (skipSources.has(src)) continue;
    if (p.active === false) continue;
    if (p.valid_to && p.valid_to < today) continue;
    const tag = `feed:${src}`;
    if (f.geometry?.type === 'Point') {
      const kind = KIND[p.kind ?? 'fixed'];
      if (!kind) continue;
      const [lon, lat] = f.geometry.coordinates;
      radars.push({
        id: `feed-${f.id ?? `${src}-${lat}-${lon}`}`,
        kind,
        lat,
        lon,
        maxspeed: p.maxspeed ?? undefined,
        direction: p.direction ?? undefined,
        name: p.name,
        validFrom: p.valid_from ?? undefined,
        validTo: p.valid_to ?? undefined,
        sources: [tag],
      });
    } else if (f.geometry?.type === 'LineString' && f.geometry.coordinates.length >= 2) {
      const mobile = src === 'dgt_invive' || /m[oó]vil/i.test(p.name ?? '');
      stretches.push({
        id: `feed-${f.id ?? `${src}-${stretches.length}`}`,
        kind: mobile ? 'mobile_stretch' : 'section',
        coords: f.geometry.coordinates,
        maxspeed: p.maxspeed ?? undefined,
        road: p.road ?? undefined,
        kmFrom: p.km_from ?? undefined,
        kmTo: p.km_to ?? undefined,
        name: p.name,
        direction: p.direction ?? undefined,
        sources: [tag],
      });
    }
  }
  return { radars, stretches };
}

/** Fecha local en España (YYYY-MM-DD). */
export function todayInSpain(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(now);
}
