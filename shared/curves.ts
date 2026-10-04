// Análisis de curvas sobre una polilínea: radio, dirección, clasificación por
// severidad y velocidad máxima recomendada (aceleración lateral admisible).

const DEG = Math.PI / 180;

export interface Resampled {
  /** Coordenadas [lon, lat] cada `step` metros. */
  coords: [number, number][];
  /** Distancia acumulada de cada punto (m). */
  dist: number[];
}

/** Remuestrea una polilínea a puntos equiespaciados (proyección local). */
export function resample(line: [number, number][], step = 10): Resampled {
  if (line.length < 2) return { coords: [...line], dist: line.map(() => 0) };
  const lat0 = line[0][1] * DEG;
  const kx = Math.cos(lat0) * 111_320;
  const ky = 110_540;
  const coords: [number, number][] = [line[0]];
  const dist: number[] = [0];
  let acc = 0;
  let next = step;
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, ay] = line[i];
    const [bx, by] = line[i + 1];
    const seg = Math.hypot((bx - ax) * kx, (by - ay) * ky);
    if (seg === 0) continue;
    while (next <= acc + seg) {
      const t = (next - acc) / seg;
      coords.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
      dist.push(next);
      next += step;
    }
    acc += seg;
  }
  const last = line[line.length - 1];
  if (acc - dist[dist.length - 1] > step * 0.3) {
    coords.push(last);
    dist.push(acc);
  }
  return { coords, dist };
}

/**
 * Radio con signo en cada punto (m). Positivo = curva a la izquierda,
 * negativo = a la derecha, Infinity = recta. Usa la circunferencia que pasa
 * por los puntos situados `span` metros antes y después.
 */
export function signedRadii(r: Resampled, span = 25): number[] {
  const n = r.coords.length;
  const out = new Array<number>(n).fill(Infinity);
  if (n < 3) return out;
  const step = r.dist.length > 1 ? r.dist[1] - r.dist[0] || 10 : 10;
  const k = Math.max(1, Math.round(span / step));
  const lat0 = r.coords[0][1] * DEG;
  const kx = Math.cos(lat0) * 111_320;
  const ky = 110_540;
  for (let i = k; i < n - k; i++) {
    const [ax, ay] = r.coords[i - k];
    const [bx, by] = r.coords[i];
    const [cx, cy] = r.coords[i + k];
    const x1 = (bx - ax) * kx;
    const y1 = (by - ay) * ky;
    const x2 = (cx - ax) * kx;
    const y2 = (cy - ay) * ky;
    const cross = x1 * y2 - y1 * x2;
    const a = Math.hypot(x1, y1);
    const b = Math.hypot((cx - bx) * kx, (cy - by) * ky);
    const c = Math.hypot(x2, y2);
    if (Math.abs(cross) < 1e-6) continue;
    const R = (a * b * c) / (2 * Math.abs(cross));
    out[i] = cross > 0 ? R : -R;
  }
  return out;
}

export type CurveGrade = 1 | 2 | 3 | 4 | 5 | 6;

/** 1 = muy suave … 6 = horquilla. */
export function gradeForRadius(radius: number): CurveGrade | 0 {
  const R = Math.abs(radius);
  if (R >= 450) return 0;
  if (R >= 300) return 1;
  if (R >= 180) return 2;
  if (R >= 110) return 3;
  if (R >= 65) return 4;
  if (R >= 35) return 5;
  return 6;
}

export const GRADE_LABEL: Record<CurveGrade, string> = {
  1: 'muy suave',
  2: 'suave',
  3: 'media',
  4: 'cerrada',
  5: 'muy cerrada',
  6: 'horquilla',
};

export const GRADE_COLOR: Record<CurveGrade, string> = {
  1: '#22c55e',
  2: '#84cc16',
  3: '#eab308',
  4: '#f97316',
  5: '#ef4444',
  6: '#a21caf',
};

export interface Curve {
  /** Distancia (m) desde el inicio de la polilínea. */
  start: number;
  end: number;
  apex: number;
  minRadius: number;
  direction: 'left' | 'right';
  grade: CurveGrade;
  /** Ángulo total girado (grados). */
  angle: number;
  apexCoord: [number, number];
}

