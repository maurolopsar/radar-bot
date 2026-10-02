// Precios de carburantes en tiempo real (Ministerio para la Transición Ecológica).
// https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/

import type { FuelStation, FuelType } from '../../shared/types';
import { fetchJson } from '../lib/http';

export const FUEL_URL =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/EstacionesTerrestres/';

type Row = Record<string, string | undefined>;

const FIELDS: Record<FuelType, string[]> = {
  g95: ['Precio Gasolina 95 E5', 'Precio Gasolina 95 E10'],
  g98: ['Precio Gasolina 98 E5', 'Precio Gasolina 98 E10'],
  diesel: ['Precio Gasoleo A'],
  dieselPlus: ['Precio Gasoleo Premium'],
  glp: ['Precio Gases licuados del petróleo'],
};

const coord = (s: string | undefined) => {
  if (!s?.trim()) return undefined;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) && v !== 0 ? v : undefined;
};

const price = (s: string | undefined) => {
  const v = coord(s);
  return v != null && v > 0 ? v : undefined;
};

export function parseFuel(data: { ListaEESSPrecio?: Row[] }): FuelStation[] {
  const out: FuelStation[] = [];
  for (const r of data.ListaEESSPrecio ?? []) {
    const lat = coord(r['Latitud']);
    const lon = coord(r['Longitud (WGS84)']);
    if (lat == null || lon == null) continue;
    const prices: FuelStation['prices'] = {};
    for (const [k, fields] of Object.entries(FIELDS) as [FuelType, string[]][]) {
      for (const f of fields) {
        const p = price(r[f]);
        if (p != null) {
          prices[k] = p;
          break;
        }
      }
    }
    out.push({
      id: r['IDEESS'] ?? `${lat},${lon}`,
      name: (r['Rótulo'] ?? 'Gasolinera').trim(),
      lat,
      lon,
      address: r['Dirección']?.trim(),
      town: r['Localidad']?.trim() ?? r['Municipio']?.trim(),
      schedule: r['Horario']?.trim(),
      prices,
    });
  }
  return out;
}

export async function fetchFuel(): Promise<FuelStation[]> {
  return parseFuel(await fetchJson(FUEL_URL, { timeoutMs: 90_000 }));
}
