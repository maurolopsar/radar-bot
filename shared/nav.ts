// Navegación: rutas OSRM, instrucciones en español y seguimiento del progreso.

import { distanceM } from './geo';

export interface LatLon {
  lat: number;
  lon: number;
}

export interface NavStep {
  /** Distancia desde el inicio de la ruta hasta la maniobra (m). */
  at: number;
  distance: number;
  duration: number;
  type: string;
  modifier?: string;
  exit?: number;
  name?: string;
  ref?: string;
  destinations?: string;
  instruction: string;
  location: [number, number];
  /** Índice de tramo (parada) al que pertenece. */
  leg: number;
}

export interface NavRoute {
  coords: [number, number][];
  /** Distancia acumulada por punto (m). */
  cum: number[];
  /** Tiempo acumulado por punto (s). */
  cumTime: number[];
  distance: number;
  duration: number;
  steps: NavStep[];
  /** Distancia acumulada al final de cada tramo (llegada a cada parada). */
  legEnds: number[];
  /** Vías principales ("A-6, M-30"). */
  summary: string;
  /** Velocidad media prevista por segmento (m/s), para simulación. */
  speeds: number[];
}

interface OsrmStep {
  distance: number;
  duration: number;
  name?: string;
  ref?: string;
  destinations?: string;
  exits?: string;
  rotary_name?: string;
  maneuver: { type: string; modifier?: string; exit?: number; location: [number, number] };
}

export interface OsrmResponse {
  code: string;
  message?: string;
  routes?: {
    distance: number;
    duration: number;
    geometry: { coordinates: [number, number][] };
    legs: {
      distance: number;
      duration: number;
      summary?: string;
      steps?: OsrmStep[];
      annotation?: { duration?: number[]; speed?: number[]; distance?: number[] };
    }[];
  }[];
}

const SIDE: Record<string, string> = {
  uturn: 'da la vuelta',
  'sharp right': 'gira bruscamente a la derecha',
  right: 'gira a la derecha',
  'slight right': 'gira ligeramente a la derecha',
  straight: 'sigue recto',
  'slight left': 'gira ligeramente a la izquierda',
  left: 'gira a la izquierda',
  'sharp left': 'gira bruscamente a la izquierda',
};

