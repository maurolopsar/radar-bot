// Vía actual, su límite de velocidad, el camino por delante y los avisos de la
// vía (pasos a nivel, resaltos, peajes…), a partir de OpenStreetMap (Overpass).
// Una sola consulta cada ~450 m trae todo lo necesario.

import { signal } from '@preact/signals';
import { distanceM } from '../../shared/geo';
import { classifyHazard, type Hazard } from '../../shared/hazards';
import { OVERPASS_ENDPOINTS } from '../../shared/osm';
import { buildNodeIndex, matchWay as matchGraph, pathAhead, type OsmWay, type PathAhead } from '../../shared/roadgraph';
import { inferSpanishLimit } from '../../shared/speedlimit';
import { road, type Position, type RoadInfo } from '../state/store';

const DRIVABLE =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|road|service';

/** Vías descargadas alrededor de la posición. */
export const roadWays = signal<OsmWay[]>([]);
/** Avisos de la vía en la zona. */
export const roadHazards = signal<Hazard[]>([]);
/** Camino previsible por delante (~1,5 km). */
export const ahead = signal<PathAhead | null>(null);
/** ¿La zona actual es urbana (densidad de edificios / uso residencial)? */
export const urbanArea = signal<boolean | null>(null);

let center: { lat: number; lon: number } | null = null;
let inflight = false;
let nextAllowed = 0;
let endpoint = 0;
let nodeIndex = buildNodeIndex([]);
let currentWayId: number | undefined;

const RADIUS = 700;
const HAZARD_RADIUS = 1500;
const REFETCH_AT = 450;

export function overpassRoadQuery(lat: number, lon: number): string {
  const p = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  return (
    `[out:json][timeout:25];` +
    `way(around:${RADIUS},${p})["highway"~"^(${DRIVABLE})$"];out body geom qt;` +
    `(node(around:${HAZARD_RADIUS},${p})["railway"="level_crossing"];` +
    `node(around:${HAZARD_RADIUS},${p})["traffic_calming"];` +
    `node(around:${HAZARD_RADIUS},${p})["barrier"="toll_booth"];` +
    `node(around:${HAZARD_RADIUS},${p})["hazard"];` +
    `node(around:${RADIUS},${p})["highway"~"^(stop|give_way|traffic_signals|crossing)$"];);out body qt;` +
    `way(around:150,${p})["building"];out count;` +
    `is_in(${p})->.a;area.a["landuse"~"^(residential|commercial|retail)$"];out ids qt;`
  );
}

interface OverpassEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: { lat: number; lon: number }[];
}

export function parseRoadResponse(json: { elements: OverpassEl[] }): { ways: OsmWay[]; hazards: Hazard[]; urban: boolean } {
  const ways: OsmWay[] = [];
  const hazards: Hazard[] = [];
  let buildings = 0;
  let landuse = false;
  for (const e of json.elements) {
    if (e.type === 'way' && e.geometry && e.geometry.length > 1) {
      // Sin ids de nodo no se pueden enlazar vías, pero sí reconocer la vía actual.
      const nodes = e.nodes?.length === e.geometry.length ? e.nodes : e.geometry.map((_, i) => -(e.id * 10_000 + i));
      ways.push({ id: e.id, tags: e.tags ?? {}, nodes, geometry: e.geometry });
    } else if (e.type === 'node' && e.lat != null && e.lon != null && e.tags) {
      const h = classifyHazard(e.id, e.lat, e.lon, e.tags);
      if (h) hazards.push(h);
    } else if (e.type === 'count') {
      buildings = Number(e.tags?.ways ?? e.tags?.total ?? 0);
    } else if (e.type === 'area') {
      landuse = true;
    }
  }
  return { ways, hazards, urban: landuse || buildings >= 12 };
}

async function fetchArea(lat: number, lon: number): Promise<void> {
  inflight = true;
  try {
    const url = OVERPASS_ENDPOINTS[endpoint % OVERPASS_ENDPOINTS.length];
    const res = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: overpassRoadQuery(lat, lon) }) });
    if (!res.ok) throw new Error(`Overpass ${res.status}`);
    const parsed = parseRoadResponse(await res.json());
    roadWays.value = parsed.ways;
    roadHazards.value = parsed.hazards;
    urbanArea.value = parsed.urban;
    nodeIndex = buildNodeIndex(parsed.ways);
    center = { lat, lon };
    nextAllowed = Date.now() + 5000;
  } catch {
    endpoint++;
    nextAllowed = Date.now() + 15_000;
  } finally {
    inflight = false;
  }
}

/** Compatibilidad: vía más plausible ({ way, forward }). */
export function matchWay(p: { lat: number; lon: number; heading: number | null }, list: OsmWay[] | Omit<OsmWay, 'nodes'>[]) {
  const m = matchGraph(p, list.map((w) => ({ nodes: [], ...w })) as OsmWay[]);
  return m ? { way: m.way, forward: m.forward } : null;
}

export function roadInfoOf(way: Pick<OsmWay, 'tags'>, forward: boolean, urban: boolean | null = null): RoadInfo {
  const t = way.tags;
  const limit = inferSpanishLimit(t, { forward, urbanArea: urban });
  return {
    name: t.name,
    ref: t.ref,
    maxspeed: limit.kmh,
    inferred: limit.source !== 'signed',
    highway: t.highway,
    limitReason: limit.reason,
    urban: limit.urban,
  };
}

export function updateRoad(p: Position): void {
  const needFetch = !center || distanceM(center.lat, center.lon, p.lat, p.lon) > REFETCH_AT;
  if (needFetch && !inflight && Date.now() >= nextAllowed && navigator.onLine !== false) void fetchArea(p.lat, p.lon);
  const ways = roadWays.value;
  if (!ways.length) return;
  const m = matchGraph(p, ways, currentWayId);
  if (!m) {
    if (road.value && (p.speed ?? 0) > 3) road.value = null;
    ahead.value = null;
    currentWayId = undefined;
    return;
  }
  currentWayId = m.way.id;
  const info = roadInfoOf(m.way, m.forward, urbanArea.value);
  const prev = road.value;
  if (!prev || prev.name !== info.name || prev.ref !== info.ref || prev.maxspeed !== info.maxspeed || prev.limitReason !== info.limitReason) {
    road.value = info;
  }
  ahead.value = p.heading != null ? pathAhead(ways, m, 1500, nodeIndex) : null;
}

/** Referencias de carretera de la vía actual ("A-6;AP-6" -> ["A-6","AP-6"]). */
export function currentRoadRefs(): string[] {
  return (road.value?.ref ?? '').split(';').map((s) => s.trim()).filter(Boolean);
}
