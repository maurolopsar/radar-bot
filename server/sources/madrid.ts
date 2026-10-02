// Radares fijos y de tramo del Ayuntamiento de Madrid (datos.madrid.es, CC BY 4.0).
// "Origen de los datos: Ayuntamiento de Madrid".

import type { Radar, Stretch } from '../../shared/types';
import { csvObjects } from '../lib/csv';
import { fetchJson, fetchText } from '../lib/http';

const DATASET = '300049-0-radares-fijos-moviles';
export const MADRID_PACKAGE_URL = `https://datos.madrid.es/api/3/action/package_show?id=${DATASET}`;
export const MADRID_CSV_URL = `https://datos.madrid.es/dataset/${DATASET}/resource/300049-1-radares-fijos-moviles-csv/download/300049-1-radares-fijos-moviles-csv.csv`;

const num = (s: string | undefined) => {
  if (!s) return undefined;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) && v !== 0 ? v : undefined;
};

const inMadrid = (lat?: number, lon?: number) => lat != null && lon != null && lat > 40.2 && lat < 40.7 && lon > -4 && lon < -3.4;

export function parseMadridCsv(csv: string): { radars: Radar[]; stretches: Stretch[] } {
  const radars: Radar[] = [];
  const stretches: Stretch[] = [];
  for (const row of csvObjects(csv, ';')) {
    const id = row['no radar'] || String(radars.length);
    const type = (row['tipo'] ?? '').toLowerCase();
    const lat = num(row['latitud']);
    const lon = num(row['longitud']);
    if (!inMadrid(lat, lon)) continue;
    const limit = num(row['velocidad limite']);
    const place = (row['ubicacion'] ?? '').replace(/\s+/g, ' ');
    const road = row['carretara o vial'] || row['carretera o vial'] || undefined;
    const direction = row['sentido'] || undefined;
    if (type.includes('tramo')) {
      const sLat = num(row['latitud inicio tramo']);
      const sLon = num(row['longitud inicio tramo']);
      const sectionId = `madrid-tramo-${id}`;
      if (inMadrid(sLat, sLon)) {
        stretches.push({
          id: sectionId,
          kind: 'section',
          coords: [
            [sLon!, sLat!],
            [lon!, lat!],
          ],
          maxspeed: limit,
          road,
          name: `Tramo ${place}`,
          direction,
          sources: ['madrid'],
        });
        radars.push({
          id: `${sectionId}-ini`,
          kind: 'section',
          lat: sLat!,
          lon: sLon!,
          maxspeed: limit,
          road,
          direction,
          sectionId,
          name: `Inicio de tramo: ${place}`,
          sources: ['madrid'],
        });
      }
      radars.push({
        id: `${sectionId}-fin`,
        kind: 'section',
        lat: lat!,
        lon: lon!,
        maxspeed: limit,
        road,
        direction,
        sectionId: inMadrid(sLat, sLon) ? sectionId : undefined,
        name: `Fin de tramo: ${place}`,
        sources: ['madrid'],
      });
    } else {
      radars.push({
        id: `madrid-${id}`,
        kind: type.includes('semaf') ? 'redlight' : 'fixed',
        lat: lat!,
        lon: lon!,
        maxspeed: limit,
        road,
        direction,
        name: place || `Radar fijo ${road ?? ''}`.trim(),
        sources: ['madrid'],
      });
    }
  }
  return { radars, stretches };
}

interface CkanPackage {
  result?: { resources?: { format?: string; url?: string }[] };
}

export async function fetchMadrid() {
  let url = MADRID_CSV_URL;
  try {
    const pkg = await fetchJson<CkanPackage>(MADRID_PACKAGE_URL, { timeoutMs: 20_000 });
    const csv = pkg.result?.resources?.find((r) => r.format?.toUpperCase() === 'CSV' && r.url);
    if (csv?.url) url = csv.url;
  } catch {
    // Se usa la URL conocida del recurso.
  }
  return parseMadridCsv(await fetchText(url));
}
