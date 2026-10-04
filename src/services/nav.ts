// Navegación tipo Waze / Google Maps: búsqueda, rutas con paradas y alternativas,
// guiado por voz, recálculo al salirse de la ruta.

import { computed, signal } from '@preact/signals';
import { nominatimUrl, parseCoordinates, parseNominatim, parsePhoton, photonUrl, type Place } from '../../shared/geocode';
import { GridIndex, projectOnLine } from '../../shared/geo';
import { osrmUrl, parseOsrm, RouteFollower, type NavRoute, type OsrmResponse, type Progress } from '../../shared/nav';
import type { Radar } from '../../shared/types';
import { settings } from '../state/settings';
import { position, showToast, type Position } from '../state/store';
import { apiBase, apiHeaders } from './api';
import { beep, say, spokenDistance } from './audio';
import { hasServer } from './data';
import { allRadars } from './engine';
import { onFix } from './geolocation';
import { load, save } from './storage';

export interface PlanRoute extends NavRoute {
  radarCount: number;
}

/** Paradas intermedias y destino. El origen es la posición actual. */
export const stops = signal<Place[]>([]);
export const destination = signal<Place | null>(null);
export const routes = signal<PlanRoute[]>([]);
export const selectedRoute = signal(0);
export const planning = signal<{ loading: boolean; error?: string }>({ loading: false });
export const navActive = signal(false);
export const progress = signal<Progress | null>(null);
export const recents = signal<Place[]>([]);
export const favorites = signal<{ home?: Place; work?: Place }>({});

export const activeRoute = computed<PlanRoute | null>(() => routes.value[selectedRoute.value] ?? null);

const RECENTS_KEY = 'nav:recents';
const FAV_KEY = 'nav:favorites';

void (async () => {
  recents.value = (await load<Place[]>(RECENTS_KEY)) ?? [];
  favorites.value = (await load<{ home?: Place; work?: Place }>(FAV_KEY)) ?? {};
})();

export async function setFavorite(kind: 'home' | 'work', place: Place): Promise<void> {
  favorites.value = { ...favorites.value, [kind]: place };
  await save(FAV_KEY, favorites.value);
}

function remember(p: Place): void {
  recents.value = [p, ...recents.value.filter((x) => x.id !== p.id)].slice(0, 10);
  void save(RECENTS_KEY, recents.value);
}

// ---------------------------------------------------------------------------
// Búsqueda

export async function searchPlaces(q: string): Promise<Place[]> {
  const xy = parseCoordinates(q);
  if (xy) return [xy];
  const p = position.peek();
  const near = p ? { lat: p.lat, lon: p.lon } : undefined;
  if (hasServer()) {
    try {
      const qs = new URLSearchParams({ q, ...(near ? { lat: String(near.lat), lon: String(near.lon) } : {}) });
      const res = await fetch(`${apiBase()}/api/geocode?${qs}`, { headers: apiHeaders() });
      if (res.ok) {
        const data = (await res.json()) as { places: Place[] };
        if (data.places.length) return data.places;
      }
    } catch {
      // búsqueda directa
    }
  }
  try {
    const r = await fetch(photonUrl(q, near));
    if (r.ok) {
      const places = parsePhoton(await r.json());
      if (places.length) return places;
    }
  } catch {
    // Nominatim
  }
  const r = await fetch(nominatimUrl(q, near));
  if (!r.ok) throw new Error(`Búsqueda: HTTP ${r.status}`);
  return parseNominatim(await r.json());
}

// ---------------------------------------------------------------------------
// Cálculo de rutas

