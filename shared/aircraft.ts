// Clasificación de aeronaves: helicópteros, flota DGT (Pegasus) y otros cuerpos.

import { ftToM, ktToKmh } from './geo';
import type { Aircraft, AircraftTag } from './types';

/**
 * Matrículas conocidas de helicópteros de la DGT (AS355 Ecureuil 2, EC135 y
 * EC120). Recopiladas de bases de datos de spotters (helis.com, planespotters,
 * jetphotos, airplane-pictures, Flightradar24). Algunas pueden estar retiradas;
 * se pueden añadir más desde Ajustes.
 */
export const DGT_REGISTRATIONS = [
  'EC-HZZ',
  'EC-IBN',
  'EC-IBO',
  'EC-IKS',
  'EC-ISZ',
  'EC-IUZ',
  'EC-IXI',
  'EC-JMK',
  'EC-KXU',
  'EC-LAR',
  'EC-LBD',
  'EC-LDF',
  'EC-LGC',
  'EC-LGD',
  'EC-MDO',
  'EC-MHU',
  'EC-MHV',
  'EC-MMF',
];

/** Designadores ICAO de los tipos que usa la DGT. */
export const DGT_TYPES = ['AS55', 'EC35', 'EC20'];

/** Prefijos de indicativo asociados a la DGT. */
export const DGT_CALLSIGN_PREFIXES = ['DGT', 'PEGAS', 'ABEJA'];

const HELI_TYPES = new Set([
  'A109', 'A119', 'A129', 'A139', 'A149', 'A169', 'A189', 'AS32', 'AS3B', 'AS50', 'AS55', 'AS65',
  'B06', 'B06T', 'B105', 'B212', 'B222', 'B230', 'B407', 'B412', 'B427', 'B429', 'B430', 'B505',
  'BK17', 'CH47', 'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'EH10', 'H160', 'H175',
  'H47', 'H60', 'LYNX', 'MI8', 'NH90', 'PUMA', 'R22', 'R44', 'R66', 'S61', 'S76', 'S92', 'TIGR',
  'UH1', 'UH60', 'G2CA', 'CABR', 'GAZL', 'EXPL', 'MD52', 'MD60', 'AW09',
]);

export interface DgtMatcher {
  registrations: string[];
  hexes: string[];
  callsignPrefixes: string[];
}

export const DEFAULT_DGT_MATCHER: DgtMatcher = {
  registrations: DGT_REGISTRATIONS,
  hexes: [],
  callsignPrefixes: DGT_CALLSIGN_PREFIXES,
};

const norm = (s: string | undefined) => (s ?? '').trim().toUpperCase();

export function isHelicopterRaw(type?: string, category?: string, desc?: string): boolean {
  if (category === 'A7') return true;
  if (type && HELI_TYPES.has(norm(type))) return true;
  return !!desc && /HELICOPTER|COPTER|ROTOR/i.test(desc);
}

export function isDgtAircraft(
  a: { hex: string; reg?: string; callsign?: string; operator?: string },
  m: DgtMatcher = DEFAULT_DGT_MATCHER,
): boolean {
  const reg = norm(a.reg).replace(/^EC(?=[A-Z]{3}$)/, 'EC-');
  if (reg && m.registrations.map(norm).includes(reg)) return true;
  if (m.hexes.map(norm).includes(norm(a.hex))) return true;
  const cs = norm(a.callsign);
  if (cs && m.callsignPrefixes.some((p) => p && cs.startsWith(norm(p)))) return true;
  return !!a.operator && /TR[AÁ]FICO|\bDGT\b/i.test(a.operator);
}

export function tagFor(a: { operator?: string; callsign?: string; military?: boolean }, isDgt: boolean): AircraftTag {
  if (isDgt) return 'DGT';
  const op = a.operator ?? '';
  if (/GUARDIA CIVIL/i.test(op)) return 'Guardia Civil';
  if (/POLIC|ERTZAINTZA|MOSSOS|INTERIOR/i.test(op)) return 'Policía';
  if (/SALVAMENTO|EMERGENC|SANITARI|MEDICAL|SUMMA|\b061\b|\b112\b|BOMBER|INCENDIO|FORESTAL/i.test(op)) return 'Emergencias';
  if (a.military) return 'Militar';
  return null;
}

