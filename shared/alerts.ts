// Motor de avisos: decide qué radares / avisos están "por delante" del conductor
// y en qué fase está cada uno (aproximación, cerca, superado). Es lógica pura,
// sin dependencias del navegador, para poder probarla con rutas simuladas.

import { angleDiff, bearingDeg, distanceM, lineLengthM, projectOnLine } from './geo';

export interface Fix {
  lat: number;
  lon: number;
  /** Velocidad en m/s; null si se desconoce. */
  speed: number | null;
  /** Rumbo en grados; null si se desconoce. */
  heading: number | null;
  /** Precisión horizontal (m). */
  accuracy?: number;
  /** Marca de tiempo (ms). */
  time: number;
}

export interface Target {
  id: string;
  lat: number;
  lon: number;
  /** Rumbo del tráfico al que afecta, si se conoce. */
  heading?: number;
  /** Tolerancia al comparar rumbos (grados). */
  headingTolerance?: number;
}

export interface ProximityOptions {
  /** Distancia mínima de primer aviso (m). */
  minDistance: number;
  /** Distancia máxima de primer aviso (m). */
  maxDistance: number;
  /** Segundos de antelación del primer aviso a la velocidad actual. */
  secondsAhead: number;
  /** Semiancho del cono "por delante" (grados). */
  coneDeg: number;
  /** Segundos de antelación del segundo aviso ("cerca"). */
  closeSeconds: number;
  /** Distancia mínima del segundo aviso (m). */
  minCloseDistance: number;
  /** Por debajo de esta velocidad (m/s) no se disparan avisos nuevos. */
  minSpeedMs: number;
}

export const DEFAULT_PROXIMITY: ProximityOptions = {
  minDistance: 400,
  maxDistance: 2000,
  secondsAhead: 40,
  coneDeg: 30,
  closeSeconds: 12,
  minCloseDistance: 200,
  minSpeedMs: 1.5,
};

export type Stage = 'approach' | 'close' | 'passed';

export interface ProximityHit<T> {
  target: T;
  distance: number;
  bearing: number;
  stage: 'approach' | 'close';
  firstSeen: number;
}

export interface ProximityEvent<T> {
  type: Stage;
  target: T;
  distance: number;
}

interface TrackState<T> {
  stage: Stage;
  minDist: number;
  firstSeen: number;
  target: T;
  /** true si se descartó sin llegar a pasar (giro, cambio de vía). */
  silent?: boolean;
}

/** Desplazamiento lateral admitido (m): ancho de calzada + error del GPS. */
const LATERAL_TOLERANCE_M = 40;

export function lookaheadDistance(speedMs: number | null, o: ProximityOptions): number {
  const v = speedMs ?? 0;
  return Math.min(o.maxDistance, Math.max(o.minDistance, v * o.secondsAhead));
}

export function closeDistance(speedMs: number | null, o: ProximityOptions): number {
  return Math.max(o.minCloseDistance, (speedMs ?? 0) * o.closeSeconds);
}

/** ¿Está el objetivo dentro del cono de avance? */
export function isAhead(fix: Fix, target: { lat: number; lon: number }, coneDeg: number, distance?: number): boolean {
  if (fix.heading == null) return false;
  const d = distance ?? distanceM(fix.lat, fix.lon, target.lat, target.lon);
  const rel = angleDiff(fix.heading, bearingDeg(fix.lat, fix.lon, target.lat, target.lon));
  const allowed = Math.max(coneDeg, (Math.atan2(LATERAL_TOLERANCE_M, Math.max(d, 1)) * 180) / Math.PI);
  return rel <= allowed;
}

export function headingMatches(fixHeading: number | null, target: Target): boolean {
  if (target.heading == null || fixHeading == null) return true;
  return angleDiff(fixHeading, target.heading) <= (target.headingTolerance ?? 60);
}

/**
 * Sigue la aproximación a un conjunto de objetivos (radares, avisos...).
 * Cada objetivo se avisa una vez al entrar en la distancia de aviso, otra al
 * acercarse, y se marca como superado al dejarlo atrás. Se vuelve a poder
 * avisar cuando el conductor se aleja lo suficiente.
 */
export class ProximityTracker<T extends Target> {
  private states = new Map<string, TrackState<T>>();

  constructor(public opts: ProximityOptions = DEFAULT_PROXIMITY) {}

  reset(): void {
    this.states.clear();
  }

