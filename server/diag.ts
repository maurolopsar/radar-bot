// Diagnóstico: comprueba desde el servidor el acceso a cada servicio externo.

import { errorMessage, fetchRaw } from './lib/http';
import { providerStatus } from './sources/aircraft';

const TARGETS: { name: string; url: string; group: string }[] = [
  { group: 'Aeronaves', name: 'adsb.lol', url: 'https://api.adsb.lol/v2/point/40.4/-3.7/5' },
  { group: 'Aeronaves', name: 'airplanes.live', url: 'https://api.airplanes.live/v2/point/40.4/-3.7/5' },
  { group: 'Aeronaves', name: 'adsb.fi', url: 'https://opendata.adsb.fi/api/v2/lat/40.4/lon/-3.7/dist/5' },
  { group: 'Aeronaves', name: 'OpenSky', url: 'https://opensky-network.org/api/states/all?lamin=40.3&lomin=-3.8&lamax=40.5&lomax=-3.6' },
  { group: 'Radares', name: 'DGT infocar', url: 'https://infocar.dgt.es/datex2/dgt/PredefinedLocationsPublication/radares/content.xml' },
  { group: 'Radares', name: 'DGT NAP', url: 'https://nap.dgt.es/datex2/dgt/PredefinedLocationsPublication/tramos_invive/content.xml' },
  { group: 'Radares', name: 'Servei Català de Trànsit', url: 'https://transit.gencat.cat/web/.content/documents/seguretat_viaria/radars-remolc.txt' },
  { group: 'Radares', name: 'Radares Anunciados', url: 'https://geiserx.github.io/radares-anunciados/status.json' },
  { group: 'Radares', name: 'Overpass (OSM)', url: 'https://overpass-api.de/api/status' },
  { group: 'Tráfico', name: 'Waze', url: 'https://www.waze.com/live-map/api/georss?top=40.42&bottom=40.40&left=-3.72&right=-3.70&env=row&types=alerts' },
  { group: 'Rutas', name: 'OSRM', url: 'https://router.project-osrm.org/route/v1/driving/-3.70,40.41;-3.69,40.42?overview=false' },
  { group: 'Rutas', name: 'Photon', url: 'https://photon.komoot.io/api/?q=Madrid&limit=1' },
  { group: 'Otros', name: 'Open-Meteo', url: 'https://api.open-meteo.com/v1/forecast?latitude=40.4&longitude=-3.7&current=temperature_2m' },
];

export interface DiagResult {
  group: string;
  name: string;
  ok: boolean;
  status?: number;
  ms: number;
  error?: string;
}

export async function runDiagnostics(): Promise<{ results: DiagResult[]; aircraft: Record<string, unknown> }> {
  const results = await Promise.all(
    TARGETS.map(async (t): Promise<DiagResult> => {
      const t0 = Date.now();
      try {
        const res = await fetchRaw(t.url, {
          timeoutMs: 10_000,
          headers: t.name === 'Waze' ? { Referer: 'https://www.waze.com/live-map/' } : {},
        });
        await res.body?.cancel();
        return { group: t.group, name: t.name, ok: true, status: res.status, ms: Date.now() - t0 };
      } catch (err) {
        const status = (err as { status?: number }).status;
        return { group: t.group, name: t.name, ok: false, status, ms: Date.now() - t0, error: errorMessage(err) };
      }
    }),
  );
  return { results, aircraft: Object.fromEntries(providerStatus) };
}
