// Elementos de la vía que merecen aviso, a partir de nodos de OpenStreetMap.

export type HazardType =
  | 'level_crossing'
  | 'bump'
  | 'narrow'
  | 'toll'
  | 'hazard'
  | 'stop'
  | 'give_way'
  | 'traffic_signals'
  | 'crossing';

export interface Hazard {
  id: string;
  type: HazardType;
  lat: number;
  lon: number;
  label: string;
}

const HAZARD_LABEL: Record<string, string> = {
  animal_crossing: 'Paso de animales',
  cattle: 'Paso de ganado',
  deer: 'Paso de animales',
  curve: 'Curva peligrosa',
  curves: 'Curvas peligrosas',
  dangerous_curve: 'Curva peligrosa',
  falling_rocks: 'Desprendimientos',
  school_zone: 'Zona escolar',
  children: 'Niños',
  ice: 'Hielo',
  slippery: 'Calzada deslizante',
  fog: 'Niebla frecuente',
  side_winds: 'Viento lateral',
  pedestrians: 'Peatones',
  cyclists: 'Ciclistas',
  bump: 'Resalto',
  dip: 'Badén',
  loose_gravel: 'Gravilla suelta',
  queues_likely: 'Retenciones frecuentes',
  low_flying_aircraft: 'Aeronaves a baja altura',
  accident_area: 'Tramo de concentración de accidentes',
  frost_heave: 'Firme irregular',
  damaged_road: 'Firme deteriorado',
};

export const HAZARD_NAME: Record<HazardType, string> = {
  level_crossing: 'Paso a nivel',
  bump: 'Resalto',
  narrow: 'Estrechamiento',
  toll: 'Peaje',
  hazard: 'Peligro',
  stop: 'Stop',
  give_way: 'Ceda el paso',
  traffic_signals: 'Semáforo',
  crossing: 'Paso de peatones',
};

export function classifyHazard(id: number | string, lat: number, lon: number, tags: Record<string, string>): Hazard | null {
  const mk = (type: HazardType, label = HAZARD_NAME[type]): Hazard => ({ id: `hz-${id}`, type, lat, lon, label });
  if (tags.railway === 'level_crossing') return mk('level_crossing', tags.crossing_barrier === 'no' || tags['crossing:barrier'] === 'no' ? 'Paso a nivel sin barreras' : 'Paso a nivel');
  const tc = tags.traffic_calming;
  if (tc) {
    if (/choker|chicane|island|narrow|painted_island/.test(tc)) return mk('narrow');
    if (tc === 'table') return mk('bump', 'Paso elevado');
    if (tc === 'dip') return mk('bump', 'Badén');
    if (tc === 'rumble_strip') return mk('bump', 'Bandas sonoras');
    return mk('bump', tc === 'cushion' ? 'Cojín berlinés' : 'Resalto');
  }
  if (tags.barrier === 'toll_booth' || tags.highway === 'toll_gantry') return mk('toll');
  if (tags.hazard) {
    const key = tags.hazard.split(';')[0].trim();
    return mk('hazard', HAZARD_LABEL[key] ?? 'Peligro');
  }
  switch (tags.highway) {
    case 'stop':
      return mk('stop');
    case 'give_way':
      return mk('give_way');
    case 'traffic_signals':
      return mk('traffic_signals');
    case 'crossing':
      return tags.crossing === 'no' ? null : mk('crossing');
  }
  return null;
}

/** Distancia de primer aviso razonable para cada tipo (m). */
export function hazardWarnDistance(type: HazardType, speedMs: number): number {
  const base: Record<HazardType, [number, number]> = {
    level_crossing: [300, 15],
    bump: [120, 8],
    narrow: [150, 8],
    toll: [600, 20],
    hazard: [300, 12],
    stop: [150, 8],
    give_way: [120, 7],
    traffic_signals: [150, 7],
    crossing: [80, 5],
  };
  const [min, seconds] = base[type];
  return Math.max(min, Math.min(1200, speedMs * seconds));
}
