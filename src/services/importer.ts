// Importación de bases de datos de radares propias (CSV, GPX, KML, GeoJSON).
// Permite combinar cualquier base de datos de POIs de radares (SCDB, Lufop,
// ficheros de navegadores...) con las fuentes oficiales.

import { parseBearing, parseMaxspeed } from '../../shared/geo';
import type { Radar, RadarKind } from '../../shared/types';

function kindFrom(text: string | undefined): RadarKind {
  const t = (text ?? '').toLowerCase();
  if (/sem[aá]foro|red ?light|traffic.?light|feu/.test(t)) return 'redlight';
  if (/tramo|section|average|media|moyenne/.test(t)) return 'section';
  if (/m[oó]vil|mobile|movil/.test(t)) return 'mobile';
  if (/remolque|trailer/.test(t)) return 'trailer';
  return 'fixed';
}

function speedFrom(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const direct = parseMaxspeed(text);
  if (direct) return direct;
  const m = /(?:^|[^\d])(\d{2,3})(?:\s*km\/?h|[^\d]|$)/i.exec(text);
  const v = m ? Number(m[1]) : undefined;
  return v && v >= 10 && v <= 130 ? v : undefined;
}

function radar(name: string, idx: number, lat: number, lon: number, extra: Partial<Radar> = {}): Radar | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { id: `import-${name}-${idx}`, kind: 'fixed', lat, lon, sources: [`import:${name}`], ...extra };
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (c === sep && !q) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/**
 * CSV con cabecera (lat/lon/latitude/longitude/x/y, tipo, velocidad, rumbo...)
 * o sin cabecera en el formato habitual de POIs: lon,lat,"nombre".
 */
export function parseCsvRadars(text: string, name: string): Radar[] {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() && !l.startsWith('#'));
  if (!lines.length) return [];
  const sep = [';', '\t', ','].find((s) => lines[0].includes(s)) ?? ',';
  const head = splitLine(lines[0], sep).map((h) => h.toLowerCase());
  const idx = (re: RegExp) => head.findIndex((h) => re.test(h));
  let iLat = idx(/^(lat|latitude|latitud|y)$/);
  let iLon = idx(/^(lon|lng|long|longitude|longitud|x)$/);
  const hasHeader = iLat >= 0 && iLon >= 0;
  const iType = idx(/^(type|tipo|kind|categoria|category)$/);
  const iSpeed = idx(/^(speed|velocidad|maxspeed|limit|limite|límite|vmax)$/);
  const iDir = idx(/^(dir|direction|heading|rumbo|bearing|sentido)$/);
  const iName = idx(/^(name|nombre|desc|description|descripcion|comment)$/);
  const rows = hasHeader ? lines.slice(1) : lines;
  if (!hasHeader) {
    iLon = 0;
    iLat = 1;
  }
  const out: Radar[] = [];
  rows.forEach((line, i) => {
    const c = splitLine(line, sep);
    const num = (v?: string) => Number(sep === ',' ? v : v?.replace(',', '.'));
    const lat = num(c[iLat]);
    const lon = num(c[iLon]);
    const label = hasHeader ? (iName >= 0 ? c[iName] : undefined) : c.slice(2).join(' ');
    const typeText = iType >= 0 ? c[iType] : label;
    const r = radar(name, i, lat, lon, {
      kind: kindFrom(typeText),
      maxspeed: speedFrom(iSpeed >= 0 ? c[iSpeed] : label),
      heading: iDir >= 0 ? parseBearing(c[iDir]) : undefined,
      name: label || undefined,
    });
    if (r) out.push(r);
  });
  return out;
}

function xmlDoc(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

export function parseGpxRadars(text: string, name: string): Radar[] {
  const doc = xmlDoc(text);
  const out: Radar[] = [];
  Array.from(doc.getElementsByTagName('wpt')).forEach((w, i) => {
    const label = w.getElementsByTagName('name')[0]?.textContent ?? '';
    const desc = w.getElementsByTagName('desc')[0]?.textContent ?? '';
    const r = radar(name, i, Number(w.getAttribute('lat')), Number(w.getAttribute('lon')), {
      kind: kindFrom(`${label} ${desc}`),
      maxspeed: speedFrom(`${label} ${desc}`),
      name: label || desc || undefined,
    });
    if (r) out.push(r);
  });
  return out;
}

export function parseKmlRadars(text: string, name: string): Radar[] {
  const doc = xmlDoc(text);
  const out: Radar[] = [];
  Array.from(doc.getElementsByTagName('Placemark')).forEach((p, i) => {
    const coords = p.getElementsByTagName('coordinates')[0]?.textContent?.trim().split(/\s+/)[0];
    if (!coords) return;
    const [lon, lat] = coords.split(',').map(Number);
    const label = p.getElementsByTagName('name')[0]?.textContent ?? '';
    const desc = p.getElementsByTagName('description')[0]?.textContent ?? '';
    const r = radar(name, i, lat, lon, {
      kind: kindFrom(`${label} ${desc}`),
      maxspeed: speedFrom(`${label} ${desc}`),
      name: label || undefined,
    });
    if (r) out.push(r);
  });
  return out;
}

export function parseGeoJsonRadars(text: string, name: string): Radar[] {
  const fc = JSON.parse(text) as { features?: { geometry?: { type: string; coordinates: number[] }; properties?: Record<string, unknown> }[] };
  const out: Radar[] = [];
  (fc.features ?? []).forEach((f, i) => {
    if (f.geometry?.type !== 'Point') return;
    const [lon, lat] = f.geometry.coordinates;
    const p = f.properties ?? {};
    const str = (k: string) => (p[k] != null ? String(p[k]) : undefined);
    const r = radar(name, i, lat, lon, {
      kind: kindFrom(str('kind') ?? str('type') ?? str('tipo') ?? str('name')),
      maxspeed: speedFrom(str('maxspeed') ?? str('speed') ?? str('velocidad') ?? str('name')),
      heading: parseBearing(str('heading') ?? str('direction')),
      name: str('name') ?? str('nombre'),
    });
    if (r) out.push(r);
  });
  return out;
}

export function parseRadarFile(fileName: string, text: string): Radar[] {
  const name = fileName.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '_').slice(0, 40) || 'import';
  const ext = fileName.split('.').pop()?.toLowerCase();
  if (ext === 'gpx') return parseGpxRadars(text, name);
  if (ext === 'kml') return parseKmlRadars(text, name);
  if (ext === 'geojson' || ext === 'json') return parseGeoJsonRadars(text, name);
  return parseCsvRadars(text, name);
}
