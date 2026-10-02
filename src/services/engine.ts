// Motor en vivo: en cada posición GPS calcula radares por delante, tramos,
// avisos de usuarios, aeronaves cercanas y dispara los avisos sonoros.

import { computed, effect } from '@preact/signals';
import {
  corridorsAt,
  lookaheadDistance,
  ProximityTracker,
  SectionTracker,
  type Fix,
  type ProximityOptions,
  type SectionDef,
  type Target,
} from '../../shared/alerts';
import { todayInSpain } from '../../shared/feed';
import { bearingDeg, cardinal, destination, distanceM, formatDistance, GridIndex, ktToKmh } from '../../shared/geo';
import type { Aircraft, Radar, RadarKind, Stretch, TrafficEvent, UserReport } from '../../shared/types';
import { settings } from '../state/settings';
import {
  activeAlerts,
  aircraft,
  corridors,
  dataset,
  events,
  fleet,
  importedRadars,
  radarHits,
  reports,
  road,
  section,
  trip,
  type ActiveAlert,
  type Position,
} from '../state/store';
import { beep, say, spokenDistance } from './audio';
import { onFix } from './geolocation';
import { currentRoadRefs, updateRoad } from './road';

export const RADAR_LABEL: Record<RadarKind, string> = {
  fixed: 'Radar fijo',
  section: 'Radar de tramo',
  redlight: 'Radar de semáforo',
  trailer: 'Posible radar remolque',
  mobile: 'Radar móvil anunciado',
};

export const REPORT_LABEL: Record<UserReport['kind'], string> = {
  mobile_radar: 'Radar móvil',
  police: 'Control policial',
  helicopter: 'Helicóptero',
  accident: 'Accidente',
  hazard: 'Peligro',
  other: 'Aviso',
};

// ---------------------------------------------------------------------------
// Índices (se recalculan cuando cambian los datos)

export const allRadars = computed<Radar[]>(() => {
  const ds = dataset.value;
  const kinds = settings.value.radarKinds;
  const today = todayInSpain();
  const list = [...(ds?.radars ?? []), ...importedRadars.value.flatMap((i) => i.radars)];
  return list.filter((r) => {
    if (!kinds[r.kind]) return false;
    if (r.validTo && r.validTo < today) return false;
    if (r.validFrom && r.validFrom > today) return false;
    return true;
  });
});

const radarIndex = computed(() => {
  const idx = new GridIndex<Radar>(0.05);
  for (const r of allRadars.value) idx.add(r);
  return idx;
});

const sectionRadars = computed(() => {
  const m = new Map<string, Radar>();
  for (const r of dataset.value?.radars ?? []) if (r.sectionId && r.maxspeed != null && !m.has(r.sectionId)) m.set(r.sectionId, r);
  return m;
});

interface StretchRef {
  lat: number;
  lon: number;
  s: Stretch;
}

const stretchIndex = computed(() => {
  const sections = new GridIndex<StretchRef>(0.1);
  const mobile = new GridIndex<StretchRef>(0.1);
  for (const s of dataset.value?.stretches ?? []) {
    const target = s.kind === 'section' ? sections : mobile;
    for (const [lon, lat] of [s.coords[0], s.coords[s.coords.length - 1]]) target.add({ lat, lon, s });
    if (s.kind === 'mobile_stretch' && s.coords.length >= 2) {
      // Punto medio para tramos largos.
      const mid = s.coords[Math.floor(s.coords.length / 2)];
      mobile.add({ lat: mid[1], lon: mid[0], s });
    }
  }
  return { sections, mobile };
});

export const visibleRadarCount = computed(() => allRadars.value.length);

// ---------------------------------------------------------------------------
// Objetivos de avisos (incidencias y avisos propios)

interface EventTarget extends Target {
  title: string;
  icon: string;
  sound: 'police' | 'hazard';
  severity: ActiveAlert['severity'];
  ref: TrafficEvent | UserReport;
}

