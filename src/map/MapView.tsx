import { effect } from '@preact/signals';
import maplibregl, { type GeoJSONSource, type LngLatLike, type Map as MLMap, type MapGeoJSONFeature } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'preact/hooks';
import { relevantAircraft, allRadars, extrapolate } from '../services/engine';
import { settings } from '../state/settings';
import {
  activeAlerts,
  aircraft,
  cameras,
  dataset,
  events,
  fleet,
  follow,
  fuel,
  isDark,
  manualZoom,
  pickMode,
  position,
  reportAt,
  reports,
  selected,
  sheet,
  simPoints,
  simRoute,
} from '../state/store';
import { drawIcon, KIND_COLORS, PIXEL_RATIO } from './icons';
import { styleFor } from './styles';
import type { Feature as GeoFeature, FeatureCollection, Geometry } from 'geojson';
import type { Aircraft } from '../../shared/types';

type Feature = GeoFeature<Geometry, Record<string, unknown>>;
type FC = FeatureCollection<Geometry, Record<string, unknown>>;

const fc = (features: Feature[]): FC => ({ type: 'FeatureCollection', features });
const pt = (lon: number, lat: number, properties: Record<string, unknown>): Feature => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties,
});

export let mapInstance: MLMap | null = null;

const SOURCES = ['stretches', 'eventLines', 'route', 'focus', 'radars', 'fuel', 'cameras', 'events', 'reports', 'aircraft'] as const;
type SourceId = (typeof SOURCES)[number];
const lastData: Partial<Record<SourceId, FC>> = {};

function setData(map: MLMap, id: SourceId, data: FC): void {
  lastData[id] = data;
  const src = map.getSource(id) as GeoJSONSource | undefined;
  src?.setData(data);
}

const CLICKABLE = ['aircraft-sym', 'reports-sym', 'events-sym', 'radars-sym', 'radars-dot', 'cameras-sym', 'fuel-sym', 'stretches-line', 'eventLines-line'];

function setupLayers(map: MLMap): void {
  for (const id of SOURCES) {
    if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: lastData[id] ?? fc([]) });
  }
  const add = (layer: maplibregl.LayerSpecification) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  };
  add({
    id: 'route-line',
    type: 'line',
    source: 'route',
    paint: { 'line-color': '#2563eb', 'line-width': 6, 'line-opacity': 0.55 },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  });
  add({
    id: 'stretches-line',
    type: 'line',
    source: 'stretches',
    paint: {
      'line-color': ['match', ['get', 'kind'], 'section', KIND_COLORS.section, KIND_COLORS.mobile],
      'line-width': ['interpolate', ['linear'], ['zoom'], 7, 2, 14, 6],
      'line-opacity': 0.75,
      'line-dasharray': ['match', ['get', 'kind'], 'section', ['literal', [2, 1]], ['literal', [1, 1.5]]],
    },
    layout: { 'line-cap': 'butt' },
  });
  add({
    id: 'eventLines-line',
    type: 'line',
    source: 'eventLines',
    paint: {
      'line-color': ['match', ['get', 'category'], 'jam', '#dc2626', 'roadworks', '#f97316', 'closure', '#111827', '#d97706'],
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 15, 8],
      'line-opacity': 0.7,
    },
    layout: { 'line-cap': 'round', 'line-join': 'round' },
  });
  add({
    id: 'focus-ring',
    type: 'circle',
    source: 'focus',
    paint: {
      'circle-radius': 26,
      'circle-color': ['get', 'color'],
      'circle-opacity': 0.25,
      'circle-stroke-color': ['get', 'color'],
      'circle-stroke-width': 3,
    },
  });
  add({
    id: 'radars-dot',
    type: 'circle',
    source: 'radars',
    maxzoom: 10,
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 2, 10, 5],
      'circle-color': ['match', ['get', 'kind'], 'section', KIND_COLORS.section, 'redlight', KIND_COLORS.redlight, 'mobile', KIND_COLORS.mobile, 'trailer', KIND_COLORS.trailer, KIND_COLORS.fixed],
      'circle-stroke-color': '#fff',
      'circle-stroke-width': 1,
    },
  });
  const symbol = (id: string, source: SourceId, extra: Partial<maplibregl.SymbolLayerSpecification> = {}) =>
    add({
      id,
      type: 'symbol',
      source,
      ...extra,
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 9, 0.7, 15, 1],
        ...extra.layout,
      },
    } as maplibregl.SymbolLayerSpecification);
  symbol('radars-sym', 'radars', { minzoom: 10 });
  symbol('fuel-sym', 'fuel', { minzoom: 11 });
  symbol('cameras-sym', 'cameras', { minzoom: 9 });
  symbol('events-sym', 'events');
  symbol('reports-sym', 'reports', { layout: { 'icon-anchor': 'bottom' } });
  symbol('aircraft-sym', 'aircraft', {
    layout: {
      'icon-rotate': ['get', 'rot'],
      'icon-rotation-alignment': 'map',
      'icon-size': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 12, 0.9],
    },
  });
  applyVisibility(map);
}

