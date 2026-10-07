// Radares de administraciones con competencias propias, consultados directamente
// (algunas solo responden a IP española: funcionan con el servidor en casa).
//
// - Euskadi (Trafikoa, Gobierno Vasco): página «Cabinas de radar fijo».
// - Navarra (Visor de Tráfico): API del visor.
// - Donostia / San Sebastián: capa ArcGIS de radares municipales.

import type { Radar } from '../../shared/types';
import { utmToLatLon } from '../../shared/utm';
import { fetchJson, fetchText } from '../lib/http';

export const EUSKADI_URL = 'https://apps.trafikoa.euskadi.eus/lfr/web/trafikoa/cabinas-de-radar-fijo';
export const NAVARRA_API = 'https://visorcontroltrafico.navarra.es/gn.visortrafico.web.internet/api/openits/elements/radars';
export const DONOSTIA_URL =
  'https://www.donostia.eus/geozerbitzuak/rest/services/ext/GARRAIOA/MapServer/41/query?where=1%3D1&outFields=*&outSR=4326&f=geojson';

const slug = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** "80 km/h" -> 80; "60/80 km/h" -> 80; "-" -> undefined. */
function speedOf(text: string): number | undefined {
  const nums = (text.match(/\d+/g) ?? []).map(Number).filter((n) => n >= 10 && n <= 130);
  return nums.length ? Math.max(...nums) : undefined;
}

const BLOCK = /var x = (-?[\d.]+);\s*var y = (-?[\d.]+);\s*var th = "([^"]*)";[\s\S]*?var popupValores = (\[[^\]]*\]);/g;

export function parseEuskadi(html: string): Radar[] {
  const out: Radar[] = [];
  const ids = new Set<string>();
  for (const m of html.matchAll(BLOCK)) {
    let values: string[];
    try {
      values = (JSON.parse(m[4]) as unknown[]).map((v) => String(v).trim());
    } catch {
      continue;
    }
    const [name, direction, , , road, km, limit] = values;
    if (!name || /FOTO.?ROJO/i.test(name)) continue;
    const { lat, lon } = utmToLatLon(Number(m[1]), Number(m[2]), 30);
    if (!(lat > 42.4 && lat < 43.5 && lon > -3.5 && lon < -1.7)) continue;
    const section = /TRAMO/i.test(name);
    let id = `euskadi-${slug(name)}`;
    for (let n = 2; ids.has(id); n++) id = `euskadi-${slug(name)}-${n}`;
    ids.add(id);
    const pk = Number(km);
    out.push({
      id,
      kind: section ? 'section' : 'fixed',
      lat,
      lon,
      maxspeed: speedOf(limit ?? ''),
      road: road || undefined,
      pk: Number.isFinite(pk) ? pk : undefined,
      direction: direction || undefined,
      name: `${section ? 'Radar de tramo' : 'Radar fijo'} ${road ?? ''}${Number.isFinite(pk) ? ` km ${pk.toFixed(1)}` : ''} (${name})`.trim(),
      sources: ['euskadi'],
    });
  }
  return out;
}

/** "A1" -> "A-1", "N121A" -> "N-121-A". */
function roadName(code: string): string {
  const m = /^([A-Z]+)(\d+)([A-Z]?)$/.exec(code);
  return m ? `${m[1]}-${m[2]}${m[3] ? `-${m[3]}` : ''}` : code;
}

const NAV_NAME = /([A-Z]+\d+[A-Z]?)PK(\d+)\+(\d+)([CD])\s*$/;

export function parseNavarra(json: { data?: { elemento?: { elemento?: string; punto?: { lon?: number; lat?: number } }[] } }): Radar[] {
  const out: Radar[] = [];
  for (const el of json.data?.elemento ?? []) {
    const m = NAV_NAME.exec(el.elemento ?? '');
    const p = el.punto;
    if (!m || p?.lon == null || p.lat == null) continue;
    // La API llama "lon" a la coordenada X (UTM) y "lat" a la Y.
    const { lat, lon } = utmToLatLon(p.lon, p.lat, 30);
    const road = roadName(m[1]);
    const km = Number(`${m[2]}.${m[3]}`);
    const dir = m[4] === 'C' ? 'creciente' : 'decreciente';
    out.push({
      id: `navarra-${road}-${km.toFixed(1)}-${m[4]}`,
      kind: 'fixed',
      lat,
      lon,
      road,
      pk: km,
      direction: dir,
      name: `Radar fijo ${road} km ${km.toFixed(1)} (sentido ${dir})`,
      sources: ['navarra'],
    });
  }
  return out;
}

export function parseDonostia(fc: { features?: { geometry?: { type: string; coordinates: number[] }; properties?: Record<string, unknown> }[] }): Radar[] {
  const out: Radar[] = [];
  for (const f of fc.features ?? []) {
    if (f.geometry?.type !== 'Point') continue;
    const [lon, lat] = f.geometry.coordinates;
    const street = String(f.properties?.IzenKalea ?? '').trim();
    const limit = Number(f.properties?.Abiadura);
    out.push({
      id: `donostia-${lat.toFixed(5)}_${lon.toFixed(5)}`,
      kind: 'fixed',
      lat,
      lon,
      maxspeed: limit > 0 ? limit : undefined,
      name: street ? `Radar fijo ${street}, Donostia` : 'Radar fijo, Donostia',
      sources: ['donostia'],
    });
  }
  return out;
}

export async function fetchRegional() {
  const [eus, nav, don] = await Promise.allSettled([
    fetchText(EUSKADI_URL, { timeoutMs: 30_000 }).then(parseEuskadi),
    fetchJson<Parameters<typeof parseNavarra>[0]>(NAVARRA_API, {
      method: 'POST',
      body: JSON.stringify({ admin: false, order: '-fecha', filters: {} }),
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'GNVisorTraficoInternet', 'X-Api-Version': '1' },
      timeoutMs: 30_000,
    }).then(parseNavarra),
    fetchJson<Parameters<typeof parseDonostia>[0]>(DONOSTIA_URL, { timeoutMs: 30_000 }).then(parseDonostia),
  ]);
  const radars = [eus, nav, don].flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  if (!radars.length) {
    const reasons = [eus, nav, don].map((r) => (r.status === 'rejected' ? String((r.reason as Error).message) : 'vacío'));
    throw new Error(`Euskadi: ${reasons[0]} · Navarra: ${reasons[1]} · Donostia: ${reasons[2]}`);
  }
  return { radars, stretches: [] };
}