  update(fix: Fix, candidates: T[]): { hits: ProximityHit<T>[]; events: ProximityEvent<T>[] } {
    const o = this.opts;
    const look = lookaheadDistance(fix.speed, o);
    const close = closeDistance(fix.speed, o);
    const moving = fix.speed != null && fix.speed >= o.minSpeedMs && fix.heading != null;
    const slack = Math.max(60, Math.min(150, (fix.accuracy ?? 20) * 2));
    const hits: ProximityHit<T>[] = [];
    const events: ProximityEvent<T>[] = [];
    const seen = new Set<string>();

    for (const t of candidates) {
      seen.add(t.id);
      const d = distanceM(fix.lat, fix.lon, t.lat, t.lon);
      const bearing = bearingDeg(fix.lat, fix.lon, t.lat, t.lon);
      let st = this.states.get(t.id);

      if (!st) {
        if (!moving || d > look) continue;
        if (!isAhead(fix, t, o.coneDeg, d) || !headingMatches(fix.heading, t)) continue;
        const stage: Stage = d <= close ? 'close' : 'approach';
        st = { stage, minDist: d, firstSeen: fix.time, target: t };
        this.states.set(t.id, st);
        events.push({ type: stage, target: t, distance: d });
        hits.push({ target: t, distance: d, bearing, stage, firstSeen: st.firstSeen });
        continue;
      }

      st.target = t;
      if (st.stage === 'passed') {
        if (d > look * 1.3 + 200) this.states.delete(t.id);
        continue;
      }

      const rel = fix.heading != null ? angleDiff(fix.heading, bearing) : 0;
      const behind = moving && rel > 100 && d < Math.max(300, close * 1.5);
      const receding = d > st.minDist + slack;
      if (behind || receding) {
        const reallyPassed = st.minDist <= Math.max(close, 250);
        st.stage = 'passed';
        st.silent = !reallyPassed;
        if (reallyPassed) events.push({ type: 'passed', target: t, distance: d });
        continue;
      }
      // Ha dejado de estar delante (giro): se descarta sin aviso.
      if (moving && d > close && !isAhead(fix, t, o.coneDeg * 2.5, d)) {
        st.stage = 'passed';
        st.silent = true;
        continue;
      }

      st.minDist = Math.min(st.minDist, d);
      if (st.stage === 'approach' && d <= close) {
        st.stage = 'close';
        events.push({ type: 'close', target: t, distance: d });
      }
      hits.push({ target: t, distance: d, bearing, stage: st.stage, firstSeen: st.firstSeen });
    }

    for (const id of [...this.states.keys()]) if (!seen.has(id)) this.states.delete(id);
    hits.sort((a, b) => a.distance - b.distance);
    return { hits, events };
  }
}

// ---------------------------------------------------------------------------
// Tramos de velocidad media

export interface SectionDef {
  id: string;
  /** [lon, lat][] desde la primera cámara hasta la última. */
  coords: [number, number][];
  maxspeed?: number;
  name?: string;
  road?: string;
}

export interface SectionStatus {
  section: SectionDef;
  /** Extremo de entrada: 0 = coords[0], 1 = último punto. */
  entry: 0 | 1;
  enteredAt: number;
  elapsedS: number;
  distanceM: number;
  remainingM: number;
  lengthM: number;
  avgKmh: number;
  limit?: number;
  /** Velocidad media necesaria en lo que queda para acabar justo en el límite. */
  targetKmh?: number;
  progress: number;
  over: boolean;
}

export interface SectionSummary {
  section: SectionDef;
  avgKmh: number;
  elapsedS: number;
  distanceM: number;
  limit?: number;
  over: boolean;
}

export interface SectionOptions {
  entryRadius: number;
  exitRadius: number;
  /** Tolerancia de rumbo al entrar (grados). */
  entryHeadingTolerance: number;
}

export const DEFAULT_SECTION: SectionOptions = {
  entryRadius: 90,
  exitRadius: 90,
  entryHeadingTolerance: 75,
};

interface ActiveSection {
  section: SectionDef;
  entry: 0 | 1;
  enteredAt: number;
  odometer: number;
  last: Fix;
  chordLength: number;
  nearExit: boolean;
  minExitDist: number;
}

/** Calcula la velocidad media dentro de un tramo como lo haría el radar. */
export class SectionTracker {
  private active: ActiveSection | null = null;

  constructor(public opts: SectionOptions = DEFAULT_SECTION) {}

  get current(): SectionDef | null {
    return this.active?.section ?? null;
  }

  reset(): void {
    this.active = null;
  }

  update(
    fix: Fix,
    sections: SectionDef[],
  ): { status: SectionStatus | null; entered?: SectionDef; exited?: SectionSummary; aborted?: SectionDef } {
    if (!this.active) {
      const entered = this.tryEnter(fix, sections);
      if (!entered) return { status: null };
      return { status: this.status(fix), entered };
    }

    const a = this.active;
    const step = distanceM(a.last.lat, a.last.lon, fix.lat, fix.lon);
    if ((fix.accuracy ?? 0) < 100 && step < 2000) a.odometer += step;
    a.last = fix;

    const exitPt = a.entry === 0 ? a.section.coords[a.section.coords.length - 1] : a.section.coords[0];
    const dExit = distanceM(fix.lat, fix.lon, exitPt[1], exitPt[0]);
    const proj = projectOnLine(fix.lat, fix.lon, a.section.coords);
    const offRoute = proj.distance > Math.max(1500, a.chordLength * 0.3);
    const elapsedS = (fix.time - a.enteredAt) / 1000;
    if (offRoute || elapsedS > 3 * 3600) {
      this.active = null;
      return { status: null, aborted: a.section };
    }

    if (dExit <= this.opts.exitRadius) a.nearExit = true;
    if (a.nearExit && (dExit > a.minExitDist + 25 || dExit > this.opts.exitRadius * 1.5)) {
      const summary = this.summary(fix);
      this.active = null;
      return { status: null, exited: summary };
    }
    a.minExitDist = Math.min(a.minExitDist, dExit);
    return { status: this.status(fix) };
  }

