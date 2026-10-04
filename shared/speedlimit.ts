// Límite de velocidad de una vía en España a partir de sus etiquetas OSM.
// Si no está señalizado, aplica el Reglamento General de Circulación (art. 48 y 50,
// reforma de 2021):
//   - Autopistas y autovías: 120 km/h.
//   - Carreteras convencionales: 90 km/h.
//   - Vías urbanas de plataforma única (calzada y acera al mismo nivel): 20 km/h.
//   - Vías urbanas con un único carril por sentido: 30 km/h.
//   - Vías urbanas con dos o más carriles por sentido: 50 km/h.

import { parseMaxspeed } from './geo';

export type LimitSource = 'signed' | 'zone' | 'rule' | 'unknown';

export interface LimitResult {
  kmh?: number;
  source: LimitSource;
  /** Explicación corta para mostrar ("Señalizado", "Urbana, 1 carril por sentido"...). */
  reason: string;
  /** Tramo urbano (true), interurbano (false) o desconocido (null). */
  urban: boolean | null;
}

export interface LimitContext {
  /** Se circula en el sentido de dibujo de la vía. */
  forward: boolean;
  /** Resultado de la comprobación de zona urbana (landuse/núcleo), si se conoce. */
  urbanArea?: boolean | null;
}

const URBAN_HIGHWAYS = new Set(['residential', 'living_street', 'service', 'pedestrian']);
const ZONE_KEYS = ['maxspeed:type', 'zone:maxspeed', 'source:maxspeed', 'zone:traffic'];

function zoneValue(tags: Record<string, string>): string | undefined {
  for (const k of ZONE_KEYS) {
    const v = tags[k];
    if (v && /^ES:/i.test(v)) return v.toUpperCase();
  }
  const m = tags.maxspeed;
  if (m && /^ES:/i.test(m)) return m.toUpperCase();
  return undefined;
}

/** Carriles en el sentido de circulación, si se puede saber. */
export function lanesPerDirection(tags: Record<string, string>, forward: boolean): number | undefined {
  const dirKey = forward ? 'lanes:forward' : 'lanes:backward';
  const dir = Number(tags[dirKey]);
  if (dir > 0) return dir;
  const total = Number(tags.lanes);
  if (!(total > 0)) return undefined;
  const oneway = tags.oneway === 'yes' || tags.oneway === '1' || tags.oneway === '-1' || tags.junction === 'roundabout';
  return oneway ? total : Math.max(1, Math.floor(total / 2));
}

function isDualCarriageway(tags: Record<string, string>): boolean {
  return tags.oneway === 'yes' || tags.dual_carriageway === 'yes' || Number(tags.lanes) >= 4;
}

export function inferSpanishLimit(tags: Record<string, string>, ctx: LimitContext): LimitResult {
  const hw = tags.highway ?? '';

  // 1) Señalizado (con sentido si lo hay).
  const dirTag = ctx.forward ? tags['maxspeed:forward'] : tags['maxspeed:backward'];
  for (const raw of [dirTag, tags.maxspeed]) {
    if (!raw || /^ES:/i.test(raw)) continue;
    const v = parseMaxspeed(raw);
    if (v != null) return { kmh: v, source: 'signed', reason: 'Señalizado', urban: URBAN_HIGHWAYS.has(hw) ? true : null };
  }

  // 2) Zona declarada (ES:urban, ES:rural, ES:zone30...).
  const zone = zoneValue(tags);
  let urban: boolean | null = ctx.urbanArea ?? null;
  if (zone) {
    if (/ZONE\s*20|LIVING|PLAYGROUND/.test(zone)) return { kmh: 20, source: 'zone', reason: 'Zona 20 / plataforma única', urban: true };
    if (/ZONE\s*30|:30/.test(zone)) return { kmh: 30, source: 'zone', reason: 'Zona 30', urban: true };
    if (/MOTORWAY/.test(zone)) return { kmh: 120, source: 'zone', reason: 'Autopista / autovía', urban: false };
    if (/RURAL|TRUNK/.test(zone)) urban = false;
    if (/URBAN/.test(zone)) urban = true;
  }

  // 3) Reglas generales por tipo de vía.
  if (hw === 'motorway') return { kmh: 120, source: 'rule', reason: 'Autopista / autovía', urban: false };
  if (hw === 'trunk' && (tags.motorroad === 'yes' || isDualCarriageway(tags)) && urban !== true) {
    return { kmh: 120, source: 'rule', reason: 'Autovía', urban: false };
  }
  if (hw.endsWith('_link')) return { source: 'unknown', reason: 'Enlace (ver señalización)', urban };
  if (hw === 'living_street' || hw === 'pedestrian') {
    return { kmh: 20, source: 'rule', reason: 'Plataforma única', urban: true };
  }
  if (urban === null && URBAN_HIGHWAYS.has(hw)) urban = true;

  if (urban) {
    const lanes = lanesPerDirection(tags, ctx.forward);
    if (lanes != null) {
      return lanes >= 2
        ? { kmh: 50, source: 'rule', reason: 'Urbana, 2+ carriles por sentido', urban: true }
        : { kmh: 30, source: 'rule', reason: 'Urbana, 1 carril por sentido', urban: true };
    }
    // Sin carriles mapeados: las avenidas principales suelen tener 2 por sentido.
    if (['trunk', 'primary'].includes(hw)) return { kmh: 50, source: 'rule', reason: 'Urbana principal (estimado)', urban: true };
    return { kmh: 30, source: 'rule', reason: 'Urbana, 1 carril por sentido (estimado)', urban: true };
  }

  if (['trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'road'].includes(hw)) {
    return { kmh: 90, source: 'rule', reason: 'Carretera convencional', urban: urban ?? false };
  }
  return { source: 'unknown', reason: 'Sin datos', urban };
}
