// Incidencias de tráfico de la DGT en DATEX II v3 (incluye balizas V16 conectadas,
// publicadas por la plataforma DGT 3.0). https://nap.dgt.es/dataset/incidencias-dgt-datex2-v3-7

import type { EventCategory, TrafficEvent } from '../../shared/types';
import { fetchText } from '../lib/http';
import { arr, coordsOf, num, parseXml, text, xsiType, type XNode } from '../lib/xml';

export const DGT_INCIDENTS_URLS = [
  'https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v37.xml',
  'https://nap.dgt.es/datex2/v3/dgt/SituationPublication/datex2_v36.xml',
];

/** Traducción de los subtipos DATEX II más habituales. */
const DETAIL_ES: Record<string, string> = {
  accident: 'Accidente',
  roadworks: 'Obras',
  maintenanceWork: 'Trabajos de mantenimiento',
  laneClosures: 'Carril cortado',
  roadClosed: 'Carretera cortada',
  carriagewayClosures: 'Calzada cortada',
  intermittentShortTermClosures: 'Cortes intermitentes',
  singleAlternateLineTraffic: 'Paso alternativo',
  narrowLanes: 'Carriles estrechos',
  lanesDeviated: 'Carriles desviados',
  newRoadworksLayout: 'Nuevo trazado por obras',
  doNotUseSpecifiedLanesOrCarriageways: 'No usar carriles señalizados',
  useOfSpecifiedLanesOrCarriagewaysAllowed: 'Uso de carriles habilitados',
  weightRestrictionInOperation: 'Restricción por peso',
  keepToTheLeft: 'Circular por la izquierda',
  slowTraffic: 'Tráfico lento',
  heavyTraffic: 'Tráfico denso',
  queuingTraffic: 'Retención',
  stationaryTraffic: 'Tráfico detenido',
  vehicleStuck: 'Vehículo detenido',
  vehicleOnFire: 'Vehículo ardiendo',
  brokenDownVehicle: 'Vehículo averiado',
  objectOnTheRoad: 'Objeto en la calzada',
  obstructionOnTheRoad: 'Obstáculo en la calzada',
  shedLoad: 'Carga caída',
  spillageOnTheRoad: 'Vertido en la calzada',
  rockfalls: 'Desprendimientos',
  avalanches: 'Aludes',
  flooding: 'Inundación',
  forestFire: 'Incendio forestal',
  damagedRoadSurface: 'Firme deteriorado',
  roadSurfaceInPoorCondition: 'Firme en mal estado',
  slipperyRoad: 'Calzada deslizante',
  fog: 'Niebla',
  frost: 'Hielo',
  snowfall: 'Nieve',
  strongWinds: 'Viento fuerte',
  visibilityReduced: 'Visibilidad reducida',
  badWeather: 'Mal tiempo',
  smokeHazard: 'Humo',
  heavyRain: 'Lluvia intensa',
  majorEvent: 'Evento',
  speedRestrictionInOperation: 'Limitación de velocidad',
  useSnowChainsOrTyres: 'Uso obligatorio de cadenas',
  driveCarefully: 'Circule con precaución',
};

function categoryOf(cause: string | undefined, detail: string | undefined, recordType: string, v16: boolean): EventCategory {
  if (v16) return 'v16';
  switch (cause) {
    case 'accident':
      return 'accident';
    case 'roadMaintenance':
      return 'roadworks';
    case 'abnormalTraffic':
      return 'jam';
    case 'poorEnvironment':
    case 'winterEquipmentManagement':
      return 'weather';
    case 'publicEvent':
      return 'event';
    case 'roadOrCarriagewayOrLaneManagement':
      return detail && /closed|closure/i.test(detail) ? 'closure' : 'restriction';
    case 'environmentalObstruction':
    case 'obstruction':
    case 'infrastructureDamageObstruction':
    case 'vehicleObstruction':
    case 'nonWeatherRelatedRoadConditions':
      return 'hazard';
  }
  if (recordType === 'SpeedManagement') return 'restriction';
  if (recordType === 'PoorEnvironmentConditions') return 'weather';
  if (recordType === 'AbnormalTraffic') return 'jam';
  return 'other';
}

/** Primer subtipo detallado (`*Type`) dentro del registro o de su causa. */
function detailOf(rec: XNode): string | undefined {
  const pools = [rec.cause?.detailedCauseType, rec];
  for (const pool of pools) {
    if (!pool || typeof pool !== 'object') continue;
    for (const [k, v] of Object.entries(pool)) {
      if (k === 'causeType' || k.startsWith('@_') || !k.endsWith('Type')) continue;
      if (['vehicleType', 'typeOfWeight', 'tpegSimplePointLocationType', 'tpegLinearLocationType'].includes(k)) continue;
      const t = text(v);
      if (t) return t;
    }
  }
  return undefined;
}

