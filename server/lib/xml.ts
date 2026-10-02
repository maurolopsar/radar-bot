// Ayudas para recorrer XML (DATEX II) parseado con fast-xml-parser.

import { XMLParser } from 'fast-xml-parser';

/** Etiquetas que pueden repetirse y deben tratarse siempre como lista. */
const ARRAY_TAGS = new Set([
  'predefinedLocationSet',
  'predefinedLocation',
  'name',
  'situation',
  'situationRecord',
  'value',
  'cctvCameraMetadataRecord',
]);

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (name) => ARRAY_TAGS.has(name),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type XNode = any;

export function parseXml(xml: string): XNode {
  return xmlParser.parse(xml);
}

export function arr<T = XNode>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Texto de un nodo (cadena, objeto con #text, o lista de `value`). */
export function text(v: XNode): string | undefined {
  if (v == null) return undefined;
  if (typeof v === 'string') return v.trim() || undefined;
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === 'object') {
    if ('#text' in v) return text(v['#text']);
    if ('value' in v) return text(v.value);
    if ('values' in v) return text(v.values);
  }
  return undefined;
}

export function num(v: XNode): number | undefined {
  const t = text(v);
  if (t == null) return undefined;
  const n = Number(t.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Valor de xsi:type sin prefijo ("_0:Point" -> "Point"). */
export function xsiType(node: XNode): string {
  const t = node?.['@_type'];
  return typeof t === 'string' ? (t.split(':').pop() ?? '') : '';
}

export function coordsOf(node: XNode): { lat: number; lon: number } | undefined {
  const pc = node?.pointCoordinates ?? node;
  const lat = num(pc?.latitude);
  const lon = num(pc?.longitude);
  if (lat == null || lon == null) return undefined;
  if (Math.abs(lat) < 1e-6 && Math.abs(lon) < 1e-6) return undefined;
  return { lat, lon };
}

/** Busca en profundidad la primera clave con ese nombre. */
export function findDeep(node: XNode, key: string, depth = 8): XNode {
  if (node == null || typeof node !== 'object' || depth < 0) return undefined;
  if (key in node) return node[key];
  for (const k of Object.keys(node)) {
    if (k.startsWith('@_')) continue;
    const r = findDeep(node[k], key, depth - 1);
    if (r !== undefined) return r;
  }
  return undefined;
}