function applyVisibility(map: MLMap): void {
  const l = settings.value.layers;
  const vis: Record<string, boolean> = {
    'radars-dot': l.radars,
    'radars-sym': l.radars,
    'stretches-line': l.stretches,
    'events-sym': l.events,
    'eventLines-line': l.jams,
    'aircraft-sym': l.aircraft && settings.value.aircraft,
    'reports-sym': l.reports,
    'fuel-sym': l.fuel,
    'cameras-sym': l.cameras,
  };
  for (const [id, on] of Object.entries(vis)) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  }
}

function aircraftIconId(a: Aircraft): string {
  if (a.isDgt) return 'ac-dgt';
  if (a.isHeli) return a.tag === 'Guardia Civil' || a.tag === 'Policía' ? 'ac-police' : 'ac-heli';
  return 'ac-plane';
}

let aircraftStamp = Date.now();

function aircraftFeatures(): FC {
  const s = settings.value;
  const map = new Map<string, Aircraft>();
  for (const a of [...fleet.value, ...aircraft.value]) map.set(a.hex, a);
  for (const a of relevantAircraft()) map.set(a.hex, a);
  const out: Feature[] = [];
  for (const a of map.values()) {
    if (!a.isDgt && !(a.isHeli && s.showAllHelis) && !s.showAllAircraft) continue;
    const p = extrapolate(a, aircraftStamp);
    out.push(pt(p.lon, p.lat, { id: a.hex, icon: aircraftIconId(a), rot: a.track ?? 0, dgt: a.isDgt }));
  }
  return fc(out);
}

function fuelFeatures(): FC {
  const type = settings.value.fuelType;
  const priced = fuel.value.filter((f) => f.prices[type] != null);
  const sorted = priced.map((f) => f.prices[type]!).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length / 3)] ?? 0;
  const hi = sorted[Math.floor((sorted.length * 2) / 3)] ?? Infinity;
  return fc(
    priced.map((f) => {
      const p = f.prices[type]!;
      const tier = p <= lo ? 'low' : p >= hi ? 'high' : 'mid';
      return pt(f.lon, f.lat, { id: f.id, icon: `fuel-${p.toFixed(3)}-${tier}` });
    }),
  );
}

function zoomForSpeed(kmh: number): number {
  if (kmh < 25) return 16.5;
  if (kmh < 55) return 16;
  if (kmh < 85) return 15.2;
  if (kmh < 105) return 14.6;
  return 14.1;
}

export function recenter(): void {
  follow.value = true;
  manualZoom.value = null;
  const p = position.value;
  if (p && mapInstance) moveCamera(mapInstance, true);
}

let programmatic = false;