async function fetchOsrm(points: { lat: number; lon: number }[], alternatives: boolean, exclude: string[]): Promise<OsrmResponse> {
  if (hasServer()) {
    try {
      const qs = new URLSearchParams({
        points: points.map((p) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`).join(';'),
        alt: alternatives ? '1' : '0',
        exclude: exclude.join(','),
      });
      const res = await fetch(`${apiBase()}/api/route?${qs}`, { headers: apiHeaders() });
      const data = (await res.json()) as OsrmResponse;
      if (data.code === 'Ok') return data;
      if (data.code !== 'Error') return data;
    } catch {
      // directo
    }
  }
  const res = await fetch(osrmUrl(points, { alternatives, exclude }));
  return (await res.json()) as OsrmResponse;
}

/** Radares a menos de 40 m del trazado. */
function countRadars(route: NavRoute, radars: Radar[]): number {
  const idx = new GridIndex<Radar>(0.02);
  for (const r of radars) idx.add(r);
  const seen = new Set<string>();
  for (let i = 0; i < route.coords.length; i++) {
    if (i % 3 !== 0 && i !== route.coords.length - 1) continue;
    const [lon, lat] = route.coords[i];
    for (const r of idx.near(lat, lon, 250)) {
      if (seen.has(r.id)) continue;
      if (projectOnLine(r.lat, r.lon, route.coords.slice(Math.max(0, i - 6), i + 7)).distance <= 40) seen.add(r.id);
    }
  }
  return seen.size;
}

export async function planRoutes(origin?: { lat: number; lon: number }): Promise<void> {
  const dest = destination.value;
  const from = origin ?? (position.peek() ? { lat: position.peek()!.lat, lon: position.peek()!.lon } : null);
  if (!dest) return;
  if (!from) {
    planning.value = { loading: false, error: 'Sin posición GPS para calcular la ruta' };
    return;
  }
  planning.value = { loading: true };
  const s = settings.value;
  const exclude = [...(s.avoidTolls ? ['toll'] : []), ...(s.avoidMotorways ? ['motorway'] : [])];
  const points = [from, ...stops.value, dest];
  try {
    let res = await fetchOsrm(points, stops.value.length === 0, exclude);
    if (res.code !== 'Ok' && exclude.length) {
      showToast('El servicio de rutas no admite evitar peajes/autopistas: ruta normal');
      res = await fetchOsrm(points, stops.value.length === 0, []);
    }
    const parsed = parseOsrm(res);
    const radars = allRadars.peek();
    routes.value = parsed.map((r) => ({ ...r, radarCount: countRadars(r, radars) }));
    selectedRoute.value = 0;
    planning.value = { loading: false };
    remember(dest);
  } catch (err) {
    routes.value = [];
    planning.value = { loading: false, error: `No se pudo calcular la ruta: ${(err as Error).message}` };
  }
}

export function clearRoute(): void {
  navActive.value = false;
  routes.value = [];
  progress.value = null;
  destination.value = null;
  stops.value = [];
  follower = null;
}

// ---------------------------------------------------------------------------
// Guiado

let follower: RouteFollower | null = null;
let announced = new Map<number, Set<string>>();
let offCount = 0;
let lastReroute = 0;
let legsAnnounced = new Set<number>();

export function startNavigation(): void {
  const r = activeRoute.value;
  if (!r) return;
  follower = new RouteFollower(r);
  announced = new Map();
  legsAnnounced = new Set();
  offCount = 0;
  navActive.value = true;
  const first = r.steps[0];
  if (first && settings.value.navVoice) say(`Ruta iniciada. ${first.instruction}`);
}

export function stopNavigation(): void {
  clearRoute();
}

function once(stepIdx: number, stage: string): boolean {
  let set = announced.get(stepIdx);
  if (!set) announced.set(stepIdx, (set = new Set()));
  if (set.has(stage)) return false;
  set.add(stage);
  return true;
}

async function reroute(p: Position): Promise<void> {
  lastReroute = Date.now();
  const prog = progress.peek();
  // Quita las paradas ya alcanzadas.
  if (prog) stops.value = stops.value.slice(Math.min(prog.leg, stops.value.length));
  if (settings.value.navVoice) say('Recalculando ruta');
  await planRoutes({ lat: p.lat, lon: p.lon });
  const r = activeRoute.peek();
  if (r) {
    follower = new RouteFollower(r);
    announced = new Map();
    legsAnnounced = new Set();
  }
}

function handleFix(p: Position): void {
  if (!navActive.peek() || !follower) return;
  const prog = follower.update(p.lat, p.lon);
  progress.value = prog;
  const s = settings.peek();
  const v = p.speed ?? 0;

  // Fuera de ruta: recálculo.
  const limit = Math.max(50, p.accuracy * 1.5);
  offCount = prog.offRoute > limit && v > 2 ? offCount + 1 : 0;
  if (offCount >= 4 && Date.now() - lastReroute > 15_000) {
    offCount = 0;
    void reroute(p);
    return;
  }

  // Llegada a paradas y destino.
  const route = follower.route;
  route.legEnds.forEach((end, i) => {
    if (prog.along >= end - 30 && !legsAnnounced.has(i)) {
      legsAnnounced.add(i);
      const last = i === route.legEnds.length - 1;
      beep('section');
      if (s.navVoice) say(last ? 'Has llegado a tu destino' : `Has llegado a la parada ${i + 1}`);
      if (last) setTimeout(() => stopNavigation(), 4000);
    }
  });

  // Instrucciones por voz.
  const next = prog.next;
  if (!next || !s.navVoice || next.type === 'arrive') return;
  const idx = prog.nextIndex;
  const d = prog.toNext;
  const prepare = Math.min(1500, Math.max(300, v * 28));
  const now = Math.max(40, v * 5);
  if (d <= now) {
    if (once(idx, 'now')) say(next.instruction);
  } else if (d <= prepare) {
    if (once(idx, 'prepare')) say(`En ${spokenDistance(roundDistance(d))}, ${lowerFirst(next.instruction)}`);
  } else if (d > 3000 && once(idx, 'far')) {
    say(`Continúa ${spokenDistance(roundDistance(d))}`);
  }
}

const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);
const roundDistance = (d: number) => (d < 1000 ? Math.round(d / 50) * 50 : Math.round(d / 100) * 100);

export function startNavService(): void {
  onFix(handleFix);
}