/** Aeronave en el formato de las APIs compatibles con readsb (adsb.lol, airplanes.live, adsb.fi). */
export interface ReadsbAircraft {
  hex: string;
  type?: string;
  flight?: string;
  r?: string;
  t?: string;
  desc?: string;
  ownOp?: string;
  dbFlags?: number;
  alt_baro?: number | 'ground';
  alt_geom?: number;
  gs?: number;
  track?: number;
  true_heading?: number;
  baro_rate?: number;
  geom_rate?: number;
  squawk?: string;
  category?: string;
  lat?: number;
  lon?: number;
  seen_pos?: number;
  mlat?: string[];
  lastPosition?: { lat: number; lon: number; seen_pos: number };
}

export function fromReadsb(ac: ReadsbAircraft, source: string, m: DgtMatcher = DEFAULT_DGT_MATCHER): Aircraft | null {
  const lat = ac.lat ?? ac.lastPosition?.lat;
  const lon = ac.lon ?? ac.lastPosition?.lon;
  if (lat == null || lon == null) return null;
  const onGround = ac.alt_baro === 'ground';
  const altFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : (ac.alt_geom ?? null);
  const base = {
    hex: ac.hex.replace(/^~/, '').toLowerCase(),
    reg: ac.r?.trim() || undefined,
    callsign: ac.flight?.trim() || undefined,
    type: ac.t?.trim() || undefined,
    desc: ac.desc?.trim() || undefined,
    operator: ac.ownOp?.trim() || undefined,
  };
  const isDgt = isDgtAircraft(base, m);
  return {
    ...base,
    lat,
    lon,
    altFt: onGround ? null : altFt,
    onGround,
    gsKt: ac.gs,
    track: ac.track ?? ac.true_heading,
    vertRateFpm: ac.baro_rate ?? ac.geom_rate,
    squawk: ac.squawk,
    seenPosS: ac.seen_pos ?? ac.lastPosition?.seen_pos,
    mlat: Array.isArray(ac.mlat) && ac.mlat.length > 0,
    isHeli: isDgt || isHelicopterRaw(base.type, ac.category, base.desc),
    isDgt,
    tag: tagFor({ ...base, military: !!(ac.dbFlags && ac.dbFlags & 1) }, isDgt),
    source,
  };
}

/** Vector de estado de OpenSky Network (`/api/states/all`). */
export type OpenSkyState = [
  string, // icao24
  string | null, // callsign
  string, // origin_country
  number | null, // time_position
  number, // last_contact
  number | null, // longitude
  number | null, // latitude
  number | null, // baro_altitude (m)
  boolean, // on_ground
  number | null, // velocity (m/s)
  number | null, // true_track
  number | null, // vertical_rate (m/s)
  number[] | null, // sensors
  number | null, // geo_altitude
  string | null, // squawk
  boolean, // spi
  number, // position_source
  number?, // category
];

export function fromOpenSky(s: OpenSkyState, nowS: number, m: DgtMatcher = DEFAULT_DGT_MATCHER): Aircraft | null {
  const [hex, cs, , timePos, , lon, lat, baroM, onGround, vel, track, vr, , geoM, squawk, , posSrc, cat] = s;
  if (lat == null || lon == null) return null;
  const base = { hex: hex.toLowerCase(), callsign: cs?.trim() || undefined };
  const isDgt = isDgtAircraft(base, m);
  const altM = baroM ?? geoM;
  return {
    ...base,
    lat,
    lon,
    altFt: onGround || altM == null ? null : Math.round(altM / 0.3048),
    onGround,
    gsKt: vel != null ? vel / 0.514444 : undefined,
    track: track ?? undefined,
    vertRateFpm: vr != null ? Math.round(vr * 196.85) : undefined,
    squawk: squawk ?? undefined,
    seenPosS: timePos != null ? Math.max(0, nowS - timePos) : undefined,
    mlat: posSrc === 2,
    isHeli: isDgt || cat === 8,
    isDgt,
    tag: isDgt ? 'DGT' : null,
    source: 'opensky',
  };
}

export function altitudeM(a: Aircraft): number | null {
  return a.altFt == null ? null : ftToM(a.altFt);
}

export function speedKmh(a: Aircraft): number | null {
  return a.gsKt == null ? null : ktToKmh(a.gsKt);
}