function moveCamera(map: MLMap, immediate = false): void {
  // peek(): no crea dependencias en los effects que llaman a esta función.
  const p = position.peek();
  if (!p) return;
  const s = settings.peek();
  const h = map.getContainer().clientHeight;
  // En horizontal / escritorio los paneles van a la izquierda: se centra en la zona libre.
  const side = window.matchMedia('(orientation: landscape) and (max-height: 560px), (min-width: 900px)').matches;
  const left = side ? Math.min(420, window.innerWidth * 0.46) + 16 : 0;
  const headingUp = s.headingUp && p.heading != null && (p.speed ?? 0) > 1.5;
  const zoom = manualZoom.peek() ?? zoomForSpeed((p.speed ?? 0) * 3.6);
  programmatic = true;
  map.easeTo({
    center: [p.lon, p.lat] as LngLatLike,
    bearing: s.headingUp ? (headingUp ? p.heading! : map.getBearing()) : 0,
    pitch: s.headingUp ? 45 : 0,
    zoom,
    padding: { top: s.headingUp ? h * (side ? 0.3 : 0.38) : h * 0.12, bottom: 0, left, right: side ? 60 : 0 },
    duration: immediate ? 600 : 950,
    easing: (t) => t,
  });
  map.once('moveend', () => (programmatic = false));
}

export function flyTo(lat: number, lon: number, zoom = 15): void {
  follow.value = false;
  mapInstance?.flyTo({ center: [lon, lat], zoom, padding: { top: 0, bottom: 0, left: 0, right: 0 } });
}