const KEEP: Record<string, string> = {
  'sharp right': 'derecha',
  right: 'derecha',
  'slight right': 'derecha',
  'sharp left': 'izquierda',
  left: 'izquierda',
  'slight left': 'izquierda',
  straight: 'recto',
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function ordinal(n: number): string {
  return ['', 'primera', 'segunda', 'tercera', 'cuarta', 'quinta', 'sexta', 'séptima', 'octava'][n] ?? `${n}ª`;
}

function roadName(s: { name?: string; ref?: string }): string {
  const ref = s.ref?.split(';')[0]?.trim();
  if (s.name && ref && !s.name.includes(ref)) return `${s.name} (${ref})`;
  return s.name || ref || '';
}

/** Texto de la maniobra en español. */
export function instructionEs(step: Pick<NavStep, 'type' | 'modifier' | 'exit' | 'name' | 'ref' | 'destinations'> & { lastLeg?: boolean }): string {
  const name = roadName(step);
  const toward = step.destinations ? ` hacia ${step.destinations.split(':').pop()!.split(',')[0].trim()}` : '';
  const by = name ? ` por ${name}` : '';
  const m = step.modifier ?? 'straight';
  switch (step.type) {
    case 'depart':
      return `Sal${by || toward}`.trim();
    case 'arrive':
      return step.lastLeg === false ? 'Has llegado a la parada' : 'Has llegado a tu destino';
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return step.exit ? `En la rotonda, toma la ${ordinal(step.exit)} salida${by || toward}` : `Entra en la rotonda${by}`;
    case 'exit roundabout':
    case 'exit rotary':
      return `Sal de la rotonda${by || toward}`;
    case 'merge':
      return `Incorpórate${name ? ` a ${name}` : ''}${toward}`;
    case 'on ramp':
      return `Toma el acceso${name ? ` a ${name}` : ''}${toward}`;
    case 'off ramp':
      return `Toma la salida${m.includes('left') ? ' por la izquierda' : ''}${toward || by}`;
    case 'fork':
      return `En la bifurcación, mantente a la ${KEEP[m] ?? 'derecha'}${toward || by}`;
    case 'end of road':
      return `Al final de la vía, ${SIDE[m] ?? 'gira'}${by}`;
    case 'new name':
    case 'continue':
      if (m === 'straight' || !SIDE[m]) return `Continúa${by}`;
      return `${cap(SIDE[m])}${by}`;
    case 'use lane':
      return `Mantente en el carril ${KEEP[m] ?? ''}${by}`.trim();
    default:
      return `${cap(SIDE[m] ?? 'continúa')}${by}`;
  }
}

/** Instrucción corta para la voz, con distancia. */
export function spokenInstruction(step: NavStep, distanceText?: string): string {
  const base = step.instruction;
  if (!distanceText) return base;
  return `En ${distanceText}, ${base.charAt(0).toLowerCase()}${base.slice(1)}`;
}

function cumulative(coords: [number, number][]): number[] {
  const cum = [0];
  for (let i = 1; i < coords.length; i++) {
    cum.push(cum[i - 1] + distanceM(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  }
  return cum;
}

export function parseOsrm(res: OsrmResponse): NavRoute[] {
  if (res.code !== 'Ok' || !res.routes) throw new Error(res.message ?? `OSRM: ${res.code}`);
  return res.routes.map((r) => {
    const coords = r.geometry.coordinates;
    const cum = cumulative(coords);
    const total = cum[cum.length - 1] || r.distance;
    // Tiempo acumulado: de las anotaciones si cuadran con la geometría; si no, proporcional.
    const durs = r.legs.flatMap((l) => l.annotation?.duration ?? []);
    const speedsRaw = r.legs.flatMap((l) => l.annotation?.speed ?? []);
    const cumTime = [0];
    if (durs.length === coords.length - 1) {
      for (let i = 0; i < durs.length; i++) cumTime.push(cumTime[i] + durs[i]);
    } else {
      for (let i = 1; i < coords.length; i++) cumTime.push((cum[i] / total) * r.duration);
    }
    const speeds =
      speedsRaw.length === coords.length - 1
        ? speedsRaw.map((v) => Math.max(3, Math.min(40, v)))
        : coords.slice(1).map(() => Math.max(3, r.distance / Math.max(1, r.duration)));

    const steps: NavStep[] = [];
    const legEnds: number[] = [];
    let at = 0;
    r.legs.forEach((leg, li) => {
      for (const s of leg.steps ?? []) {
        const step: NavStep = {
          at,
          distance: s.distance,
          duration: s.duration,
          type: s.maneuver.type,
          modifier: s.maneuver.modifier,
          exit: s.maneuver.exit,
          name: s.name || s.rotary_name || undefined,
          ref: s.ref || undefined,
          destinations: s.destinations || undefined,
          location: s.maneuver.location,
          leg: li,
          instruction: '',
        };
        step.instruction = instructionEs({ ...step, lastLeg: li === r.legs.length - 1 });
        steps.push(step);
        at += s.distance;
      }
      legEnds.push(at);
    });
    // Escala las distancias de OSRM a la geometría medida (pueden diferir ligeramente).
    const k = at > 0 ? total / at : 1;
    for (const s of steps) s.at *= k;
    for (let i = 0; i < legEnds.length; i++) legEnds[i] *= k;

    const named = new Map<string, number>();
    for (const s of steps) {
      const key = s.ref?.split(';')[0] || s.name;
      if (key) named.set(key, (named.get(key) ?? 0) + s.distance);
    }
    const summary = [...named.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([n]) => n)
      .join(', ');

    return { coords, cum, cumTime, distance: total, duration: r.duration, steps, legEnds, summary, speeds };
  });
}

export function osrmUrl(points: LatLon[], opts: { alternatives?: boolean; exclude?: string[] } = {}): string {
  const coords = points.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const q = new URLSearchParams({
    overview: 'full',
    geometries: 'geojson',
    steps: 'true',
    annotations: 'duration,speed',
    alternatives: opts.alternatives && points.length === 2 ? '3' : 'false',
  });
  if (opts.exclude?.length) q.set('exclude', opts.exclude.join(','));
  return `https://router.project-osrm.org/route/v1/driving/${coords}?${q}`;
}

export interface Progress {
  /** Distancia recorrida a lo largo de la ruta (m). */
  along: number;
  /** Distancia a la ruta (m). */
  offRoute: number;
  /** Índice del segmento actual. */
  index: number;
  /** Siguiente maniobra. */
  next?: NavStep;
  nextIndex: number;
  toNext: number;
  remaining: number;
  remainingTime: number;
  /** Tramo (parada) en curso. */
  leg: number;
}

function projectSegment(lat: number, lon: number, a: [number, number], b: [number, number]): { d: number; t: number } {
  const kx = Math.cos((lat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const ax = (a[0] - lon) * kx;
  const ay = (a[1] - lat) * ky;
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return { d: Math.hypot(ax + t * dx, ay + t * dy), t };
}

/** Sigue el avance sobre una ruta, con búsqueda local para no "saltar" a tramos paralelos. */
export class RouteFollower {
  private index = 0;

  constructor(public route: NavRoute) {}

  update(lat: number, lon: number): Progress {
    const c = this.route.coords;
    const search = (from: number, to: number) => {
      let best = { i: from, d: Infinity, t: 0 };
      for (let i = Math.max(0, from); i < Math.min(c.length - 1, to); i++) {
        const p = projectSegment(lat, lon, c[i], c[i + 1]);
        if (p.d < best.d) best = { i, d: p.d, t: p.t };
      }
      return best;
    };
    let best = search(this.index - 3, this.index + 250);
    if (best.d > 60) {
      const global = search(0, c.length - 1);
      if (global.d < best.d - 20) best = global;
    }
    this.index = best.i;
    const segLen = this.route.cum[best.i + 1] - this.route.cum[best.i];
    const along = this.route.cum[best.i] + best.t * segLen;
    const timeAt = this.route.cumTime[best.i] + best.t * ((this.route.cumTime[best.i + 1] ?? this.route.cumTime[best.i]) - this.route.cumTime[best.i]);
    const nextIndex = this.route.steps.findIndex((s) => s.at > along + 5);
    const next = nextIndex >= 0 ? this.route.steps[nextIndex] : undefined;
    const leg = this.route.legEnds.findIndex((e) => along < e - 20);
    return {
      along,
      offRoute: best.d,
      index: best.i,
      next,
      nextIndex,
      toNext: next ? next.at - along : this.route.distance - along,
      remaining: Math.max(0, this.route.distance - along),
      remainingTime: Math.max(0, this.route.cumTime[this.route.cumTime.length - 1] - timeAt),
      leg: leg < 0 ? this.route.legEnds.length - 1 : leg,
    };
  }
}

/** Parte de la ruta desde una distancia dada (para curvas y avisos por delante). */
export function sliceRoute(route: NavRoute, from: number, length: number): [number, number][] {
  const out: [number, number][] = [];
  const to = from + length;
  for (let i = 0; i < route.coords.length; i++) {
    if (route.cum[i] < from) continue;
    if (route.cum[i] > to) {
      out.push(route.coords[i]);
      break;
    }
    out.push(route.coords[i]);
  }
  return out;
}

/** Duración "1 h 05 min" / "12 min". */
export function formatDuration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${Math.max(1, m)} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
