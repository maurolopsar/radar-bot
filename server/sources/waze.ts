// Avisos de usuarios de Waze (policía, accidentes, peligros, atascos) a través
// del mapa público https://www.waze.com/live-map. API no oficial: puede cambiar
// o bloquear peticiones desde centros de datos.

import type { BBox } from '../../shared/geo';
import type { EventCategory, TrafficEvent } from '../../shared/types';
import { fetchJson } from '../lib/http';

export interface WazeAlert {
  uuid?: string;
  id?: string;
  type: string;
  subtype?: string;
  location: { x: number; y: number };
  street?: string;
  city?: string;
  reliability?: number;
  confidence?: number;
  nThumbsUp?: number;
  magvar?: number;
  pubMillis?: number;
  reportDescription?: string;
}

export interface WazeJam {
  uuid?: string | number;
  id?: string | number;
  line?: { x: number; y: number }[];
  street?: string;
  city?: string;
  speedKMH?: number;
  level?: number;
  length?: number;
  delay?: number;
  pubMillis?: number;
}

export interface WazeResponse {
  alerts?: WazeAlert[];
  jams?: WazeJam[];
}

const SUBTYPE_ES: Record<string, string> = {
  POLICE_VISIBLE: 'Policía visible',
  POLICE_HIDING: 'Policía escondida',
  POLICE_WITH_MOBILE_CAMERA: 'Radar móvil',
  POLICE_GENERAL: 'Control policial',
  ACCIDENT_MINOR: 'Accidente leve',
  ACCIDENT_MAJOR: 'Accidente grave',
  JAM_MODERATE_TRAFFIC: 'Tráfico moderado',
  JAM_HEAVY_TRAFFIC: 'Tráfico denso',
  JAM_STAND_STILL_TRAFFIC: 'Tráfico detenido',
  HAZARD_ON_ROAD: 'Peligro en la vía',
  HAZARD_ON_SHOULDER: 'Peligro en el arcén',
  HAZARD_WEATHER: 'Meteorología adversa',
  HAZARD_ON_ROAD_OBJECT: 'Objeto en la vía',
  HAZARD_ON_ROAD_POT_HOLE: 'Bache',
  HAZARD_ON_ROAD_ROAD_KILL: 'Animal muerto en la vía',
  HAZARD_ON_SHOULDER_CAR_STOPPED: 'Vehículo parado en el arcén',
  HAZARD_ON_ROAD_CAR_STOPPED: 'Vehículo parado en la vía',
  HAZARD_ON_SHOULDER_ANIMALS: 'Animales en el arcén',
  HAZARD_ON_SHOULDER_MISSING_SIGN: 'Señal caída',
  HAZARD_ON_ROAD_CONSTRUCTION: 'Obras',
  HAZARD_ON_ROAD_LANE_CLOSED: 'Carril cortado',
  HAZARD_ON_ROAD_OIL: 'Aceite en la vía',
  HAZARD_ON_ROAD_ICE: 'Hielo en la vía',
  HAZARD_ON_ROAD_TRAFFIC_LIGHT_FAULT: 'Semáforo averiado',
  HAZARD_ON_ROAD_EMERGENCY_VEHICLE: 'Vehículo de emergencia',
  HAZARD_WEATHER_FOG: 'Niebla',
  HAZARD_WEATHER_HAIL: 'Granizo',
  HAZARD_WEATHER_HEAVY_RAIN: 'Lluvia intensa',
  HAZARD_WEATHER_HEAVY_SNOW: 'Nieve',
  HAZARD_WEATHER_FLOOD: 'Inundación',
  HAZARD_WEATHER_MONSOON: 'Tormenta',
  HAZARD_WEATHER_TORNADO: 'Viento fuerte',
  HAZARD_WEATHER_HEAT_WAVE: 'Ola de calor',
  HAZARD_WEATHER_HURRICANE: 'Temporal',
  HAZARD_WEATHER_FREEZING_RAIN: 'Lluvia helada',
  ROAD_CLOSED_EVENT: 'Corte por evento',
  ROAD_CLOSED_CONSTRUCTION: 'Corte por obras',
  ROAD_CLOSED_HAZARD: 'Corte por peligro',
};

