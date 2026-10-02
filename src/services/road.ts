// Vía actual y su límite de velocidad, a partir de OpenStreetMap (Overpass, acceso directo).

import { angleDiff, bearingDeg, defaultSpainLimit, distanceM, parseMaxspeed } from '../../shared/geo';
import { OVERPASS_ENDPOINTS } from '../../shared/osm';
import { road, type Position, type RoadInfo } from '../state/store';

interface Way {
  id: number;
  tags: Record<string, string>;
  geometry: { lat: number; lon: number }[];
}

const DRIVABLE =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road';

let ways: Way[] = [];
let center: { lat: number; lon: number } | null = null;
let inflight = false;
let nextAllowed = 0;
let endpoint = 0;

const RADIUS = 700;
const REFETCH_AT = 450;

async function fetchWays(lat: number, lon: number): Promise<void> {
  inflight = true;
  const query = `[out:json][timeout:20];way(around:${RADIUS},${lat.toFixed(5)},${lon.toFixed(5)})["highway"~"^(${DRIVABLE})$"];out tags geom qt;`;
  try {
    const url = OVERPASS_ENDPOINTS[endpoint % OVERPASS_ENDPOINTS.length];
    const res = await fetch(url, {
      method: 'POST',
      body: new URLSearchParams({ data: query }),
    });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const json = (await res.json()) as { elements: (Way & { type: string })[] };
    ways = json.elements.filter((e) => e.type === 'way' && e.geometry?.length > 1);
    center = { lat, lon };
    nextAllowed = Date.now() + 6000;
  } catch {
    endpoint++;
    nextAllowed = Date.now() + 20_000;
  } finally {
    inflight = false;
  }
}

/** Elige la vía más plausible: cercana y alineada con el rumbo. */
export function matchWay(p: { lat: number; lon: number; heading: number | null }, list: Way[]): { way: Way; forward: boolean } | null {
  let best: { way: Way; forward: boolean; score: number } | null = null;
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  for (const w of list) {
    const g = w.geometry;
    for (let i = 0; i < g.length - 1; i++) {
      const ax = (g[i].lon - p.lon) * kx;
      const ay = (g[i].lat - p.lat) * ky;
      const bx = (g[i + 1].lon - p.lon) * kx;
      const by = (g[i + 1].lat - p.lat) * ky;
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      const d = Math.hypot(ax + t * dx, ay + t * dy);
      if (d > 40) continue;
      const segBearing = bearingDeg(g[i].lat, g[i].lon, g[i + 1].lat, g[i + 1].lon);
      let forward = true;
      let penalty = 0;
      if (p.heading != null) {
        const fwd = angleDiff(p.heading, segBearing);
        const back = 180 - fwd;
        const oneway = w.tags.oneway === 'yes' || w.tags.highway === 'motorway' || w.tags.junction === 'roundabout';
        forward = fwd <= back;
        const diff = oneway ? fwd : Math.min(fwd, back);
        if (oneway && fwd > 100) penalty = 60;
        penalty += diff * 0.25;
      }
      const score = d + penalty;
      if (!best || score < best.score) best = { way: w, forward, score };
    }
  }
  return best && best.score < 55 ? { way: best.way, forward: best.forward } : null;
}

export function roadInfoOf(way: Way, forward: boolean): RoadInfo {
  const t = way.tags;
  const directional = forward ? t['maxspeed:forward'] : t['maxspeed:backward'];
  const explicit = parseMaxspeed(directional ?? t.maxspeed);
  const fallback = explicit == null ? defaultSpainLimit(t.highway) : undefined;
  return {
    name: t.name,
    ref: t.ref,
    maxspeed: explicit ?? fallback,
    inferred: explicit == null && fallback != null,
    highway: t.highway,
  };
}

export function updateRoad(p: Position): void {
  const needFetch = !center || distanceM(center.lat, center.lon, p.lat, p.lon) > REFETCH_AT;
  if (needFetch && !inflight && Date.now() >= nextAllowed && navigator.onLine !== false) void fetchWays(p.lat, p.lon);
  if (!ways.length) return;
  const m = matchWay(p, ways);
  if (!m) {
    if (road.value && (p.speed ?? 0) > 3) road.value = null;
    return;
  }
  const info = roadInfoOf(m.way, m.forward);
  const prev = road.value;
  if (!prev || prev.name !== info.name || prev.ref !== info.ref || prev.maxspeed !== info.maxspeed || prev.inferred !== info.inferred) {
    road.value = info;
  }
}

/** Referencias de carretera de la vía actual ("A-6;AP-6" -> ["A-6","AP-6"]). */
export function currentRoadRefs(): string[] {
  return (road.value?.ref ?? '').split(';').map((s) => s.trim()).filter(Boolean);
}
