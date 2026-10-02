// Utilidades geográficas sin dependencias.

export const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export interface LatLon {
  lat: number;
  lon: number;
}

/** Distancia ortodrómica en metros. */
export function distanceM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Rumbo inicial de A a B en grados [0, 360). */
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const φ1 = toRad(aLat);
  const φ2 = toRad(bLat);
  const Δλ = toRad(bLon - aLon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeDeg(toDeg(Math.atan2(y, x)));
}

export function normalizeDeg(d: number): number {
  const r = d % 360;
  return r < 0 ? r + 360 : r;
}

/** Diferencia angular absoluta en [0, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(normalizeDeg(a) - normalizeDeg(b));
  return d > 180 ? 360 - d : d;
}

/** Punto destino desde un origen, rumbo (grados) y distancia (m). */
export function destination(lat: number, lon: number, bearing: number, distM: number): LatLon {
  const δ = distM / EARTH_RADIUS_M;
  const θ = toRad(bearing);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** Caja que contiene un círculo de radio `radiusM` alrededor del punto. */
export function bboxAround(lat: number, lon: number, radiusM: number): BBox {
  const dLat = toDeg(radiusM / EARTH_RADIUS_M);
  const dLon = dLat / Math.max(0.01, Math.cos(toRad(lat)));
  return { south: lat - dLat, west: lon - dLon, north: lat + dLat, east: lon + dLon };
}

export function inBBox(lat: number, lon: number, b: BBox): boolean {
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
}

export function expandBBox(b: BBox, marginM: number): BBox {
  const midLat = (b.south + b.north) / 2;
  const dLat = toDeg(marginM / EARTH_RADIUS_M);
  const dLon = dLat / Math.max(0.01, Math.cos(toRad(midLat)));
  return { south: b.south - dLat, west: b.west - dLon, north: b.north + dLat, east: b.east + dLon };
}

/** Caja de una lista de coordenadas [lon, lat]. */
export function bboxOf(coords: [number, number][]): BBox {
  let south = Infinity,
    west = Infinity,
    north = -Infinity,
    east = -Infinity;
  for (const [lon, lat] of coords) {
    if (lat < south) south = lat;
    if (lat > north) north = lat;
    if (lon < west) west = lon;
    if (lon > east) east = lon;
  }
  return { south, west, north, east };
}

export interface SegmentProjection {
  /** Distancia del punto al segmento/polilínea (m). */
  distance: number;
  /** Distancia recorrida a lo largo de la polilínea hasta la proyección (m). */
  along: number;
  /** Longitud total de la polilínea (m). */
  length: number;
}

/**
 * Proyecta un punto sobre una polilínea [lon, lat][] usando una proyección
 * equirectangular local (precisión de sobra para tramos de decenas de km).
 */
export function projectOnLine(lat: number, lon: number, line: [number, number][]): SegmentProjection {
  const kx = Math.cos(toRad(lat)) * ((Math.PI * EARTH_RADIUS_M) / 180);
  const ky = (Math.PI * EARTH_RADIUS_M) / 180;
  let best = Infinity;
  let bestAlong = 0;
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = [(line[i][0] - lon) * kx, (line[i][1] - lat) * ky];
    const [bx, by] = [(line[i + 1][0] - lon) * kx, (line[i + 1][1] - lat) * ky];
    const dx = bx - ax;
    const dy = by - ay;
    const segLen = Math.hypot(dx, dy);
    const t = segLen === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (segLen * segLen)));
    const px = ax + t * dx;
    const py = ay + t * dy;
    const d = Math.hypot(px, py);
    if (d < best) {
      best = d;
      bestAlong = acc + t * segLen;
    }
    acc += segLen;
  }
  if (line.length === 1) {
    best = distanceM(lat, lon, line[0][1], line[0][0]);
  }
  return { distance: best, along: bestAlong, length: acc };
}

export function lineLengthM(line: [number, number][]): number {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    acc += distanceM(line[i][1], line[i][0], line[i + 1][1], line[i + 1][0]);
  }
  return acc;
}

/** Interpola un punto a `distM` metros desde el inicio de la polilínea. */
export function pointAlong(line: [number, number][], distM: number): { lat: number; lon: number; bearing: number } {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const [lon1, lat1] = line[i];
    const [lon2, lat2] = line[i + 1];
    const seg = distanceM(lat1, lon1, lat2, lon2);
    if (acc + seg >= distM && seg > 0) {
      const t = (distM - acc) / seg;
      return {
        lat: lat1 + (lat2 - lat1) * t,
        lon: lon1 + (lon2 - lon1) * t,
        bearing: bearingDeg(lat1, lon1, lat2, lon2),
      };
    }
    acc += seg;
  }
  const n = line.length;
  const last = line[n - 1];
  const prev = line[Math.max(0, n - 2)];
  return { lat: last[1], lon: last[0], bearing: bearingDeg(prev[1], prev[0], last[1], last[0]) };
}

