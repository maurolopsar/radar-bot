// Capas añadidas al mapa base: carreteras reforzadas, rutas, curvas, avisos de
// la vía y puertas de los tramos cronometrados.

import { effect } from '@preact/signals';
import type { Feature as GeoFeature, FeatureCollection, Geometry } from 'geojson';
import type { GeoJSONSource, LayerSpecification, Map as MLMap } from 'maplibre-gl';
import { GRADE_COLOR } from '../../shared/curves';
import { activeRoute, navActive, routes, selectedRoute } from '../services/nav';
import { areaCurves, pendingStart, segments } from '../services/rally';
import { roadHazards } from '../services/road';
import { settings } from '../state/settings';
import { follow, isDark } from '../state/store';

type Feature = GeoFeature<Geometry, Record<string, unknown>>;
type FC = FeatureCollection<Geometry, Record<string, unknown>>;
const fc = (features: Feature[]): FC => ({ type: 'FeatureCollection', features });
const line = (coords: [number, number][], properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties,
});
const point = (lon: number, lat: number, properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});

const EXTRA_SOURCES = ['navAlt', 'navMain', 'curves', 'hazards', 'gates'] as const;
type ExtraSource = (typeof EXTRA_SOURCES)[number];
const cache: Partial<Record<ExtraSource, FC>> = {};

function set(map: MLMap, id: ExtraSource, data: FC): void {
  cache[id] = data;
  (map.getSource(id) as GeoJSONSource | undefined)?.setData(data);
}

// ---------------------------------------------------------------------------
// Carreteras reforzadas: se dibujan encima del mapa base con más grosor y
// contraste, usando la misma fuente vectorial (esquema OpenMapTiles).

const ROAD_CLASSES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];

function widthExpr(scale: number): unknown {
  const base = ['match', ['get', 'class'], 'motorway', 2.6, 'trunk', 2.4, 'primary', 2.0, 'secondary', 1.7, 'tertiary', 1.5, 'minor', 1.1, 0.7];
  return ['interpolate', ['exponential', 1.6], ['zoom'], 8, ['*', base, 0.35 * scale], 12, ['*', base, 1.1 * scale], 15, ['*', base, 3.2 * scale], 18, ['*', base, 9 * scale]];
}

function roadColors(dark: boolean): { casing: string; fill: unknown } {
  return dark
    ? {
        casing: '#05080f',
        fill: ['match', ['get', 'class'], 'motorway', '#c27c25', 'trunk', '#a96d22', 'primary', '#8b7337', 'secondary', '#6b7a90', 'tertiary', '#5e6b7e', '#4b5565'],
      }
    : {
        casing: '#8b95a3',
        fill: ['match', ['get', 'class'], 'motorway', '#f6a94a', 'trunk', '#f8c25c', 'primary', '#fde38a', '#ffffff'],
      };
}

export function addRoadBoost(map: MLMap): void {
  for (const id of ['boost-casing', 'boost-fill']) if (map.getLayer(id)) map.removeLayer(id);
  if (!settings.peek().boostRoads) return;
  const style = map.getStyle();
  const src = Object.entries(style.sources ?? {}).find(([, s]) => s.type === 'vector')?.[0];
  if (!src) return;
  const firstSymbol = style.layers?.find((l) => l.type === 'symbol')?.id;
  const { casing, fill } = roadColors(isDark.peek());
  const filter = ['all', ['in', ['get', 'class'], ['literal', ROAD_CLASSES]], ['!=', ['get', 'brunnel'], 'tunnel']];
  map.addLayer(
    {
      id: 'boost-casing',
      type: 'line',
      source: src,
      'source-layer': 'transportation',
      minzoom: 9,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': casing, 'line-width': widthExpr(1.35), 'line-opacity': 0.9 },
    } as LayerSpecification,
    firstSymbol,
  );
  map.addLayer(
    {
      id: 'boost-fill',
      type: 'line',
      source: src,
      'source-layer': 'transportation',
      minzoom: 9,
      filter,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': fill, 'line-width': widthExpr(1) },
    } as LayerSpecification,
    firstSymbol,
  );
}

// ---------------------------------------------------------------------------

