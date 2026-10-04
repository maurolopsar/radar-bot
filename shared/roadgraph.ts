// Grafo local de vías OSM: vía actual, camino por delante y cruces (puntos de decisión).

import { angleDiff, bearingDeg, distanceM } from './geo';

export interface OsmWay {
  id: number;
  tags: Record<string, string>;
  nodes: number[];
  geometry: { lat: number; lon: number }[];
}

export interface WayMatch {
  way: OsmWay;
  forward: boolean;
  seg: number;
  t: number;
  distance: number;
}

const MINOR = new Set(['service', 'track', 'path', 'footway', 'cycleway']);

export function isOneway(tags: Record<string, string>): 0 | 1 | -1 {
  const o = tags.oneway;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === 'no') return 0;
  if (tags.highway === 'motorway' || tags.junction === 'roundabout' || tags.junction === 'circular') return 1;
  return 0;
}

/**
 * Vía más plausible para una posición: cercana, alineada con el rumbo y, a
 * igualdad, la misma que antes (evita saltos en cruces y pasos elevados).
 */
export function matchWay(p: { lat: number; lon: number; heading: number | null }, ways: OsmWay[], previousId?: number): WayMatch | null {
  let best: (WayMatch & { score: number }) | null = null;
  const kx = Math.cos((p.lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  for (const w of ways) {
    const g = w.geometry;
    const oneway = isOneway(w.tags);
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
      let forward = oneway !== -1;
      let penalty = 0;
      if (p.heading != null) {
        const fwd = angleDiff(p.heading, segBearing);
        const back = 180 - fwd;
        forward = oneway === 1 ? true : oneway === -1 ? false : fwd <= back;
        const diff = oneway === 1 ? fwd : oneway === -1 ? back : Math.min(fwd, back);
        if (diff > 100) penalty += 60;
        penalty += diff * 0.25;
      }
      if (w.id === previousId) penalty -= 8;
      if (MINOR.has(w.tags.highway)) penalty += 6;
      const score = d + penalty;
      if (!best || score < best.score) best = { way: w, forward, seg: i, t, distance: d, score };
    }
  }
  if (!best || best.score >= 55) return null;
  const { score: _s, ...m } = best;
  return m;
}

export interface Junction {
  along: number;
  lat: number;
  lon: number;
  /** Salidas distintas de la que se sigue. */
  exits: number;
  roundabout: boolean;
  /** Ángulo del giro necesario para seguir el camino elegido. */
  turn: number;
}

export interface PathAhead {
  coords: [number, number][];
  junctions: Junction[];
  wayIds: number[];
  length: number;
}

export function buildNodeIndex(ways: OsmWay[]): Map<number, { way: OsmWay; idx: number }[]> {
  const index = new Map<number, { way: OsmWay; idx: number }[]>();
  for (const w of ways) {
    w.nodes.forEach((n, idx) => {
      let arr = index.get(n);
      if (!arr) index.set(n, (arr = []));
      arr.push({ way: w, idx });
    });
  }
  return index;
}

/**
 * Camino previsible por delante: sigue la vía actual y, en cada final de vía,
 * la continuación más recta (prefiriendo la misma carretera).
 */
export function pathAhead(ways: OsmWay[], m: WayMatch, lengthM = 1500, index = buildNodeIndex(ways)): PathAhead {
  const coords: [number, number][] = [];
  const junctions: Junction[] = [];
  const wayIds: number[] = [];
  const g0 = m.way.geometry;
  const start = {
    lat: g0[m.seg].lat + (g0[m.seg + 1].lat - g0[m.seg].lat) * m.t,
    lon: g0[m.seg].lon + (g0[m.seg + 1].lon - g0[m.seg].lon) * m.t,
  };
  coords.push([start.lon, start.lat]);
  let along = 0;
  let way = m.way;
  let forward = m.forward;
  let idx = forward ? m.seg + 1 : m.seg;
  let prev = start;
  const visited = new Set<number>();

  for (let guard = 0; guard < 60 && along < lengthM; guard++) {
    visited.add(way.id);
    wayIds.push(way.id);
    const g = way.geometry;
    const step = forward ? 1 : -1;
    for (; idx >= 0 && idx < g.length; idx += step) {
      const pt = g[idx];
      const d = distanceM(prev.lat, prev.lon, pt.lat, pt.lon);
      if (d < 0.5) continue;
      along += d;
      coords.push([pt.lon, pt.lat]);
      const node = way.nodes[idx];
      const isEnd = idx === 0 || idx === g.length - 1;
      if (!isEnd) {
        const others = (index.get(node) ?? []).filter((x) => x.way.id !== way.id && !MINOR.has(x.way.tags.highway));
        if (others.length) {
          junctions.push({
            along,
            lat: pt.lat,
            lon: pt.lon,
            exits: others.length,
            roundabout: others.some((x) => /roundabout|circular/.test(x.way.tags.junction ?? '')),
            turn: 0,
          });
        }
      }
      prev = pt;
      if (along >= lengthM) break;
    }
    if (along >= lengthM) break;

    // Final de la vía: elegir continuación.
    const endIdx = forward ? g.length - 1 : 0;
    const endNode = way.nodes[endIdx];
    const inBearing = bearingDeg(g[endIdx - step]?.lat ?? g[endIdx].lat, g[endIdx - step]?.lon ?? g[endIdx].lon, g[endIdx].lat, g[endIdx].lon);
    const options: { way: OsmWay; forward: boolean; idx: number; turn: number; score: number }[] = [];
    for (const { way: w, idx: k } of index.get(endNode) ?? []) {
      if (w.id === way.id || visited.has(w.id)) continue;
      const ow = isOneway(w.tags);
      const wg = w.geometry;
      for (const fwd of [true, false]) {
        if ((fwd && (k >= wg.length - 1 || ow === -1)) || (!fwd && (k <= 0 || ow === 1))) continue;
        const nk = fwd ? k + 1 : k - 1;
        const out = bearingDeg(wg[k].lat, wg[k].lon, wg[nk].lat, wg[nk].lon);
        const turn = angleDiff(inBearing, out);
        const same = (w.tags.ref && w.tags.ref === way.tags.ref) || (w.tags.name && w.tags.name === way.tags.name);
        const score = turn - (same ? 25 : 0) + (MINOR.has(w.tags.highway) ? 30 : 0);
        options.push({ way: w, forward: fwd, idx: nk, turn, score });
      }
    }
    if (!options.length) break;
    options.sort((a, b) => a.score - b.score);
    const chosen = options[0];
    const realExits = options.filter((o) => o !== chosen && !MINOR.has(o.way.tags.highway)).length;
    if (realExits > 0 || /roundabout|circular/.test(chosen.way.tags.junction ?? '')) {
      junctions.push({
        along,
        lat: g[endIdx].lat,
        lon: g[endIdx].lon,
        exits: realExits,
        roundabout: options.some((o) => /roundabout|circular/.test(o.way.tags.junction ?? '')),
        turn: chosen.turn,
      });
    }
    if (chosen.turn > 110) break;
    way = chosen.way;
    forward = chosen.forward;
    idx = chosen.idx;
  }
  return { coords, junctions, wayIds, length: along };
}
