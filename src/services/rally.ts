// Modo tramo: curvas clasificadas por severidad, velocidad recomendada en cada
// momento, avisos de curva y cronómetro con tramos configurables y récords.
// La velocidad recomendada nunca supera el límite legal de la vía.

import { computed, signal } from '@preact/signals';
import { adviseSpeed, curveSegments, findCurves, GRADE_LABEL, type CurveAdvice, type CurveGrade } from '../../shared/curves';
import { angleDiff, distanceM } from '../../shared/geo';
import { sliceRoute } from '../../shared/nav';
import { settings } from '../state/settings';
import { road, showToast, type Position } from '../state/store';
import { beep, say } from './audio';
import { onFix } from './geolocation';
import { activeRoute, navActive, progress } from './nav';
import { ahead, roadWays } from './road';
import { load, save } from './storage';

export interface TimedSegment {
  id: string;
  name: string;
  start: { lat: number; lon: number; heading?: number };
  end: { lat: number; lon: number };
  createdAt: string;
}

export interface RunRecord {
  id: string;
  segmentId: string;
  timeMs: number;
  date: string;
  avgKmh: number;
  maxKmh: number;
  /** Muestras [distancia recorrida (m), tiempo (ms)] para comparar en directo. */
  trace: [number, number][];
}

export interface RunState {
  segment: TimedSegment;
  startedAt: number;
  distance: number;
  maxKmh: number;
  trace: [number, number][];
  best?: RunRecord;
}

export const advice = signal<CurveAdvice | null>(null);
export const segments = signal<TimedSegment[]>([]);
export const records = signal<RunRecord[]>([]);
export const run = signal<RunState | null>(null);
export const lastResult = signal<{ segment: string; timeMs: number; best: boolean; deltaMs?: number } | null>(null);
export const stopwatch = signal<{ running: boolean; startedAt: number; accumulated: number; laps: number[] }>({ running: false, startedAt: 0, accumulated: 0, laps: [] });
export const pendingStart = signal<TimedSegment['start'] | null>(null);
/** Tic de 100 ms para refrescar cronómetros en pantalla. */
export const clock = signal(Date.now());

const SEG_KEY = 'rally:segments';
const REC_KEY = 'rally:records';

void (async () => {
  segments.value = (await load<TimedSegment[]>(SEG_KEY)) ?? [];
  records.value = (await load<RunRecord[]>(REC_KEY)) ?? [];
})();

setInterval(() => {
  if (run.peek() || stopwatch.peek().running) clock.value = Date.now();
}, 100);

export function bestFor(segmentId: string): RunRecord | undefined {
  return records.value.filter((r) => r.segmentId === segmentId).sort((a, b) => a.timeMs - b.timeMs)[0];
}

export async function addSegment(seg: Omit<TimedSegment, 'id' | 'createdAt'>): Promise<void> {
  segments.value = [...segments.value, { ...seg, id: crypto.randomUUID?.() ?? String(Date.now()), createdAt: new Date().toISOString() }];
  await save(SEG_KEY, segments.value);
}

export async function removeSegment(id: string): Promise<void> {
  segments.value = segments.value.filter((s) => s.id !== id);
  records.value = records.value.filter((r) => r.segmentId !== id);
  await save(SEG_KEY, segments.value);
  await save(REC_KEY, records.value);
}

export async function renameSegment(id: string, name: string): Promise<void> {
  segments.value = segments.value.map((s) => (s.id === id ? { ...s, name } : s));
  await save(SEG_KEY, segments.value);
}

export function cancelRun(): void {
  run.value = null;
}

// ---------------------------------------------------------------------------
// Cronómetro manual

export function toggleStopwatch(): void {
  const sw = stopwatch.value;
  stopwatch.value = sw.running
    ? { ...sw, running: false, accumulated: sw.accumulated + (Date.now() - sw.startedAt) }
    : { ...sw, running: true, startedAt: Date.now() };
}

