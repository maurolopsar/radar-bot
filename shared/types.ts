// Tipos compartidos entre el servidor y la app web.

/** Tipos de punto de control de velocidad / tráfico. */
export type RadarKind =
  /** Radar fijo (cabina, pórtico, poste). */
  | 'fixed'
  /** Cámara de un radar de tramo (inicio o fin). */
  | 'section'
  /** Radar / cámara de semáforo en rojo. */
  | 'redlight'
  /** Ubicación publicada donde puede ponerse un radar remolque. */
  | 'trailer'
  /** Radar móvil anunciado por un ayuntamiento para una fecha concreta. */
  | 'mobile';

export interface Radar {
  id: string;
  kind: RadarKind;
  lat: number;
  lon: number;
  /** Límite de velocidad controlado (km/h), si se conoce. */
  maxspeed?: number;
  /** Rumbo (grados, 0 = norte) del tráfico que controla, si se conoce con certeza. */
  heading?: number;
  /** Sentido tal como lo escribe la fuente ("MADRID", "creciente", "ambos"...). */
  direction?: string;
  road?: string;
  /** Punto kilométrico. */
  pk?: number;
  name?: string;
  /** Claves de las fuentes que lo publican (tras fusionar duplicados). */
  sources: string[];
  /** Para cámaras de tramo: id del Stretch al que pertenece. */
  sectionId?: string;
  /** Fecha (YYYY-MM-DD) desde/hasta la que es válido (radares móviles anunciados). */
  validFrom?: string;
  validTo?: string;
}

export type StretchKind =
  /** Tramo de control de velocidad media. */
  | 'section'
  /** Tramo de carretera donde la DGT u otra autoridad opera radares móviles. */
  | 'mobile_stretch';

export interface Stretch {
  id: string;
  kind: StretchKind;
  /** Geometría [lon, lat][] (como GeoJSON). Para tramos DGT solo inicio y fin. */
  coords: [number, number][];
  maxspeed?: number;
  road?: string;
  name?: string;
  kmFrom?: number;
  kmTo?: number;
  direction?: string;
  sources: string[];
}

export interface SourceStatus {
  key: string;
  label: string;
  ok: boolean;
  count: number;
  /** Momento de la última descarga correcta (ISO). */
  updatedAt?: string;
  error?: string;
  /** true si se sirve una copia anterior porque la última descarga falló. */
  stale?: boolean;
  /** Fuente complementaria: si falla no se considera un error. */
  optional?: boolean;
}

export interface RadarDataset {
  generatedAt: string;
  radars: Radar[];
  stretches: Stretch[];
  sources: SourceStatus[];
}

export type EventCategory =
  | 'accident'
  | 'roadworks'
  | 'closure'
  | 'jam'
  | 'hazard'
  | 'weather'
  | 'v16'
  | 'police'
  | 'event'
  | 'restriction'
  | 'other';

/** Incidencia de tráfico (DGT, Waze, aviso propio...). */
export interface TrafficEvent {
  id: string;
  source: 'dgt' | 'waze' | 'user';
  category: EventCategory;
  subtype?: string;
  lat: number;
  lon: number;
  /** Geometría lineal [lon, lat][] cuando la incidencia afecta a un tramo. */
  line?: [number, number][];
  road?: string;
  pk?: number;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'highest';
  startedAt?: string;
  /** Rumbo del conductor que lo reportó (Waze "magvar"), grados. */
  heading?: number;
  reliability?: number;
  thumbsUp?: number;
  direction?: string;
  town?: string;
}

export type AircraftTag = 'DGT' | 'Guardia Civil' | 'Policía' | 'Emergencias' | 'Militar' | null;

export interface Aircraft {
  hex: string;
  reg?: string;
  callsign?: string;
  /** Designador ICAO del tipo (AS55, EC35...). */
  type?: string;
  desc?: string;
  operator?: string;
  lat: number;
  lon: number;
  /** Altitud barométrica en pies; null si está en tierra o se desconoce. */
  altFt: number | null;
  onGround: boolean;
  /** Velocidad sobre el terreno (nudos). */
  gsKt?: number;
  track?: number;
  vertRateFpm?: number;
  squawk?: string;
  /** Segundos desde la última posición. */
  seenPosS?: number;
  mlat?: boolean;
  isHeli: boolean;
  isDgt: boolean;
  tag: AircraftTag;
  source: string;
}

export interface AircraftResponse {
  aircraft: Aircraft[];
  provider: string;
  fetchedAt: string;
  error?: string;
}

export interface FuelStation {
  id: string;
  name: string;
  lat: number;
  lon: number;
  address?: string;
  town?: string;
  schedule?: string;
  prices: Partial<Record<FuelType, number>>;
}

export type FuelType = 'g95' | 'g98' | 'diesel' | 'dieselPlus' | 'glp';

export interface TrafficCamera {
  id: string;
  lat: number;
  lon: number;
  name?: string;
  image: string;
}

export type ReportKind = 'mobile_radar' | 'police' | 'helicopter' | 'accident' | 'hazard' | 'other';

/** Aviso creado por el propio usuario. */
export interface UserReport {
  id: string;
  kind: ReportKind;
  lat: number;
  lon: number;
  heading?: number;
  note?: string;
  createdAt: string;
  /** ISO; sin valor = permanente. */
  expiresAt?: string;
}