  private tryEnter(fix: Fix, sections: SectionDef[]): SectionDef | null {
    if (fix.heading == null || (fix.speed ?? 0) < 2) return null;
    for (const s of sections) {
      if (s.coords.length < 2) continue;
      const ends: [0 | 1, [number, number], [number, number]][] = [
        [0, s.coords[0], s.coords[1]],
        [1, s.coords[s.coords.length - 1], s.coords[s.coords.length - 2]],
      ];
      for (const [entry, pt, next] of ends) {
        const d = distanceM(fix.lat, fix.lon, pt[1], pt[0]);
        if (d > this.opts.entryRadius) continue;
        const towards = bearingDeg(pt[1], pt[0], next[1], next[0]);
        if (angleDiff(fix.heading, towards) > this.opts.entryHeadingTolerance) continue;
        const chord = lineLengthM(s.coords);
        this.active = {
          section: s,
          entry,
          enteredAt: fix.time,
          odometer: 0,
          last: fix,
          chordLength: chord,
          nearExit: false,
          minExitDist: Infinity,
        };
        return s;
      }
    }
    return null;
  }

  private status(fix: Fix): SectionStatus {
    const a = this.active!;
    const coords = a.entry === 0 ? a.section.coords : [...a.section.coords].reverse();
    const proj = projectOnLine(fix.lat, fix.lon, coords);
    // La geometría publicada suele ser una recta entre cámaras: se corrige con la
    // relación real recorrido/proyectado cuando ya hay suficiente recorrido.
    const ratio = proj.along > 300 ? Math.min(1.6, Math.max(1, a.odometer / proj.along)) : 1.05;
    const remainingM = Math.max(0, (proj.length - proj.along) * ratio);
    const lengthM = a.odometer + remainingM;
    const elapsedS = Math.max(0, (fix.time - a.enteredAt) / 1000);
    const avgKmh = elapsedS >= 3 ? (a.odometer / elapsedS) * 3.6 : (fix.speed ?? 0) * 3.6;
    const limit = a.section.maxspeed;
    let targetKmh: number | undefined;
    if (limit) {
      const allowedS = lengthM / (limit / 3.6);
      const leftS = allowedS - elapsedS;
      targetKmh = leftS > 0 ? Math.min(250, (remainingM / leftS) * 3.6) : 0;
    }
    return {
      section: a.section,
      entry: a.entry,
      enteredAt: a.enteredAt,
      elapsedS,
      distanceM: a.odometer,
      remainingM,
      lengthM,
      avgKmh,
      limit,
      targetKmh,
      progress: lengthM > 0 ? Math.min(1, a.odometer / lengthM) : 0,
      over: limit != null && avgKmh > limit,
    };
  }

  private summary(fix: Fix): SectionSummary {
    const a = this.active!;
    const elapsedS = Math.max(1, (fix.time - a.enteredAt) / 1000);
    const avgKmh = (a.odometer / elapsedS) * 3.6;
    return {
      section: a.section,
      avgKmh,
      elapsedS,
      distanceM: a.odometer,
      limit: a.section.maxspeed,
      over: a.section.maxspeed != null && avgKmh > a.section.maxspeed,
    };
  }
}

// ---------------------------------------------------------------------------
// Tramos con radar móvil (corredores)

export interface CorridorDef {
  id: string;
  coords: [number, number][];
  road?: string;
}

/** Normaliza una referencia de carretera para compararla ("CM 220" == "CM-220"). */
export function normalizeRoadRef(ref: string | undefined | null): string {
  return (ref ?? '').toUpperCase().replace(/[\s._-]+/g, '');
}

/**
 * Corredores (p. ej. tramos de radar móvil) por los que se está circulando.
 * Si se conoce la carretera actual, se exige que coincida; si no, se exige
 * estar muy cerca de la geometría publicada.
 */
export function corridorsAt<T extends CorridorDef>(lat: number, lon: number, corridors: T[], roadRefs: string[] = []): T[] {
  const refs = roadRefs.map(normalizeRoadRef).filter(Boolean);
  const out: T[] = [];
  for (const c of corridors) {
    if (c.coords.length < 2) continue;
    const proj = projectOnLine(lat, lon, c.coords);
    const corridor = Math.max(400, proj.length * 0.2);
    if (proj.distance > corridor) continue;
    const road = normalizeRoadRef(c.road);
    if (refs.length && road) {
      if (refs.some((r) => r === road)) out.push(c);
    } else if (proj.distance <= 150) {
      out.push(c);
    }
  }
  return out;
}

export function isOverspeed(speedKmh: number, limit: number | undefined, toleranceKmh: number): boolean {
  return limit != null && speedKmh > limit + toleranceKmh;
}