/** Detecta curvas: tramos con radio menor que `threshold`. */
export function findCurves(line: [number, number][], opts: { step?: number; span?: number; threshold?: number } = {}): { curves: Curve[]; resampled: Resampled; radii: number[] } {
  const step = opts.step ?? 10;
  const r = resample(line, step);
  const radii = signedRadii(r, opts.span ?? 25);
  const threshold = opts.threshold ?? 450;
  const curves: Curve[] = [];
  let i = 0;
  while (i < radii.length) {
    if (Math.abs(radii[i]) >= threshold) {
      i++;
      continue;
    }
    const sign = Math.sign(radii[i]);
    let j = i;
    let apex = i;
    let angle = 0;
    while (j < radii.length && Math.abs(radii[j]) < threshold && Math.sign(radii[j]) === sign) {
      if (Math.abs(radii[j]) < Math.abs(radii[apex])) apex = j;
      angle += step / Math.abs(radii[j]);
      j++;
    }
    const minRadius = Math.abs(radii[apex]);
    const grade = gradeForRadius(minRadius);
    if (grade > 0 && angle / DEG >= 12) {
      curves.push({
        start: r.dist[i],
        end: r.dist[Math.min(j, r.dist.length - 1)],
        apex: r.dist[apex],
        minRadius,
        direction: sign > 0 ? 'left' : 'right',
        grade: grade as CurveGrade,
        angle: angle / DEG,
        apexCoord: r.coords[apex],
      });
    }
    i = j;
  }
  return { curves, resampled: r, radii };
}

/** Aceleración lateral admisible (m/s²) por perfil de conducción. */
export const PROFILE_LATERAL: Record<RallyProfile, number> = {
  tranquilo: 2.5,
  normal: 3.5,
  deportivo: 5,
  tope: 7,
};

/** Deceleración usada para calcular la frenada antes de la curva (m/s²). */
export const PROFILE_BRAKE: Record<RallyProfile, number> = {
  tranquilo: 2.5,
  normal: 3.5,
  deportivo: 5.5,
  tope: 7.5,
};

export type RallyProfile = 'tranquilo' | 'normal' | 'deportivo' | 'tope';

/** Velocidad máxima (km/h) para tomar una curva de radio R. */
export function curveSpeedKmh(radius: number, profile: RallyProfile): number {
  return Math.min(200, Math.sqrt(PROFILE_LATERAL[profile] * Math.abs(radius)) * 3.6);
}

export interface CurveAdvice {
  /** Velocidad recomendada ahora mismo (km/h), para llegar a la próxima curva a su velocidad. */
  recommendedKmh: number;
  /** Curva que limita la velocidad (si alguna). */
  limiting?: Curve & { distance: number; targetKmh: number };
  /** Siguiente curva relevante por delante. */
  next?: Curve & { distance: number; targetKmh: number };
}

/**
 * Consejo de velocidad: para cada curva por delante, la velocidad máxima ahora
 * es la que permite frenar hasta la velocidad de la curva antes de su vértice.
 */
export function adviseSpeed(curves: Curve[], along: number, profile: RallyProfile, horizon = 1500, maxKmh = 200): CurveAdvice {
  const brake = PROFILE_BRAKE[profile];
  let rec = maxKmh;
  let limiting: CurveAdvice['limiting'];
  let next: CurveAdvice['next'];
  for (const c of curves) {
    if (c.end < along) continue;
    const distance = Math.max(0, c.apex - along - 10);
    if (distance > horizon) break;
    const target = curveSpeedKmh(c.minRadius, profile);
    const vc = target / 3.6;
    const allowed = Math.sqrt(vc * vc + 2 * brake * distance) * 3.6;
    const item = { ...c, distance, targetKmh: target };
    if (!next && c.grade >= 2) next = item;
    if (allowed < rec) {
      rec = allowed;
      limiting = item;
    }
  }
  return { recommendedKmh: rec, limiting, next };
}

/** Segmentos coloreados por severidad para pintar en el mapa. */
export function curveSegments(line: [number, number][]): { coords: [number, number][]; grade: CurveGrade }[] {
  const { curves, resampled } = findCurves(line);
  const out: { coords: [number, number][]; grade: CurveGrade }[] = [];
  for (const c of curves) {
    const pts = resampled.coords.filter((_, i) => resampled.dist[i] >= c.start - 5 && resampled.dist[i] <= c.end + 5);
    if (pts.length >= 2) out.push({ coords: pts, grade: c.grade });
  }
  return out;
}
