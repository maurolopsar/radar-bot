// Seguimiento GPS con cálculo de velocidad/rumbo cuando el dispositivo no los da,
// y modo simulación (recorre una ruta para probar avisos sin conducir).

import { bearingDeg, distanceM, lineLengthM, pointAlong } from '../../shared/geo';
import { gpsState, position, type Position } from '../state/store';

type Listener = (p: Position) => void;
const listeners = new Set<Listener>();

export function onFix(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

interface RawFix {
  lat: number;
  lon: number;
  speed: number | null;
  heading: number | null;
  accuracy: number;
  time: number;
  simulated?: boolean;
}

/**
 * Crea un calculador de posición con estado: completa velocidad y rumbo a
 * partir de fijos consecutivos cuando el dispositivo no los da (o están
 * parados), y suaviza la velocidad.
 */
export function createDeriver() {
  let last: Position | null = null;
  let lastHeading: number | null = null;
  let smoothSpeed: number | null = null;
  return {
    reset(): void {
      last = null;
      lastHeading = null;
      smoothSpeed = null;
    },
    next(raw: RawFix): Position {
      let speed = raw.speed != null && Number.isFinite(raw.speed) && raw.speed >= 0 ? raw.speed : null;
      let heading = raw.heading != null && Number.isFinite(raw.heading) && raw.heading >= 0 ? raw.heading : null;
      if (last) {
        const dt = (raw.time - last.time) / 1000;
        const d = distanceM(last.lat, last.lon, raw.lat, raw.lon);
        const significant = d > Math.max(4, raw.accuracy * 0.6);
        if (speed == null && dt > 0.4 && dt < 30) speed = significant ? d / dt : 0;
        if ((heading == null || (speed ?? 0) < 1.5) && significant) heading = bearingDeg(last.lat, last.lon, raw.lat, raw.lon);
      }
      if (heading != null && (speed ?? 0) >= 1) lastHeading = heading;
      else heading = lastHeading;
      if (speed != null) smoothSpeed = smoothSpeed == null ? speed : smoothSpeed * 0.35 + speed * 0.65;
      const p: Position = {
        lat: raw.lat,
        lon: raw.lon,
        speed: speed == null ? null : (smoothSpeed ?? speed),
        heading,
        accuracy: raw.accuracy,
        time: raw.time,
        simulated: raw.simulated,
      };
      last = p;
      return p;
    },
  };
}

const deriver = createDeriver();

function push(raw: RawFix): void {
  const p = deriver.next(raw);
  position.value = p;
  for (const l of listeners) {
    try {
      l(p);
    } catch (err) {
      console.error(err);
    }
  }
}

let watchId: number | null = null;

export function startGps(): void {
  if (!('geolocation' in navigator)) {
    gpsState.value = 'error';
    return;
  }
  if (watchId != null) return;
  gpsState.value = 'waiting';
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      if (sim) return;
      gpsState.value = 'ok';
      push({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        speed: pos.coords.speed,
        heading: pos.coords.heading,
        accuracy: pos.coords.accuracy,
        time: pos.timestamp || Date.now(),
      });
    },
    (err) => {
      if (sim) return;
      gpsState.value = err.code === err.PERMISSION_DENIED ? 'denied' : 'error';
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
  );
}

export function stopGps(): void {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

// ---------------------------------------------------------------------------
// Simulación

export interface SimRoute {
  coords: [number, number][];
  /** Velocidad (m/s) de cada segmento. */
  speeds: number[];
  lengthM: number;
}

let sim: { route: SimRoute; dist: number; timer: number; factor: number; paused: boolean } | null = null;

export const isSimulating = () => sim != null;

export async function planRoute(from: { lat: number; lon: number }, to: { lat: number; lon: number }): Promise<SimRoute> {
  try {
    const url =
      `https://router.project-osrm.org/route/v1/driving/${from.lon.toFixed(6)},${from.lat.toFixed(6)};` +
      `${to.lon.toFixed(6)},${to.lat.toFixed(6)}?overview=full&geometries=geojson&annotations=speed`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OSRM ${res.status}`);
    const data = (await res.json()) as {
      routes?: { geometry: { coordinates: [number, number][] }; legs: { annotation?: { speed?: number[] } }[] }[];
    };
    const r = data.routes?.[0];
    if (!r) throw new Error('Sin ruta');
    const coords = r.geometry.coordinates;
    const speeds = r.legs.flatMap((l) => l.annotation?.speed ?? []);
    while (speeds.length < coords.length - 1) speeds.push(speeds[speeds.length - 1] ?? 25);
    return { coords, speeds: speeds.map((s) => Math.max(4, Math.min(40, s))), lengthM: lineLengthM(coords) };
  } catch {
    // Sin servicio de rutas: línea recta a 90 km/h.
    const coords: [number, number][] = [
      [from.lon, from.lat],
      [to.lon, to.lat],
    ];
    return { coords, speeds: [25], lengthM: lineLengthM(coords) };
  }
}

function segmentAt(route: SimRoute, dist: number): number {
  let acc = 0;
  for (let i = 0; i < route.coords.length - 1; i++) {
    const [lon1, lat1] = route.coords[i];
    const [lon2, lat2] = route.coords[i + 1];
    acc += distanceM(lat1, lon1, lat2, lon2);
    if (acc >= dist) return i;
  }
  return route.coords.length - 2;
}

export function startSim(route: SimRoute, factor = 1, onEnd?: () => void): void {
  stopSim();
  gpsState.value = 'sim';
  deriver.reset();
  const tick = () => {
    if (!sim || sim.paused) return;
    const seg = segmentAt(sim.route, sim.dist);
    const v = (sim.route.speeds[seg] ?? 25) * sim.factor;
    sim.dist += v;
    if (sim.dist >= sim.route.lengthM) {
      stopSim();
      onEnd?.();
      return;
    }
    const p = pointAlong(sim.route.coords, sim.dist);
    push({ lat: p.lat, lon: p.lon, speed: v, heading: p.bearing, accuracy: 5, time: Date.now(), simulated: true });
  };
  sim = { route, dist: 0, timer: window.setInterval(tick, 1000), factor, paused: false };
  tick();
}

export function setSimFactor(f: number): void {
  if (sim) sim.factor = f;
}

export function toggleSimPause(): boolean {
  if (sim) sim.paused = !sim.paused;
  return sim?.paused ?? false;
}

export function stopSim(): void {
  if (!sim) return;
  clearInterval(sim.timer);
  sim = null;
  deriver.reset();
  gpsState.value = watchId != null ? 'waiting' : 'off';
}