const TYPE_ES: Record<string, string> = {
  POLICE: 'Control policial',
  ACCIDENT: 'Accidente',
  JAM: 'Atasco',
  HAZARD: 'Peligro',
  WEATHERHAZARD: 'Peligro',
  ROAD_CLOSED: 'Carretera cortada',
  CONSTRUCTION: 'Obras',
  CHIT_CHAT: 'Comentario',
};

function category(type: string, subtype = ''): EventCategory | null {
  switch (type) {
    case 'POLICE':
      return 'police';
    case 'ACCIDENT':
      return 'accident';
    case 'JAM':
      return 'jam';
    case 'ROAD_CLOSED':
      return 'closure';
    case 'CONSTRUCTION':
      return 'roadworks';
    case 'HAZARD':
    case 'WEATHERHAZARD':
      if (subtype.includes('WEATHER')) return 'weather';
      if (subtype.includes('CONSTRUCTION')) return 'roadworks';
      return 'hazard';
    default:
      return null;
  }
}

export function wazeUrl(b: BBox): string {
  const q = new URLSearchParams({
    top: b.north.toFixed(5),
    bottom: b.south.toFixed(5),
    left: b.west.toFixed(5),
    right: b.east.toFixed(5),
    env: 'row',
    types: 'alerts,traffic',
  });
  return `https://www.waze.com/live-map/api/georss?${q}`;
}

export function parseWaze(data: WazeResponse): TrafficEvent[] {
  const out: TrafficEvent[] = [];
  for (const a of data.alerts ?? []) {
    const cat = category(a.type, a.subtype);
    if (!cat || !a.location) continue;
    out.push({
      id: `waze-${a.uuid ?? a.id ?? `${a.location.x},${a.location.y}`}`,
      source: 'waze',
      category: cat,
      subtype: a.subtype || a.type,
      lat: a.location.y,
      lon: a.location.x,
      road: a.street || undefined,
      town: a.city || undefined,
      description: (a.subtype && SUBTYPE_ES[a.subtype]) || TYPE_ES[a.type] || a.type,
      heading: typeof a.magvar === 'number' ? a.magvar : undefined,
      reliability: a.reliability,
      thumbsUp: a.nThumbsUp,
      startedAt: a.pubMillis ? new Date(a.pubMillis).toISOString() : undefined,
    });
  }
  for (const j of data.jams ?? []) {
    if (!j.line?.length || (j.level ?? 0) < 2) continue;
    const line = j.line.map((p) => [p.x, p.y] as [number, number]);
    const mins = j.delay && j.delay > 0 ? Math.round(j.delay / 60) : undefined;
    out.push({
      id: `waze-jam-${j.uuid ?? j.id ?? `${line[0][0]},${line[0][1]}`}`,
      source: 'waze',
      category: 'jam',
      subtype: `JAM_LEVEL_${j.level}`,
      lat: line[0][1],
      lon: line[0][0],
      line,
      road: j.street || undefined,
      town: j.city || undefined,
      description: `Atasco${j.speedKMH != null ? ` (${Math.round(j.speedKMH)} km/h)` : ''}${mins ? `, +${mins} min` : ''}`,
      severity: (j.level ?? 0) >= 4 ? 'high' : 'medium',
      startedAt: j.pubMillis ? new Date(j.pubMillis).toISOString() : undefined,
    });
  }
  return out;
}

export async function fetchWaze(b: BBox): Promise<TrafficEvent[]> {
  const data = await fetchJson<WazeResponse>(wazeUrl(b), {
    timeoutMs: 15_000,
    headers: {
      Referer: 'https://www.waze.com/live-map/',
      Origin: 'https://www.waze.com',
    },
  });
  return parseWaze(data);
}