export const msToKmh = (ms: number) => ms * 3.6;
export const kmhToMs = (kmh: number) => kmh / 3.6;
export const ktToKmh = (kt: number) => kt * 1.852;
export const ftToM = (ft: number) => ft * 0.3048;
export const nmToKm = (nm: number) => nm * 1.852;
export const kmToNm = (km: number) => km / 1.852;

const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];

/** Punto cardinal (en español) más cercano a un rumbo. */
export function cardinal(bearing: number): string {
  return CARDINALS[Math.round(normalizeDeg(bearing) / 45) % 8];
}

const CARDINAL_DEG: Record<string, number> = {
  N: 0, NNE: 22.5, NE: 45, ENE: 67.5, E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
  S: 180, SSW: 202.5, SW: 225, WSW: 247.5, W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  SSO: 202.5, SO: 225, OSO: 247.5, O: 270, ONO: 292.5, NO: 315, NNO: 337.5,
};

/** Interpreta un rumbo en grados ("90") o cardinal ("NE"). Devuelve undefined si no es interpretable. */
export function parseBearing(value: string | undefined | null): number | undefined {
  if (value == null) return undefined;
  const v = String(value).trim().toUpperCase();
  if (/^-?\d+(\.\d+)?$/.test(v)) return normalizeDeg(Number(v));
  return CARDINAL_DEG[v];
}

/**
 * Interpreta un valor OSM `maxspeed` a km/h. Admite "50", "50 mph", "ES:urban", etc.
 * Devuelve undefined si no es interpretable ("none", "signals", "walk"...).
 */
export function parseMaxspeed(value: string | undefined | null): number | undefined {
  if (value == null) return undefined;
  const v = String(value).trim();
  const first = v.split(/[;|]/)[0].trim();
  const m = /^(\d{1,3})(?:\s*(mph|km\/h|kmh))?$/i.exec(first);
  if (m) {
    const n = Number(m[1]);
    if (!n) return undefined;
    return m[2]?.toLowerCase() === 'mph' ? Math.round(n * 1.609344) : n;
  }
  const implicit: Record<string, number> = {
    'ES:URBAN': 50,
    'ES:ZONE30': 30,
    'ES:ZONE20': 20,
    'ES:RURAL': 90,
    'ES:TRUNK': 90,
    'ES:MOTORWAY': 120,
    'ES:LIVING_STREET': 20,
    'ES:PLAYGROUND': 20,
  };
  return implicit[first.toUpperCase()];
}

/** Límite genérico en España según el tipo de vía OSM, cuando no hay `maxspeed`. */
export function defaultSpainLimit(highway: string | undefined): number | undefined {
  switch (highway) {
    case 'motorway':
      return 120;
    case 'motorway_link':
    case 'trunk_link':
      return undefined;
    case 'trunk':
    case 'primary':
    case 'secondary':
    case 'tertiary':
      return 90;
    case 'residential':
    case 'unclassified':
      return 50; // urbano por defecto (puede ser 30 en vías de un carril por sentido)
    case 'living_street':
      return 20;
    default:
      return undefined;
  }
}

/** Formatea una distancia para mostrarla o leerla en voz alta. */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  if (m < 10_000) return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
  return `${Math.round(m / 1000)} km`;
}

/** Celda de rejilla para indexado espacial rápido. */
export function gridKey(lat: number, lon: number, cellDeg: number): string {
  return `${Math.floor(lat / cellDeg)}:${Math.floor(lon / cellDeg)}`;
}

/** Índice espacial simple por rejilla, para consultas de vecinos cercanos. */
export class GridIndex<T extends LatLon> {
  private cells = new Map<string, T[]>();
  constructor(private cellDeg = 0.05) {}

  add(item: T): void {
    const k = gridKey(item.lat, item.lon, this.cellDeg);
    let arr = this.cells.get(k);
    if (!arr) this.cells.set(k, (arr = []));
    arr.push(item);
  }

  /** Elementos en las celdas que cubren un radio alrededor del punto (filtrados por distancia). */
  near(lat: number, lon: number, radiusM: number): T[] {
    const b = bboxAround(lat, lon, radiusM);
    const out: T[] = [];
    const c = this.cellDeg;
    for (let y = Math.floor(b.south / c); y <= Math.floor(b.north / c); y++) {
      for (let x = Math.floor(b.west / c); x <= Math.floor(b.east / c); x++) {
        const arr = this.cells.get(`${y}:${x}`);
        if (!arr) continue;
        for (const it of arr) if (distanceM(lat, lon, it.lat, it.lon) <= radiusM) out.push(it);
      }
    }
    return out;
  }
}