export function setupExtraLayers(map: MLMap): void {
  for (const id of EXTRA_SOURCES) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: cache[id] ?? fc([]) });
  addRoadBoost(map);
  const before = map.getLayer('stretches-line') ? 'stretches-line' : undefined;
  const add = (layer: LayerSpecification, beforeId = before) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer, beforeId && map.getLayer(beforeId) ? beforeId : undefined);
  };
  add({
    id: 'navAlt-line',
    type: 'line',
    source: 'navAlt',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#94a3b8', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 4, 15, 9], 'line-opacity': 0.85 },
  });
  add({
    id: 'navMain-casing',
    type: 'line',
    source: 'navMain',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#1e3a8a', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 6, 15, 13] },
  });
  add({
    id: 'navMain-line',
    type: 'line',
    source: 'navMain',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#3b82f6', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 15, 8] },
  });
  add({
    id: 'curves-line',
    type: 'line',
    source: 'curves',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['match', ['get', 'grade'], 1, GRADE_COLOR[1], 2, GRADE_COLOR[2], 3, GRADE_COLOR[3], 4, GRADE_COLOR[4], 5, GRADE_COLOR[5], GRADE_COLOR[6]],
      'line-width': ['interpolate', ['linear'], ['zoom'], 11, 3, 16, 9],
      'line-opacity': 0.9,
    },
  });
  add(
    {
      id: 'gates-circle',
      type: 'circle',
      source: 'gates',
      paint: {
        'circle-radius': 10,
        'circle-color': ['match', ['get', 'role'], 'start', '#16a34a', 'pending', '#f59e0b', '#dc2626'],
        'circle-stroke-color': '#fff',
        'circle-stroke-width': 3,
      },
    },
    undefined,
  );
  add(
    {
      id: 'hazards-sym',
      type: 'symbol',
      source: 'hazards',
      minzoom: 12,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.55, 16, 0.85],
      },
    },
    undefined,
  );
  applyExtraVisibility(map);
}

function applyExtraVisibility(map: MLMap): void {
  const s = settings.peek();
  const vis: Record<string, boolean> = { 'curves-line': s.rallyMode && s.showCurves, 'gates-circle': s.rallyMode, 'hazards-sym': true };
  for (const [id, on] of Object.entries(vis)) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
}

function bboxOfCoords(list: [number, number][][]): [[number, number], [number, number]] | null {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const coords of list)
    for (const [lon, lat] of coords) {
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
  return Number.isFinite(w) ? [[w, s], [e, n]] : null;
}

/** Suscripciones que actualizan las capas extra. Devuelve funciones para cancelarlas. */
export function extraEffects(map: MLMap): (() => void)[] {
  return [
    effect(() => {
      const list = routes.value;
      const sel = selectedRoute.value;
      const nav = navActive.value;
      const main = activeRoute.value;
      set(map, 'navMain', fc(main ? [line(main.coords, { idx: sel })] : []));
      set(map, 'navAlt', fc(nav ? [] : list.map((r, i) => ({ r, i })).filter((x) => x.i !== sel).map(({ r, i }) => line(r.coords, { idx: i }))));
    }),
    effect(() => {
      // Al calcular rutas (sin navegar), se encuadran todas.
      const list = routes.value;
      if (!list.length || navActive.peek()) return;
      const b = bboxOfCoords(list.map((r) => r.coords));
      if (!b) return;
      follow.value = false;
      const side = window.matchMedia('(orientation: landscape) and (max-height: 560px), (min-width: 900px)').matches;
      map.fitBounds(b, {
        padding: side ? { top: 40, bottom: 40, left: Math.min(440, window.innerWidth * 0.46) + 24, right: 80 } : { top: 120, bottom: window.innerHeight * 0.5, left: 30, right: 80 },
        maxZoom: 15,
        bearing: 0,
        pitch: 0,
        duration: 800,
      });
    }),
    effect(() => {
      set(map, 'curves', fc(areaCurves.value.map((c) => line(c.coords, { grade: c.grade }))));
    }),
    effect(() => {
      const kinds = settings.value.hazards;
      set(map, 'hazards', fc(roadHazards.value.filter((h) => kinds[h.type]).map((h) => point(h.lon, h.lat, { id: h.id, icon: `hz-${h.type}` }))));
    }),
    effect(() => {
      const feats: Feature[] = [];
      for (const s of segments.value) {
        feats.push(point(s.start.lon, s.start.lat, { role: 'start', id: s.id }));
        feats.push(point(s.end.lon, s.end.lat, { role: 'end', id: s.id }));
      }
      const p = pendingStart.value;
      if (p) feats.push(point(p.lon, p.lat, { role: 'pending' }));
      set(map, 'gates', fc(feats));
    }),
    effect(() => {
      void settings.value.rallyMode;
      void settings.value.showCurves;
      applyExtraVisibility(map);
    }),
    effect(() => {
      void settings.value.boostRoads;
      void isDark.value;
      if (map.isStyleLoaded()) addRoadBoost(map);
    }),
  ];
}