export function lapStopwatch(): void {
  const sw = stopwatch.value;
  if (!sw.running) return;
  stopwatch.value = { ...sw, laps: [...sw.laps, sw.accumulated + (Date.now() - sw.startedAt)] };
}

export function resetStopwatch(): void {
  stopwatch.value = { running: false, startedAt: 0, accumulated: 0, laps: [] };
}

export function stopwatchMs(now = clock.value): number {
  const sw = stopwatch.value;
  return sw.accumulated + (sw.running ? now - sw.startedAt : 0);
}

export function formatLap(ms: number): string {
  const total = Math.max(0, ms) / 1000;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

/** Diferencia con el récord a la misma distancia (ms; negativo = más rápido). */
export function liveDelta(r: RunState, now = clock.value): number | undefined {
  const best = r.best;
  if (!best || best.trace.length < 2) return undefined;
  const t = best.trace;
  const d = r.distance;
  let i = t.findIndex(([dist]) => dist >= d);
  if (i <= 0) i = i === 0 ? 1 : t.length - 1;
  const [d0, t0] = t[i - 1];
  const [d1, t1] = t[i];
  const bestAt = d1 === d0 ? t1 : t0 + ((d - d0) / (d1 - d0)) * (t1 - t0);
  return now - r.startedAt - bestAt;
}

// ---------------------------------------------------------------------------
// Curvas

/** Camino por delante: la ruta activa si se navega, si no el previsto por la vía. */
const pathLine = computed<[number, number][] | null>(() => {
  const r = activeRoute.value;
  const prog = progress.value;
  if (navActive.value && r && prog) return sliceRoute(r, prog.along, 1500);
  return ahead.value?.coords ?? null;
});

/** Curvas de las vías de la zona, coloreadas (capa del mapa). */
export const areaCurves = computed(() => {
  const s = settings.value;
  if (!s.rallyMode || !s.showCurves) return [] as { coords: [number, number][]; grade: CurveGrade }[];
  const out: { coords: [number, number][]; grade: CurveGrade }[] = [];
  for (const w of roadWays.value) {
    if (/footway|path|track|service/.test(w.tags.highway ?? '')) continue;
    out.push(...curveSegments(w.geometry.map((g) => [g.lon, g.lat] as [number, number])));
  }
  const r = activeRoute.value;
  if (r) out.push(...curveSegments(r.coords.length > 4000 ? sliceRoute(r, progress.value?.along ?? 0, 15_000) : r.coords));
  return out;
});

const announced = new Set<string>();
let lastWarn = 0;

function curveKey(c: { apexCoord: [number, number] }): string {
  return `${c.apexCoord[0].toFixed(4)},${c.apexCoord[1].toFixed(4)}`;
}

function handleCurves(p: Position): void {
  const s = settings.peek();
  if (!s.rallyMode) {
    if (advice.peek()) advice.value = null;
    return;
  }
  const line = pathLine.peek();
  if (!line || line.length < 2) {
    advice.value = null;
    return;
  }
  const { curves } = findCurves(line);
  const legal = road.peek()?.maxspeed ?? 200;
  const a = adviseSpeed(curves, 0, s.rallyProfile, 1200, legal);
  advice.value = a;
  const kmh = (p.speed ?? 0) * 3.6;
  const next = a.next;
  if (!next || kmh < 15) return;
  const key = curveKey(next);
  const noteDistance = Math.max(80, (p.speed ?? 0) * 6);
  const target = Math.min(Math.round(next.targetKmh / 5) * 5, legal);
  const side = next.direction === 'left' ? 'izquierda' : 'derecha';
  if (s.rallyVoice && next.distance <= noteDistance && next.grade >= 3 && !announced.has(key)) {
    announced.add(key);
    if (announced.size > 300) announced.clear();
    say(`${side === 'izquierda' ? 'Izquierda' : 'Derecha'} ${GRADE_LABEL[next.grade]}, ${target}`);
  }
  const lim = a.limiting;
  if (s.rallyWarn && lim && kmh > a.recommendedKmh + 8 && lim.distance < 400 && Date.now() - lastWarn > 4000) {
    lastWarn = Date.now();
    beep('overspeed');
    if (!s.rallyVoice) say(`Curva ${GRADE_LABEL[lim.grade]} a la ${lim.direction === 'left' ? 'izquierda' : 'derecha'}, reduce`);
  }
}

// ---------------------------------------------------------------------------
// Tramos cronometrados

const GATE_M = 25;
let lastFix: Position | null = null;
let cooldownUntil = 0;

function handleTiming(p: Position): void {
  const r = run.peek();
  const kmh = (p.speed ?? 0) * 3.6;
  if (r) {
    if (lastFix) {
      const step = distanceM(lastFix.lat, lastFix.lon, p.lat, p.lon);
      if (step < 1000) r.distance += step;
    }
    r.maxKmh = Math.max(r.maxKmh, kmh);
    const elapsed = Date.now() - r.startedAt;
    const lastSample = r.trace[r.trace.length - 1];
    if (!lastSample || r.distance - lastSample[0] >= 25) r.trace.push([Math.round(r.distance), elapsed]);
    const dEnd = distanceM(p.lat, p.lon, r.segment.end.lat, r.segment.end.lon);
    if (dEnd <= GATE_M && r.distance > 50) {
      void finishRun(r, elapsed);
    } else if (elapsed > 2 * 3600_000) {
      run.value = null;
    } else {
      run.value = { ...r };
    }
  } else if (Date.now() > cooldownUntil && kmh > 3) {
    for (const seg of segments.peek()) {
      const d = distanceM(p.lat, p.lon, seg.start.lat, seg.start.lon);
      if (d > GATE_M) continue;
      if (seg.start.heading != null && p.heading != null && angleDiff(seg.start.heading, p.heading) > 70) continue;
      run.value = { segment: seg, startedAt: Date.now(), distance: 0, maxKmh: kmh, trace: [[0, 0]], best: bestFor(seg.id) };
      beep('section');
      say(`Salida: ${seg.name}`);
      break;
    }
  }
  lastFix = p;
}

async function finishRun(r: RunState, timeMs: number): Promise<void> {
  run.value = null;
  cooldownUntil = Date.now() + 20_000;
  const prevBest = r.best;
  const rec: RunRecord = {
    id: crypto.randomUUID?.() ?? String(Date.now()),
    segmentId: r.segment.id,
    timeMs,
    date: new Date().toISOString(),
    avgKmh: (r.distance / (timeMs / 1000)) * 3.6,
    maxKmh: r.maxKmh,
    trace: r.trace,
  };
  const isBest = !prevBest || timeMs < prevBest.timeMs;
  // Se guardan las 10 mejores de cada tramo.
  const mine = [...records.value.filter((x) => x.segmentId === r.segment.id), rec].sort((a, b) => a.timeMs - b.timeMs).slice(0, 10);
  records.value = [...records.value.filter((x) => x.segmentId !== r.segment.id), ...mine];
  await save(REC_KEY, records.value);
  lastResult.value = { segment: r.segment.name, timeMs, best: isBest, deltaMs: prevBest ? timeMs - prevBest.timeMs : undefined };
  beep('section');
  const secs = Math.round(timeMs / 100) / 10;
  const m = Math.floor(secs / 60);
  const sec = (secs - m * 60).toFixed(1).replace('.', ',');
  say(`Llegada. ${m ? `${m} minuto${m > 1 ? 's' : ''} ` : ''}${sec} segundos${isBest ? '. Nuevo récord' : ''}`);
  showToast(isBest ? `¡Récord en ${r.segment.name}!` : `Tiempo: ${formatLap(timeMs)}`);
}

export function startRallyService(): void {
  onFix((p) => {
    handleCurves(p);
    if (settings.peek().rallyMode) handleTiming(p);
  });
}
