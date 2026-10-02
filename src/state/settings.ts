import { effect, signal } from '@preact/signals';
import type { FuelType, RadarKind } from '../../shared/types';

export type ThemeSetting = 'auto' | 'light' | 'dark';
export type MapStyleSetting = 'auto' | 'voyager' | 'positron' | 'dark' | 'liberty' | 'satellite';

export interface Settings {
  theme: ThemeSetting;
  mapStyle: MapStyleSetting;
  headingUp: boolean;
  /** Avisos */
  voice: boolean;
  beeps: boolean;
  vibrate: boolean;
  volume: number;
  alertSeconds: number;
  alertMinDistance: number;
  alertMaxDistance: number;
  overspeedTolerance: number;
  overspeedAlarm: boolean;
  announcePassed: boolean;
  radarKinds: Record<RadarKind, boolean>;
  mobileStretchAlerts: boolean;
  sectionAlerts: boolean;
  /** Aeronaves */
  aircraft: boolean;
  aircraftRangeKm: number;
  aircraftPollS: number;
  showAllHelis: boolean;
  showAllAircraft: boolean;
  alertOtherHelis: boolean;
  fleetTracking: boolean;
  extraRegs: string;
  extraHex: string;
  extraCallsigns: string;
  /** Incidencias */
  waze: boolean;
  dgtIncidents: boolean;
  eventsRadiusKm: number;
  alertPolice: boolean;
  alertAccidents: boolean;
  alertHazards: boolean;
  alertV16: boolean;
  alertUserReports: boolean;
  /** Capas visibles */
  layers: {
    radars: boolean;
    stretches: boolean;
    events: boolean;
    jams: boolean;
    aircraft: boolean;
    reports: boolean;
    fuel: boolean;
    cameras: boolean;
  };
  fuelType: FuelType;
  /** Otros */
  wakeLock: boolean;
  serverUrl: string;
  token: string;
  reportTtlMin: number;
  simSpeedFactor: number;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'auto',
  mapStyle: 'auto',
  headingUp: true,
  voice: true,
  beeps: true,
  vibrate: true,
  volume: 0.8,
  alertSeconds: 40,
  alertMinDistance: 400,
  alertMaxDistance: 2000,
  overspeedTolerance: 3,
  overspeedAlarm: true,
  announcePassed: false,
  radarKinds: { fixed: true, section: true, redlight: true, trailer: false, mobile: true },
  mobileStretchAlerts: true,
  sectionAlerts: true,
  aircraft: true,
  aircraftRangeKm: 15,
  aircraftPollS: 10,
  showAllHelis: true,
  showAllAircraft: false,
  alertOtherHelis: false,
  fleetTracking: true,
  extraRegs: '',
  extraHex: '',
  extraCallsigns: '',
  waze: true,
  dgtIncidents: true,
  eventsRadiusKm: 20,
  alertPolice: true,
  alertAccidents: true,
  alertHazards: false,
  alertV16: true,
  alertUserReports: true,
  layers: {
    radars: true,
    stretches: true,
    events: true,
    jams: true,
    aircraft: true,
    reports: true,
    fuel: false,
    cameras: false,
  },
  fuelType: 'g95',
  wakeLock: true,
  serverUrl: '',
  token: '',
  reportTtlMin: 120,
  simSpeedFactor: 1,
};

const KEY = 'radar-bot:settings';

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      radarKinds: { ...DEFAULT_SETTINGS.radarKinds, ...saved.radarKinds },
      layers: { ...DEFAULT_SETTINGS.layers, ...saved.layers },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export const settings = signal<Settings>(load());

effect(() => {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings.value));
  } catch {
    // almacenamiento no disponible (modo privado): los ajustes duran la sesión
  }
});

export function updateSettings(patch: Partial<Settings>): void {
  settings.value = { ...settings.value, ...patch };
}

export function setLayer(layer: keyof Settings['layers'], on: boolean): void {
  settings.value = { ...settings.value, layers: { ...settings.value.layers, [layer]: on } };
}

export function setRadarKind(kind: RadarKind, on: boolean): void {
  settings.value = { ...settings.value, radarKinds: { ...settings.value.radarKinds, [kind]: on } };
}

export function resetSettings(): void {
  settings.value = DEFAULT_SETTINGS;
}

/** Tema efectivo (resuelve "auto" con la preferencia del sistema). */
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;
export const systemDark = signal<boolean>(media?.matches ?? false);
media?.addEventListener('change', (e) => (systemDark.value = e.matches));
