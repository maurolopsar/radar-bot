// Radares de OpenStreetMap vía Overpass API (ODbL, © colaboradores de OpenStreetMap).
// Se usa desde el servidor (toda España) y desde la app como respaldo (zona).

import { bearingDeg, parseBearing, parseMaxspeed, type BBox } from './geo';
import type { Radar, RadarKind, Stretch } from './types';

export const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

/** Consulta Overpass: cámaras `highway=speed_camera` y relaciones `type=enforcement`. */
export function overpassRadarQuery(area: 'ES' | BBox, timeoutS = 180): string {
  const scope =
    area === 'ES'
      ? 'area["ISO3166-1"="ES"][admin_level=2]->.a;'
      : '';
  const filter = area === 'ES' ? '(area.a)' : `(${area.south},${area.west},${area.north},${area.east})`;
  return (
    `[out:json][timeout:${timeoutS}];${scope}` +
    `node["highway"="speed_camera"]${filter}->.cams;` +
    `relation["type"="enforcement"]${filter}->.enf;` +
    `.cams out body qt;.enf out body qt;` +
    `node(r.enf)->.members;.members out skel qt;`
  );
}

interface OsmElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  members?: { type: string; ref: number; role: string }[];
}

export interface OverpassResult {
  elements: OsmElement[];
}

const ENFORCEMENT_KIND: Record<string, RadarKind | 'avg'> = {
  maxspeed: 'fixed',
  traffic_signals: 'redlight',
  average_speed: 'avg',
};

export function parseOverpassRadars(json: OverpassResult): { radars: Radar[]; stretches: Stretch[] } {
  const nodes = new Map<number, OsmElement>();
  for (const el of json.elements) if (el.type === 'node' && el.lat != null) nodes.set(el.id, el);

  const radars: Radar[] = [];
  const stretches: Stretch[] = [];
  const usedDevices = new Set<number>();

  for (const el of json.elements) {
    if (el.type !== 'relation' || el.tags?.type !== 'enforcement') continue;
    const kind = ENFORCEMENT_KIND[el.tags.enforcement ?? ''];
    if (!kind) continue;
    const m = el.members ?? [];
    const pick = (role: string) =>
      m.filter((x) => x.role === role && x.type === 'node').map((x) => nodes.get(x.ref)).filter(Boolean) as OsmElement[];
    const devices = pick('device');
    const from = pick('from')[0];
    const to = pick('to')[0];
    const maxspeed = parseMaxspeed(el.tags.maxspeed);
    if (kind === 'avg') {
      if (from && to) {
        const id = `osm-r${el.id}`;
        stretches.push({
          id,
          kind: 'section',
          coords: [
            [from.lon!, from.lat!],
            [to.lon!, to.lat!],
          ],
          maxspeed,
          name: el.tags.name ?? 'Tramo de velocidad media (OSM)',
          sources: ['osm'],
        });
        for (const [end, n] of [
          ['ini', from],
          ['fin', to],
        ] as const) {
          radars.push({
            id: `${id}-${end}`,
            kind: 'section',
            lat: n.lat!,
            lon: n.lon!,
            maxspeed,
            sectionId: id,
            name: `Radar de tramo (${end === 'ini' ? 'inicio' : 'fin'})`,
            sources: ['osm'],
          });
        }
      }
      continue;
    }
    for (const d of devices.length ? devices : from ? [from] : []) {
      usedDevices.add(d.id);
      const heading =
        from && from.id !== d.id ? bearingDeg(from.lat!, from.lon!, d.lat!, d.lon!) : undefined;
      radars.push({
        id: `osm-r${el.id}-${d.id}`,
        kind: kind as RadarKind,
        lat: d.lat!,
        lon: d.lon!,
        maxspeed: maxspeed ?? parseMaxspeed(d.tags?.maxspeed),
        heading,
        name: el.tags.name ?? d.tags?.name,
        sources: ['osm'],
      });
    }
  }

  for (const el of json.elements) {
    if (el.type !== 'node' || el.tags?.highway !== 'speed_camera' || usedDevices.has(el.id)) continue;
    const t = el.tags;
    const redlight = /traffic_signals|red/i.test(t['enforcement'] ?? t['speed_camera'] ?? '');
    radars.push({
      id: `osm-n${el.id}`,
      kind: redlight ? 'redlight' : 'fixed',
      lat: el.lat!,
      lon: el.lon!,
      maxspeed: parseMaxspeed(t.maxspeed),
      direction: t.direction != null && parseBearing(t.direction) != null ? `${t.direction}` : undefined,
      name: t.name ?? t.ref,
      sources: ['osm'],
    });
  }
  return { radars, stretches };
}

/** Consulta de la vía más cercana (límite de velocidad, nombre y referencia). */
export function overpassRoadQuery(lat: number, lon: number, radiusM = 30): string {
  return (
    `[out:json][timeout:15];way(around:${radiusM},${lat},${lon})["highway"]` +
    `["highway"!~"footway|path|cycleway|steps|pedestrian|service|track|bridleway|corridor|platform|proposed|construction"];` +
    `out tags geom qt;`
  );
}
