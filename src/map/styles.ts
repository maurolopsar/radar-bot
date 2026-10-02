import type { StyleSpecification } from 'maplibre-gl';
import type { MapStyleSetting } from '../state/settings';

const SATELLITE: StyleSpecification = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
      attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics',
    },
    labels: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      maxzoom: 19,
    },
  },
  layers: [
    { id: 'sat', type: 'raster', source: 'sat' },
    { id: 'labels', type: 'raster', source: 'labels', paint: { 'raster-opacity': 0.9 } },
  ],
};

export const STYLE_LABELS: Record<MapStyleSetting, string> = {
  auto: 'Automático (claro/oscuro)',
  voyager: 'Callejero (CARTO Voyager)',
  positron: 'Claro minimalista (CARTO Positron)',
  dark: 'Oscuro (CARTO Dark Matter)',
  liberty: 'OpenFreeMap Liberty',
  satellite: 'Satélite (Esri)',
};

export function styleFor(setting: MapStyleSetting, dark: boolean): string | StyleSpecification {
  const s = setting === 'auto' ? (dark ? 'dark' : 'voyager') : setting;
  switch (s) {
    case 'dark':
      return 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json';
    case 'positron':
      return 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json';
    case 'liberty':
      return 'https://tiles.openfreemap.org/styles/liberty';
    case 'satellite':
      return SATELLITE;
    default:
      return 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  }
}
