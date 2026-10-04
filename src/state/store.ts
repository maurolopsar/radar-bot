// Estado global de la app (signals).

import { computed, signal } from '@preact/signals';
import type { ProximityHit, SectionStatus } from '../../shared/alerts';
import type {
  Aircraft,
  FuelStation,
  Radar,
  RadarDataset,
  SourceStatus,
  Stretch,
  TrafficCamera,
  TrafficEvent,
  UserReport,
} from '../../shared/types';
import { settings, systemDark } from './settings';

export interface Position {
  lat: number;
  lon: number;
  /** m/s */
  speed: number | null;
  heading: number | null;
  accuracy: number;
  time: number;
  simulated?: boolean;
}

export type GpsState = 'off' | 'waiting' | 'ok' | 'denied' | 'error' | 'sim';

export const started = signal(false);
export const gpsState = signal<GpsState>('off');
export const position = signal<Position | null>(null);

export const dataset = signal<RadarDataset | null>(null);
export const datasetState = signal<{ loading: boolean; error?: string; offline?: boolean; source?: 'server' | 'direct' | 'cache' }>({ loading: false });
export const importedRadars = signal<{ name: string; radars: Radar[] }[]>([]);

export const events = signal<TrafficEvent[]>([]);
export const eventSources = signal<SourceStatus[]>([]);
export const aircraft = signal<Aircraft[]>([]);
export const aircraftInfo = signal<{ provider?: string; error?: string; fetchedAt?: string }>({});
export const fleet = signal<Aircraft[]>([]);
export const fleetInfo = signal<{ provider?: string; error?: string; fetchedAt?: string }>({});
export const reports = signal<UserReport[]>([]);
export const fuel = signal<FuelStation[]>([]);
export const cameras = signal<TrafficCamera[]>([]);

export interface RoadInfo {
  name?: string;
  ref?: string;
  maxspeed?: number;
  /** true si el límite es el genérico del tipo de vía (no señalizado en OSM). */
  inferred?: boolean;
  highway?: string;
  /** Explicación del límite ("Señalizado", "Urbana, 1 carril por sentido"...). */
  limitReason?: string;
  urban?: boolean | null;
}
export const road = signal<RoadInfo | null>(null);

export interface Weather {
  temperature: number;
  apparent?: number;
  precipitation: number;
  code: number;
  wind: number;
  gusts?: number;
  visibility?: number;
  isDay: boolean;
  time: string;
}
export const weather = signal<Weather | null>(null);

/** Alerta activa mostrada en el banner. */
export interface ActiveAlert {
  id: string;
  kind: 'radar' | 'event' | 'report' | 'aircraft' | 'corridor';
  title: string;
  subtitle?: string;
  distance?: number;
  bearing?: number;
  limit?: number;
  stage: 'approach' | 'close' | 'info';
  severity: 'danger' | 'warning' | 'info';
  icon: string;
  lat?: number;
  lon?: number;
}

export const activeAlerts = signal<ActiveAlert[]>([]);
export const radarHits = signal<ProximityHit<Radar>[]>([]);
export const section = signal<SectionStatus | null>(null);
export const corridors = signal<Stretch[]>([]);

export const follow = signal(true);
/** Zoom elegido a mano mientras se sigue la posición (null = automático por velocidad). */
export const manualZoom = signal<number | null>(null);
export const simRoute = signal<[number, number][] | null>(null);
export const simActive = signal(false);
export const pickMode = signal<'sim-from' | 'sim-to' | 'seg-start' | 'seg-end' | null>(null);
/** Hay un cruce o maniobra cerca: el mapa se acerca para verlo mejor. */
export const decisionAhead = signal(false);
export const simPoints = signal<{ from?: { lat: number; lon: number }; to?: { lat: number; lon: number } }>({});
export const selected = signal<{ type: string; data: unknown } | null>(null);
export type SheetName = 'settings' | 'layers' | 'nearby' | 'report' | 'sources' | 'sim' | 'route' | 'rally' | null;
export const sheet = signal<SheetName>(null);
export const reportAt = signal<{ lat: number; lon: number } | null>(null);
export const toast = signal<{ text: string; id: number } | null>(null);

export interface TripStats {
  startedAt: number;
  distanceM: number;
  maxKmh: number;
  movingS: number;
  radarsPassed: number;
}
export const trip = signal<TripStats>({ startedAt: Date.now(), distanceM: 0, maxKmh: 0, movingS: 0, radarsPassed: 0 });

export function showToast(text: string): void {
  toast.value = { text, id: Date.now() };
}

export const isDark = computed(() => {
  const t = settings.value.theme;
  return t === 'dark' || (t === 'auto' && systemDark.value);
});

/** Velocidad mostrada (km/h). */
export const speedKmh = computed(() => {
  const p = position.value;
  return p?.speed != null ? p.speed * 3.6 : null;
});