const eventTargets = computed<EventTarget[]>(() => {
  const s = settings.value;
  const out: EventTarget[] = [];
  for (const e of events.value) {
    let want = false;
    let sound: EventTarget['sound'] = 'hazard';
    if (e.category === 'police') {
      want = s.alertPolice;
      sound = 'police';
    } else if (e.category === 'accident') want = s.alertAccidents;
    else if (e.category === 'v16') want = s.alertV16;
    else if (['hazard', 'weather', 'closure'].includes(e.category)) want = s.alertHazards;
    if (!want) continue;
    out.push({
      id: e.id,
      lat: e.lat,
      lon: e.lon,
      heading: e.heading,
      headingTolerance: 90,
      title: e.category === 'police' ? `${e.description ?? 'Policía'} (Waze)` : (e.description ?? 'Incidencia'),
      icon: `ev-${e.category}`,
      sound,
      severity: e.category === 'police' ? 'danger' : 'warning',
      ref: e,
    });
  }
  if (s.alertUserReports) {
    for (const r of reports.value) {
      out.push({
        id: `rep-${r.id}`,
        lat: r.lat,
        lon: r.lon,
        heading: r.heading,
        headingTolerance: 90,
        title: `${REPORT_LABEL[r.kind]} (aviso propio)`,
        icon: `rep-${r.kind}`,
        sound: r.kind === 'mobile_radar' || r.kind === 'police' ? 'police' : 'hazard',
        severity: r.kind === 'mobile_radar' || r.kind === 'police' ? 'danger' : 'warning',
        ref: r,
      });
    }
  }
  return out;
});

// ---------------------------------------------------------------------------

function proximityOpts(): ProximityOptions {
  const s = settings.value;
  return {
    minDistance: s.alertMinDistance,
    maxDistance: Math.max(s.alertMinDistance, s.alertMaxDistance),
    secondsAhead: s.alertSeconds,
    coneDeg: 30,
    closeSeconds: 12,
    minCloseDistance: 200,
    minSpeedMs: 1.5,
  };
}

const radarTracker = new ProximityTracker<Radar>(proximityOpts());
const eventTracker = new ProximityTracker<EventTarget>(proximityOpts());
const sectionTracker = new SectionTracker();

effect(() => {
  const o = proximityOpts();
  radarTracker.opts = o;
  eventTracker.opts = o;
});

/** Posición estimada de una aeronave ahora, a partir de su rumbo y velocidad. */
export function extrapolate(a: Aircraft, fetchedAtMs: number, now = Date.now()): { lat: number; lon: number } {
  if (a.gsKt == null || a.track == null || a.onGround) return a;
  const dt = Math.min(30, (now - fetchedAtMs) / 1000 + (a.seenPosS ?? 0));
  if (dt <= 0) return a;
  return destination(a.lat, a.lon, a.track, (a.gsKt * 0.514444) * dt);
}

const acState = new Map<string, 'in' | 'close'>();
let aircraftStamp = Date.now();
effect(() => {
  void aircraft.value;
  void fleet.value;
  aircraftStamp = Date.now();
});

export function relevantAircraft(): Aircraft[] {
  const s = settings.value;
  const map = new Map<string, Aircraft>();
  for (const a of [...fleet.value, ...aircraft.value]) {
    if (a.isDgt || (s.alertOtherHelis && a.isHeli && a.tag != null)) map.set(a.hex, a);
  }
  return [...map.values()].filter((a) => (a.seenPosS ?? 0) < 180);
}

function aircraftName(a: Aircraft): string {
  if (a.isDgt) return a.isHeli ? 'Helicóptero de la DGT' : 'Aeronave de la DGT';
  return `Helicóptero${a.tag ? ` de ${a.tag === 'Policía' ? 'la Policía' : a.tag === 'Guardia Civil' ? 'la Guardia Civil' : a.tag}` : ''}`;
}

