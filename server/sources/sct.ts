// Radares del Servei Català de Trànsit (Cataluña).
// https://transit.gencat.cat/ca/seguretat_viaria/cinemometres-fixos-trams-mobils/
// Coordenadas ETRS89 UTM 31N con coma decimal. Llicència oberta d'ús d'informació – Catalunya.

import type { Radar } from '../../shared/types';
import { utmToLatLon } from '../../shared/utm';
import { fetchText } from '../lib/http';

export const SCT_FIXED_URL = 'https://transit.gencat.cat/web/.content/documents/seguretat_viaria/radars.txt';
export const SCT_TRAILER_URL = 'https://transit.gencat.cat/web/.content/documents/seguretat_viaria/radars-remolc.txt';

const HEADER = ['Via', 'PK', 'Velocitat', 'X', 'Y'];
const PK_RE = /^(\d+(?:,\d+)?)(?:\s*-\s*(\d+(?:,\d+)?))?$/;

const n = (s: string) => Number(s.replace(',', '.'));

function toRadar(cols: string[], idx: number, trailer: boolean): Radar | null {
  if (cols.length < 5) return null;
  const [road, pk, speed, x, y] = cols.map((c) => c.trim());
  const pkm = PK_RE.exec(pk);
  const easting = n(x);
  const northing = n(y);
  if (!road || !pkm || !/^\d{2,3}$/.test(speed)) return null;
  // Filas con coordenadas rotas (sin coma decimal, dos valores pegados...) se descartan.
  if (!(easting > 240_000 && easting < 540_000 && northing > 4_480_000 && northing < 4_760_000)) return null;
  const { lat, lon } = utmToLatLon(easting, northing, 31);
  const section = !trailer && pkm[2] != null;
  const km = n(pkm[1]);
  return {
    id: `sct-${trailer ? 'rem' : 'fix'}-${idx}`,
    kind: trailer ? 'trailer' : section ? 'section' : 'fixed',
    lat,
    lon,
    maxspeed: Number(speed),
    road,
    pk: km,
    name: `${trailer ? 'Radar remolque' : section ? 'Radar de tramo' : 'Radar fijo'} ${road} km ${pk.replace(/\s+/g, '')}`,
    sources: ['sct'],
  };
}

export function parseSctFixed(txt: string): Radar[] {
  const lines = txt.split(/\r?\n/);
  const hi = lines.findIndex((l) => l.trim().split(/\s+/).join(' ') === HEADER.join(' '));
  if (hi < 0) throw new Error('radars.txt sin cabecera Via PK Velocitat X Y');
  const header = lines[hi];
  const starts = HEADER.map((h) => header.indexOf(h));
  const out: Radar[] = [];
  lines.slice(hi + 1).forEach((line, i) => {
    if (!line.trim()) return;
    const cols = starts.map((s, j) => line.slice(s, j + 1 < starts.length ? starts[j + 1] : undefined));
    const r = toRadar(cols, i, false);
    if (r) out.push(r);
  });
  return out;
}

export function parseSctTrailer(txt: string): Radar[] {
  const lines = txt.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length || lines[0].split('\t').map((c) => c.trim()).join(' ') !== HEADER.join(' ')) {
    throw new Error('radars-remolc.txt sin cabecera');
  }
  const out: Radar[] = [];
  lines.slice(1).forEach((line, i) => {
    const r = toRadar(line.split('\t'), i, true);
    if (r) out.push(r);
  });
  return out;
}

export async function fetchSct() {
  const [fixed, trailer] = await Promise.allSettled([
    fetchText(SCT_FIXED_URL, { encoding: 'latin1' }).then(parseSctFixed),
    fetchText(SCT_TRAILER_URL, { encoding: 'latin1' }).then(parseSctTrailer),
  ]);
  if (fixed.status === 'rejected' && trailer.status === 'rejected') throw fixed.reason;
  return {
    radars: [...(fixed.status === 'fulfilled' ? fixed.value : []), ...(trailer.status === 'fulfilled' ? trailer.value : [])],
    stretches: [],
  };
}