const SEVERITIES = new Set(['low', 'medium', 'high', 'highest']);

export function parseDgtIncidents(xml: string, now = Date.now()): TrafficEvent[] {
  const doc = parseXml(xml);
  const payload = doc.payload ?? doc.d2LogicalModel?.payloadPublication ?? doc;
  const out: TrafficEvent[] = [];
  for (const sit of arr(payload.situation)) {
    for (const rec of arr(sit.situationRecord)) {
      const status = text(rec.validity?.validityStatus);
      if (status === 'suspended') continue;
      const end = text(rec.validity?.validityTimeSpecification?.overallEndTime);
      if (end && Date.parse(end) < now) continue;
      const loc = rec.locationReference;
      const lt = xsiType(loc);
      let lat: number | undefined;
      let lon: number | undefined;
      let line: [number, number][] | undefined;
      let ext: XNode;
      let dirRoad: string | undefined;
      if (lt.includes('Linear')) {
        const tl = loc.tpegLinearLocation;
        const from = coordsOf(tl?.from);
        const to = coordsOf(tl?.to);
        if (from) [lat, lon] = [from.lat, from.lon];
        else if (to) [lat, lon] = [to.lat, to.lon];
        if (from && to) line = [[from.lon, from.lat], [to.lon, to.lat]];
        ext = tl?.from?._tpegNonJunctionPointExtension?.extendedTpegNonJunctionPoint;
        dirRoad = text(tl?._tpegLinearLocationExtension?.extendedTpegLinearLocation?.tpegDirectionRoad);
      } else {
        const tp = loc?.tpegPointLocation;
        const p = coordsOf(tp?.point) ?? coordsOf(loc?.pointByCoordinates);
        if (p) [lat, lon] = [p.lat, p.lon];
        ext = tp?.point?._tpegNonJunctionPointExtension?.extendedTpegNonJunctionPoint;
        dirRoad = text(tp?._tpegSimplePointExtension?.extendedTpegSimplePoint?.tpegDirectionRoad);
      }
      if (lat == null || lon == null) continue;
      const source = text(rec.source?.sourceIdentification) ?? '';
      const creationRef = text(rec.situationRecordCreationReference) ?? '';
      const cause = text(rec.cause?.causeType);
      const detail = detailOf(rec);
      const recordType = xsiType(rec);
      const v16 = source === 'DGT3.0' || creationRef.startsWith('D30_');
      const mgmt = text(rec.roadOrCarriagewayOrLaneManagementType);
      const closed = !!mgmt && /roadClosed|carriagewayClosures/.test(mgmt);
      const baseCategory = categoryOf(cause, detail, recordType, v16);
      const category = closed && !v16 && baseCategory !== 'accident' ? 'closure' : baseCategory;
      const sev = text(rec.severity) ?? text(sit.overallSeverity);
      const road = text(loc?.supplementaryPositionalDescription?.roadInformation?.roadName);
      const town = text(ext?.municipality);
      const province = text(ext?.province);
      let description = v16
        ? 'Vehículo detenido (baliza V16)'
        : ((detail && DETAIL_ES[detail]) ?? (cause && DETAIL_ES[cause]) ?? detail ?? cause ?? 'Incidencia');
      if (closed && !v16 && mgmt && DETAIL_ES[mgmt] && DETAIL_ES[mgmt] !== description) {
        description =
          category === 'accident' ? `${description} (${DETAIL_ES[mgmt].toLowerCase()})` : `${DETAIL_ES[mgmt]} (${description.toLowerCase()})`;
      }
      const limit = num(rec.temporarySpeedLimit);
      if (limit) description += ` (${limit} km/h)`;
      out.push({
        id: `dgt-${text(rec['@_id']) ?? sit['@_id']}`,
        source: 'dgt',
        category,
        subtype: detail,
        lat,
        lon,
        line,
        road,
        pk: num(ext?.kilometerPoint),
        description,
        severity: sev && SEVERITIES.has(sev) ? (sev as TrafficEvent['severity']) : undefined,
        startedAt: text(rec.validity?.validityTimeSpecification?.overallStartTime) ?? text(rec.situationRecordCreationTime),
        direction: dirRoad,
        town: [town, province].filter(Boolean).join(', ') || undefined,
      });
    }
  }
  return out;
}

export async function fetchDgtIncidents(): Promise<TrafficEvent[]> {
  let lastErr: unknown;
  for (const url of DGT_INCIDENTS_URLS) {
    try {
      return parseDgtIncidents(await fetchText(url, { timeoutMs: 60_000 }));
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}