function checkAircraft(p: Position, alerts: ActiveAlert[]): void {
  const s = settings.value;
  if (!s.aircraft) {
    acState.clear();
    return;
  }
  const range = s.aircraftRangeKm * 1000;
  const seen = new Set<string>();
  for (const a of relevantAircraft()) {
    const pos = extrapolate(a, aircraftStamp);
    const d = distanceM(p.lat, p.lon, pos.lat, pos.lon);
    const st = acState.get(a.hex);
    seen.add(a.hex);
    const brg = bearingDeg(p.lat, p.lon, pos.lat, pos.lon);
    if (d <= range) {
      const name = aircraftName(a);
      const closeAt = Math.min(3000, range / 3);
      if (!st) {
        acState.set(a.hex, d <= closeAt ? 'close' : 'in');
        beep('helicopter');
        say(`${name} a ${spokenDistance(d)}, al ${cardinalSpoken(brg)}`);
      } else if (st === 'in' && d <= closeAt) {
        acState.set(a.hex, 'close');
        beep('helicopter');
        say(`${name} muy cerca, a ${spokenDistance(d)}`);
      }
      const alt = a.altFt != null ? `${Math.round(a.altFt * 0.3048)} m` : a.onGround ? 'en tierra' : '';
      const spd = a.gsKt != null ? `${Math.round(ktToKmh(a.gsKt))} km/h` : '';
      alerts.push({
        id: `ac-${a.hex}`,
        kind: 'aircraft',
        title: name,
        subtitle: [a.reg ?? a.callsign, alt, spd].filter(Boolean).join(' · '),
        distance: d,
        bearing: brg,
        stage: d <= closeAt ? 'close' : 'approach',
        severity: a.isDgt ? 'danger' : 'warning',
        icon: a.isDgt ? 'ac-dgt' : 'ac-heli',
        lat: pos.lat,
        lon: pos.lon,
      });
    } else if (st && d > range * 1.15) {
      acState.delete(a.hex);
    }
  }
  for (const hex of [...acState.keys()]) if (!seen.has(hex)) acState.delete(hex);
}

const SPOKEN_CARDINAL: Record<string, string> = {
  N: 'norte',
  NE: 'noreste',
  E: 'este',
  SE: 'sureste',
  S: 'sur',
  SO: 'suroeste',
  O: 'oeste',
  NO: 'noroeste',
};
const cardinalSpoken = (b: number) => SPOKEN_CARDINAL[cardinal(b)];

let lastFix: Position | null = null;
let lastOverspeedBeep = 0;
let corridorIds = new Set<string>();

function updateTrip(p: Position): void {
  const t = trip.value;
  if (lastFix && (p.speed ?? 0) > 1) {
    const d = distanceM(lastFix.lat, lastFix.lon, p.lat, p.lon);
    const dt = (p.time - lastFix.time) / 1000;
    if (d < 1500 && dt > 0 && dt < 60) {
      trip.value = { ...t, distanceM: t.distanceM + d, movingS: t.movingS + dt, maxKmh: Math.max(t.maxKmh, (p.speed ?? 0) * 3.6) };
    }
  }
}

function sectionDefs(p: Position): SectionDef[] {
  const near = stretchIndex.value.sections.near(p.lat, p.lon, 300);
  const uniq = new Map<string, Stretch>();
  for (const n of near) uniq.set(n.s.id, n.s);
  return [...uniq.values()].map((s) => ({
    id: s.id,
    coords: s.coords,
    name: s.name,
    road: s.road,
    maxspeed: s.maxspeed ?? sectionRadars.value.get(s.id)?.maxspeed ?? road.value?.maxspeed,
  }));
}

