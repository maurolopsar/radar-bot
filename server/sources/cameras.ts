// Cámaras de tráfico de la DGT (imágenes fijas que se renuevan cada pocos minutos).
// DATEX II CCTVSiteTablePublication.

import type { TrafficCamera } from '../../shared/types';
import { fetchText } from '../lib/http';
import { coordsOf, findDeep, parseXml, text, type XNode } from '../lib/xml';

export const DGT_CAMERAS_URL = 'https://infocar.dgt.es/datex2/dgt/CCTVSiteTablePublication/all/content.xml';

function countUrls(node: XNode, limit = 2): number {
  if (node == null || typeof node !== 'object') return 0;
  let n = 0;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'urlLinkAddress') n += Array.isArray(v) ? v.length : 1;
    else if (!k.startsWith('@_')) n += countUrls(v, limit - n);
    if (n >= limit) return n;
  }
  return n;
}

/** Recorre el árbol buscando los nodos más pequeños con una sola URL de imagen. */
function collect(node: XNode, out: TrafficCamera[]): void {
  if (node == null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out);
    return;
  }
  const urls = countUrls(node);
  if (urls === 0) return;
  if (urls === 1) {
    const url = text(findDeep(node, 'urlLinkAddress'));
    const pos = coordsOf(findDeep(node, 'pointCoordinates'));
    if (url && pos) {
      const id = /\/(\d+)\.jpg/i.exec(url)?.[1] ?? String(node['@_id'] ?? out.length);
      out.push({
        id: `dgt-cam-${id}`,
        ...pos,
        name: text(findDeep(node, 'cctvCameraIdentification')) ?? text(findDeep(node, 'roadNumber')),
        image: url.replace(/^http:/, 'https:'),
      });
    }
    return;
  }
  for (const [k, v] of Object.entries(node)) if (!k.startsWith('@_')) collect(v, out);
}

export function parseDgtCameras(xml: string): TrafficCamera[] {
  const out: TrafficCamera[] = [];
  collect(parseXml(xml), out);
  return out;
}

export async function fetchDgtCameras(): Promise<TrafficCamera[]> {
  return parseDgtCameras(await fetchText(DGT_CAMERAS_URL, { timeoutMs: 60_000 }));
}