export function MapView() {
  const el = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let styleKey = `${settings.value.mapStyle}:${isDark.value}`;
    const map = new maplibregl.Map({
      container: el.current!,
      style: styleFor(settings.value.mapStyle, isDark.value),
      center: [-3.7, 40.2],
      zoom: 5.3,
      attributionControl: { compact: true },
      maxPitch: 60,
      fadeDuration: 0,
    });
    mapInstance = map;

    map.on('styleimagemissing', (e) => {
      if (map.hasImage(e.id)) return;
      const img = drawIcon(e.id);
      if (img) map.addImage(e.id, img, { pixelRatio: PIXEL_RATIO });
    });
    map.on('style.load', () => setupLayers(map));

    // Interacción del usuario: deja de seguir la posición.
    const stopFollow = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && !programmatic) follow.value = false;
    };
    map.on('dragstart', stopFollow);
    map.on('zoomend', (e) => {
      if (e.originalEvent && follow.value) manualZoom.value = map.getZoom();
    });

    // Toque en elementos del mapa.
    map.on('click', (e) => {
      const mode = pickMode.value;
      if (mode) {
        const pt = { lat: e.lngLat.lat, lon: e.lngLat.lng };
        simPoints.value = mode === 'sim-from' ? { ...simPoints.value, from: pt } : { ...simPoints.value, to: pt };
        pickMode.value = null;
        sheet.value = 'sim';
        return;
      }
      const pad = 14;
      const box: [maplibregl.PointLike, maplibregl.PointLike] = [
        [e.point.x - pad, e.point.y - pad],
        [e.point.x + pad, e.point.y + pad],
      ];
      const layers = CLICKABLE.filter((l) => map.getLayer(l));
      const hits = map.queryRenderedFeatures(box, { layers }) as MapGeoJSONFeature[];
      hits.sort((a, b) => layers.indexOf(a.layer.id) - layers.indexOf(b.layer.id));
      const f = hits[0];
      if (!f) {
        selected.value = null;
        return;
      }
      selected.value = { type: f.source === 'eventLines' ? 'events' : f.source, data: f.properties };
    });

    // Pulsación larga (móvil) o clic derecho: crear aviso propio en ese punto.
    let pressTimer: number | undefined;
    let pressStart: maplibregl.Point | null = null;
    const openReport = (ll: maplibregl.LngLat) => {
      reportAt.value = { lat: ll.lat, lon: ll.lng };
      sheet.value = 'report';
    };
    map.on('touchstart', (e) => {
      if (e.points.length !== 1) return clearTimeout(pressTimer);
      pressStart = e.point;
      const ll = e.lngLat;
      pressTimer = window.setTimeout(() => openReport(ll), 650);
    });
    map.on('touchmove', (e) => {
      if (pressStart && e.point.dist(pressStart) > 12) clearTimeout(pressTimer);
    });
    map.on('touchend', () => clearTimeout(pressTimer));
    map.on('touchcancel', () => clearTimeout(pressTimer));
    map.on('contextmenu', (e) => openReport(e.lngLat));

    // Marcador de posición propia.
    const me = document.createElement('div');
    me.className = 'me-marker';
    me.innerHTML = '<div class="me-pulse"></div><svg viewBox="0 0 40 40" class="me-arrow"><path d="M20 4 L32 34 L20 27 L8 34 Z"/></svg>';
    const marker = new maplibregl.Marker({ element: me, rotationAlignment: 'map', pitchAlignment: 'map' });
    let markerAdded = false;

    const disposers = [
      effect(() => {
        const key = `${settings.value.mapStyle}:${isDark.value}`;
        if (key !== styleKey) {
          styleKey = key;
          map.setStyle(styleFor(settings.value.mapStyle, isDark.value));
        }
      }),
      effect(() => {
        void settings.value.layers;
        void settings.value.aircraft;
        if (map.isStyleLoaded()) applyVisibility(map);
      }),
      effect(() => {
        setData(map, 'radars', fc(allRadars.value.map((r) => pt(r.lon, r.lat, { id: r.id, kind: r.kind, icon: `radar-${r.kind}${r.maxspeed ? `-${r.maxspeed}` : ''}` }))));
      }),
      effect(() => {
        setData(map, 'stretches', fc((dataset.value?.stretches ?? []).map((s) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: s.coords }, properties: { id: s.id, kind: s.kind } }))));
      }),
      effect(() => {
        const pts: Feature[] = [];
        const lines: Feature[] = [];
        for (const e of events.value) {
          if (e.line && e.line.length > 1) lines.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: e.line }, properties: { id: e.id, category: e.category } });
          if (e.source === 'waze' && e.category === 'jam') continue;
          pts.push(pt(e.lon, e.lat, { id: e.id, icon: `ev-${e.category}`, category: e.category }));
        }
        setData(map, 'events', fc(pts));
        setData(map, 'eventLines', fc(lines));
      }),
      effect(() => {
        setData(map, 'reports', fc(reports.value.map((r) => pt(r.lon, r.lat, { id: r.id, icon: `rep-${r.kind}` }))));
      }),
      effect(() => {
        void aircraft.value;
        void fleet.value;
        aircraftStamp = Date.now();
        setData(map, 'aircraft', aircraftFeatures());
      }),
      effect(() => {
        void settings.value.fuelType;
        setData(map, 'fuel', fuelFeatures());
      }),
      effect(() => {
        setData(map, 'cameras', fc(cameras.value.map((c) => pt(c.lon, c.lat, { id: c.id, icon: 'cam' }))));
      }),
      effect(() => {
        const r = simRoute.value;
        setData(map, 'route', fc(r ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: r }, properties: {} }] : []));
      }),
      effect(() => {
        const a = activeAlerts.value.find((x) => x.lat != null && x.kind !== 'corridor');
        const color = a?.severity === 'danger' ? '#dc2626' : '#f59e0b';
        setData(map, 'focus', fc(a ? [pt(a.lon!, a.lat!, { color })] : []));
      }),
      effect(() => {
        const p = position.value;
        if (!p) return;
        marker.setLngLat([p.lon, p.lat]);
        marker.setRotation(p.heading ?? 0);
        me.classList.toggle('no-heading', p.heading == null);
        me.classList.toggle('sim', !!p.simulated);
        if (!markerAdded) {
          marker.addTo(map);
          markerAdded = true;
          map.jumpTo({ center: [p.lon, p.lat], zoom: 15 });
        }
        if (follow.peek()) moveCamera(map);
      }),
      effect(() => {
        void settings.value.headingUp;
        if (follow.value) moveCamera(map, true);
      }),
    ];

    // Las aeronaves se mueven entre refrescos (extrapolación por rumbo y velocidad).
    const acTimer = window.setInterval(() => {
      if ((lastData.aircraft?.features.length ?? 0) > 0) setData(map, 'aircraft', aircraftFeatures());
    }, 2000);

    const ro = new ResizeObserver(() => map.resize());
    ro.observe(el.current!);

    return () => {
      disposers.forEach((d) => d());
      clearInterval(acTimer);
      ro.disconnect();
      map.remove();
      mapInstance = null;
    };
  }, []);

  return <div ref={el} class="map" />;
}
