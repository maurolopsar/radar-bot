// Fusión de radares de varias bases de datos en una sola lista sin duplicados.

import { angleDiff, distanceM, GridIndex } from './geo';
import type { Radar, RadarKind } from './types';

/** Prioridad de cada fuente para atributos (límite, carretera, PK): menor = mejor. */
const SOURCE_PRIORITY: Record<string, number> = {
  dgt: 0,
  sct: 0,
  madrid: 0,
  euskadi: 0,
  navarra: 0,
  salamanca: 0,
  donostia: 0,
  feed: 1,
  user: 1,
  import: 2,
  osm: 3,
};

function priority(r: Radar): number {
  return Math.min(...r.sources.map((s) => SOURCE_PRIORITY[s.split(':')[0]] ?? 2));
}

/** Grupos de tipos que pueden ser el mismo radar físico. */
function group(kind: RadarKind): string {
  switch (kind) {
    case 'fixed':
    case 'section':
      return 'speed';
    case 'redlight':
      return 'redlight';
    case 'trailer':
      return 'trailer';
    case 'mobile':
      return 'mobile';
  }
}

export interface MergeOptions {
  /** Distancia máxima para considerar dos radares el mismo (m). */
  sameSourceM: number;
  crossSourceM: number;
  /** Con OSM la posición DGT va referida al PK y puede desviarse más. */
  osmM: number;
}

export const DEFAULT_MERGE: MergeOptions = { sameSourceM: 40, crossSourceM: 90, osmM: 160 };

function threshold(a: Radar, b: Radar, o: MergeOptions): number {
  const shared = a.sources.some((s) => b.sources.includes(s));
  if (shared) return o.sameSourceM;
  const osm = a.sources.includes('osm') !== b.sources.includes('osm');
  return osm ? o.osmM : o.crossSourceM;
}

function compatible(a: Radar, b: Radar): boolean {
  if (group(a.kind) !== group(b.kind)) return false;
  if (a.heading != null && b.heading != null && angleDiff(a.heading, b.heading) > 90) return false;
  if (a.maxspeed != null && b.maxspeed != null && Math.abs(a.maxspeed - b.maxspeed) > 30) return false;
  if (a.kind === 'mobile' && (a.validFrom !== b.validFrom || a.validTo !== b.validTo)) return false;
  return true;
}

function absorb(into: Radar, other: Radar): void {
  const pInto = priority(into);
  const pOther = priority(other);
  const better = pOther < pInto;
  for (const s of other.sources) if (!into.sources.includes(s)) into.sources.push(s);
  // OSM suele situar el poste con más precisión que el PK oficial.
  if (other.sources.includes('osm') && !into.sources.includes('osm-pos') && into.sources[0] !== 'osm') {
    into.lat = other.lat;
    into.lon = other.lon;
    into.sources.push('osm-pos');
  }
  if (into.maxspeed == null || (better && other.maxspeed != null)) into.maxspeed = other.maxspeed ?? into.maxspeed;
  if (into.heading == null) into.heading = other.heading;
  if (into.road == null || (better && other.road)) into.road = other.road ?? into.road;
  if (into.pk == null) into.pk = other.pk;
  if (into.direction == null) into.direction = other.direction;
  if (into.name == null || (better && other.name)) into.name = other.name ?? into.name;
  if (into.sectionId == null) into.sectionId = other.sectionId;
  if (into.kind === 'fixed' && other.kind === 'section') into.kind = 'section';
}

/**
 * Fusiona radares cercanos y compatibles. Se procesan por prioridad de fuente,
 * de modo que el registro resultante conserva el id del más fiable.
 */
export function mergeRadars(lists: Radar[][], o: MergeOptions = DEFAULT_MERGE): Radar[] {
  const all = lists
    .flat()
    .filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))
    .map((r) => ({ ...r, sources: [...r.sources] }))
    .sort((a, b) => priority(a) - priority(b));
  const index = new GridIndex<Radar>(0.02);
  const out: Radar[] = [];
  const maxM = Math.max(o.sameSourceM, o.crossSourceM, o.osmM);
  for (const r of all) {
    let best: Radar | undefined;
    let bestD = Infinity;
    for (const c of index.near(r.lat, r.lon, maxM)) {
      if (!compatible(c, r)) continue;
      const d = distanceM(c.lat, c.lon, r.lat, r.lon);
      if (d <= threshold(c, r, o) && d < bestD) {
        best = c;
        bestD = d;
      }
    }
    if (best) {
      absorb(best, r);
    } else {
      index.add(r);
      out.push(r);
    }
  }
  for (const r of out) r.sources = r.sources.filter((s) => s !== 'osm-pos');
  return out;
}