function handleFix(p: Position): void {
  const s = settings.value;
  updateRoad(p);
  updateTrip(p);
  const fix: Fix = { lat: p.lat, lon: p.lon, speed: p.speed, heading: p.heading, accuracy: p.accuracy, time: p.time };
  const kmh = (p.speed ?? 0) * 3.6;
  const alerts: ActiveAlert[] = [];

  // --- Radares
  const look = lookaheadDistance(p.speed, radarTracker.opts);
  const { hits, events: radarEvents } = radarTracker.update(fix, radarIndex.value.near(p.lat, p.lon, look + 300));
  radarHits.value = hits;
  for (const e of radarEvents) {
    const r = e.target;
    const label = RADAR_LABEL[r.kind];
    if (e.type === 'approach') {
      beep('radar');
      say(`${label} a ${spokenDistance(e.distance)}${r.maxspeed ? `. Límite ${r.maxspeed}` : ''}`, { interrupt: true });
    } else if (e.type === 'close') {
      beep('radarClose');
      if (r.maxspeed && kmh > r.maxspeed + s.overspeedTolerance) say('Reduce la velocidad', { interrupt: true });
    } else if (e.type === 'passed') {
      trip.value = { ...trip.value, radarsPassed: trip.value.radarsPassed + 1 };
      if (s.announcePassed) beep('passed');
    }
  }
  for (const h of hits.slice(0, 2)) {
    const r = h.target;
    const over = r.maxspeed != null && kmh > r.maxspeed + s.overspeedTolerance;
    if (over && h.stage === 'close' && s.overspeedAlarm && Date.now() - lastOverspeedBeep > 1800) {
      lastOverspeedBeep = Date.now();
      beep('overspeed');
    }
    alerts.push({
      id: `radar-${r.id}`,
      kind: 'radar',
      title: RADAR_LABEL[r.kind],
      subtitle: [r.road, r.pk != null ? `km ${r.pk.toFixed(1).replace('.', ',')}` : null, r.name && !r.road ? r.name : null]
        .filter(Boolean)
        .join(' · '),
      distance: h.distance,
      limit: r.maxspeed,
      stage: h.stage,
      severity: h.stage === 'close' || over ? 'danger' : 'warning',
      icon: `radar-${r.kind}`,
      lat: r.lat,
      lon: r.lon,
    });
  }

  // --- Tramos de velocidad media
  if (s.radarKinds.section) {
    const res = sectionTracker.update(fix, sectionDefs(p));
    section.value = res.status;
    if (res.entered && s.sectionAlerts) {
      beep('section');
      say(`Inicio de tramo de velocidad media${res.entered.maxspeed ? `. Límite ${res.entered.maxspeed}` : ''}`);
    }
    if (res.exited && s.sectionAlerts) {
      say(`Fin de tramo. Velocidad media ${Math.round(res.exited.avgKmh)}${res.exited.over ? '. Por encima del límite' : ''}`);
    }
  } else section.value = null;

  // --- Tramos con radar móvil
  const nearMobile = stretchIndex.value.mobile.near(p.lat, p.lon, 15_000);
  const uniq = new Map<string, Stretch>();
  for (const n of nearMobile) uniq.set(n.s.id, n.s);
  const inCorridor = corridorsAt(p.lat, p.lon, [...uniq.values()], currentRoadRefs());
  const ids = new Set(inCorridor.map((c) => c.id));
  for (const c of inCorridor) {
    if (!corridorIds.has(c.id) && s.mobileStretchAlerts && (p.speed ?? 0) > 3) {
      beep('info');
      say(`Tramo con controles de radar móvil${c.road ? ` en la ${c.road.replace(/-/g, ' ')}` : ''}`);
    }
  }
  corridorIds = ids;
  corridors.value = inCorridor;
  for (const c of inCorridor.slice(0, 1)) {
    alerts.push({
      id: `corr-${c.id}`,
      kind: 'corridor',
      title: 'Tramo con radar móvil',
      subtitle: c.name,
      stage: 'info',
      severity: 'info',
      icon: 'radar-mobile',
    });
  }

  // --- Incidencias y avisos propios
  const evNear = eventTargets.value.filter((t) => Math.abs(t.lat - p.lat) < 0.3 && Math.abs(t.lon - p.lon) < 0.4);
  const ev = eventTracker.update(fix, evNear);
  for (const e of ev.events) {
    if (e.type === 'approach') {
      beep(e.target.sound);
      say(`${e.target.title.replace(/\s*\((Waze|aviso propio)\)/, '')} a ${spokenDistance(e.distance)}`);
    } else if (e.type === 'close' && e.target.sound === 'police') beep('police');
  }
  for (const h of ev.hits.slice(0, 2)) {
    const t = h.target;
    const ref = t.ref as TrafficEvent & UserReport;
    alerts.push({
      id: `ev-${t.id}`,
      kind: 'id' in ref && 'createdAt' in ref ? 'report' : 'event',
      title: t.title,
      subtitle: [ref.road, (ref as TrafficEvent).town].filter(Boolean).join(' · ') || undefined,
      distance: h.distance,
      stage: h.stage,
      severity: t.severity,
      icon: t.icon,
      lat: t.lat,
      lon: t.lon,
    });
  }

  // --- Aeronaves
  checkAircraft(p, alerts);

  alerts.sort((a, b) => alertRank(a) - alertRank(b) || (a.distance ?? 1e9) - (b.distance ?? 1e9));
  activeAlerts.value = alerts;
  lastFix = p;
}

/** Orden del banner: radares primero, luego lo cercano y urgente, al final lo informativo. */
export function alertRank(a: ActiveAlert): number {
  const close = a.stage === 'close';
  switch (a.kind) {
    case 'radar':
      return close ? 0 : 1;
    case 'aircraft':
      return close ? 2 : 5;
    case 'event':
    case 'report':
      return a.severity === 'danger' ? (close ? 2 : 3) : close ? 3 : 4;
    default:
      return 6;
  }
}

export function startEngine(): void {
  onFix(handleFix);
}

export function describeDistance(m: number | undefined): string {
  return m == null ? '' : formatDistance(m);
}
