import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseDgtInvive, parseDgtRadars } from '../server/sources/dgt-radars';
import { parseDgtIncidents } from '../server/sources/dgt-incidents';
import { parseSctFixed, parseSctTrailer } from '../server/sources/sct';
import { parseMadridCsv } from '../server/sources/madrid';
import { parseWaze } from '../server/sources/waze';
import { parseDgtCameras } from '../server/sources/cameras';
import { parseFuel } from '../server/sources/fuel';
import { parseCsv } from '../server/lib/csv';
import { parseOverpassRadars } from '../shared/osm';
import { parseFeed } from '../shared/feed';

const fx = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');

describe('DGT radares', () => {
  const { radars, stretches } = parseDgtRadars(fx('dgt_radares.xml'));

  it('lee radares fijos con carretera, PK y sentido', () => {
    const r = radars.find((x) => x.id === 'dgt-CABINACINEMOMETRO_120001')!;
    expect(r).toBeDefined();
    expect(r.kind).toBe('fixed');
    expect(r.lat).toBeCloseTo(41.30326, 5);
    expect(r.lon).toBeCloseTo(-1.94488, 5);
    expect(r.road).toBe('A-2');
    expect(r.pk).toBeCloseTo(202.33, 2);
    expect(r.direction).toBe('ZARAGOZA');
  });

  it('lee tramos de velocidad media con cámaras en ambos extremos', () => {
    const s = stretches.find((x) => x.id === 'dgt-CVM_161274')!;
    expect(s).toBeDefined();
    expect(s.kind).toBe('section');
    expect(s.coords[0]).toEqual([-0.915697, 41.6088]);
    expect(s.coords[1]).toEqual([-0.9496, 41.6192]);
    expect(s.kmFrom).toBeCloseTo(26.6);
    expect(s.kmTo).toBeCloseTo(29.7);
    const ends = radars.filter((r) => r.sectionId === s.id);
    expect(ends.map((e) => e.id).sort()).toEqual(['dgt-CVM_161274-fin', 'dgt-CVM_161274-ini']);
    expect(radars.every((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon))).toBe(true);
  });
});

describe('DGT INVIVE (tramos con radar móvil)', () => {
  it('lee los tramos aunque mezclen namespaces', () => {
    const list = parseDgtInvive(fx('dgt_invive.xml'));
    expect(list).toHaveLength(6);
    const first = list[0];
    expect(first.kind).toBe('mobile_stretch');
    expect(first.road).toBe('CM-220');
    expect(first.coords[0]).toEqual([-1.91995, 39.25851]);
    expect(first.name).toContain('CM-220');
  });
});

describe('DGT incidencias', () => {
  const list = parseDgtIncidents(fx('dgt_incidencias.xml'), Date.parse('2026-01-03T00:00:00Z'));

  it('clasifica balizas V16, obras, retenciones y cortes', () => {
    const cats = list.map((e) => e.category);
    expect(cats).toContain('v16');
    expect(cats).toContain('roadworks');
    expect(cats).toContain('jam');
    expect(cats).toContain('closure');
    const v16 = list.find((e) => e.category === 'v16')!;
    expect(v16.road).toBe('BU-800');
    expect(v16.lat).toBeCloseTo(42.33325, 5);
    expect(v16.description).toMatch(/V16/);
    const works = list.find((e) => e.category === 'roadworks')!;
    expect(works.line).toHaveLength(2);
    expect(works.description).toBe('Obras');
    const closed = list.find((e) => e.category === 'closure')!;
    expect(list.find((e) => e.category === 'accident')?.description).toBe('Accidente (calzada cortada)');
    expect(closed.road).toBe('N-632');
    expect(closed.description).toBe('Carretera cortada (obras)');
  });
});

describe('Servei Català de Trànsit', () => {
  it('convierte UTM 31N y descarta filas con coordenadas rotas', () => {
    const list = parseSctFixed(fx('sct_radars.txt'));
    // De 9 filas de ejemplo, 4 tienen coordenadas rotas
    expect(list.length).toBe(5);
    const a2 = list.find((r) => r.road === 'A-2')!;
    expect(a2.kind).toBe('fixed');
    expect(a2.maxspeed).toBe(120);
    expect(a2.lat).toBeGreaterThan(41.4);
    expect(a2.lat).toBeLessThan(41.7);
    expect(a2.lon).toBeGreaterThan(0.3);
    expect(a2.lon).toBeLessThan(0.6);
    expect(list.find((r) => r.road === 'C-32 nord')).toBeDefined();
    expect(list.find((r) => r.road === 'C-58cc')?.kind).toBe('section');
  });

  it('lee las ubicaciones de radar remolque', () => {
    const list = parseSctTrailer(fx('sct_radars_remolc.txt'));
    expect(list).toHaveLength(4);
    expect(list.every((r) => r.kind === 'trailer')).toBe(true);
  });
});

describe('Madrid', () => {
  it('lee radares fijos y de tramo del CSV', () => {
    const { radars, stretches } = parseMadridCsv(fx('madrid_radares.csv'));
    expect(radars.filter((r) => r.kind === 'fixed')).toHaveLength(3);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].maxspeed).toBe(50);
    const fixed = radars.find((r) => r.id === 'madrid-1')!;
    expect(fixed.lat).toBeCloseTo(40.47934148, 6);
    expect(fixed.maxspeed).toBe(90);
    expect(fixed.road).toBe('M-30');
  });

  it('el parser CSV respeta comillas multilínea', () => {
    expect(parseCsv('a;"b\nc";d\r\n1;2;3', ';')).toEqual([
      ['a', 'b\nc', 'd'],
      ['1', '2', '3'],
    ]);
  });
});

describe('OpenStreetMap', () => {
  it('lee cámaras y relaciones de enforcement con rumbo', () => {
    const res = parseOverpassRadars({
      elements: [
        { type: 'node', id: 1, lat: 40, lon: -3, tags: { highway: 'speed_camera', maxspeed: '100' } },
        { type: 'node', id: 2, lat: 40.001, lon: -3, tags: { highway: 'speed_camera' } },
        { type: 'node', id: 3, lat: 39.999, lon: -3 },
        { type: 'node', id: 4, lat: 40.1, lon: -3 },
        { type: 'node', id: 5, lat: 40.2, lon: -3 },
        {
          type: 'relation',
          id: 10,
          tags: { type: 'enforcement', enforcement: 'maxspeed', maxspeed: '80' },
          members: [
            { type: 'node', ref: 2, role: 'device' },
            { type: 'node', ref: 3, role: 'from' },
          ],
        },
        {
          type: 'relation',
          id: 11,
          tags: { type: 'enforcement', enforcement: 'average_speed', maxspeed: '120' },
          members: [
            { type: 'node', ref: 4, role: 'from' },
            { type: 'node', ref: 5, role: 'to' },
          ],
        },
      ],
    });
    const cam = res.radars.find((r) => r.id === 'osm-n1')!;
    expect(cam.maxspeed).toBe(100);
    const enf = res.radars.find((r) => r.id === 'osm-r10-2')!;
    expect(enf.maxspeed).toBe(80);
    expect(enf.heading).toBeCloseTo(0, 0);
    // El nodo 2 es el dispositivo de la relación: no se duplica como cámara suelta
    expect(res.radars.find((r) => r.id === 'osm-n2')).toBeUndefined();
    expect(res.stretches).toHaveLength(1);
    expect(res.radars.filter((r) => r.sectionId === 'osm-r11')).toHaveLength(2);
  });
});

describe('Feed Radares Anunciados', () => {
  it('filtra caducados y fuentes ya descargadas', () => {
    const { radars, stretches } = parseFeed(
      {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', id: 'a', geometry: { type: 'Point', coordinates: [-2, 43] }, properties: { source: 'euskadi', kind: 'fixed', maxspeed: 80 } },
          { type: 'Feature', id: 'b', geometry: { type: 'Point', coordinates: [-1, 38] }, properties: { source: 'murcia', kind: 'mobile_announced', valid_from: '2026-10-01', valid_to: '2026-10-07' } },
          { type: 'Feature', id: 'c', geometry: { type: 'Point', coordinates: [-1, 38] }, properties: { source: 'murcia', kind: 'mobile_announced', valid_to: '2026-09-01' } },
          { type: 'Feature', id: 'd', geometry: { type: 'Point', coordinates: [-3, 40] }, properties: { source: 'dgt', kind: 'fixed' } },
          { type: 'Feature', id: 'e', geometry: { type: 'LineString', coordinates: [[-3, 40], [-3, 41]] }, properties: { source: 'dgt_invive', kind: 'stretch', road: 'N-1' } },
        ],
      },
      '2026-10-02',
      new Set(['dgt']),
    );
    expect(radars.map((r) => r.id)).toEqual(['feed-a', 'feed-b']);
    expect(radars[1].kind).toBe('mobile');
    expect(radars[0].sources).toEqual(['feed:euskadi']);
    expect(stretches).toHaveLength(1);
    expect(stretches[0].kind).toBe('mobile_stretch');
  });
});

describe('Waze', () => {
  it('convierte avisos y atascos', () => {
    const list = parseWaze({
      alerts: [
        { uuid: 'u1', type: 'POLICE', subtype: 'POLICE_HIDING', location: { x: -3.7, y: 40.4 }, street: 'A-6', magvar: 300, reliability: 8, nThumbsUp: 3, pubMillis: 1_759_000_000_000 },
        { uuid: 'u2', type: 'HAZARD', subtype: 'HAZARD_WEATHER_FOG', location: { x: -3.6, y: 40.5 } },
        { uuid: 'u3', type: 'CHIT_CHAT', location: { x: -3.6, y: 40.5 } },
      ],
      jams: [
        { uuid: 9, level: 4, speedKMH: 12, delay: 300, line: [{ x: -3.7, y: 40.4 }, { x: -3.71, y: 40.41 }] },
        { uuid: 10, level: 1, line: [{ x: -3.7, y: 40.4 }] },
      ],
    });
    expect(list).toHaveLength(3);
    const police = list[0];
    expect(police.category).toBe('police');
    expect(police.description).toBe('Policía escondida');
    expect(police.heading).toBe(300);
    expect(list[1].category).toBe('weather');
    expect(list[2].category).toBe('jam');
    expect(list[2].description).toContain('+5 min');
  });
});

describe('Cámaras DGT', () => {
  it('encuentra cámaras con imagen y posición en una estructura desconocida', () => {
    const xml = `<?xml version="1.0"?><d2LogicalModel xmlns="http://datex2.eu/schema/1_0/1_0"><payloadPublication>
      <cctvCameraMetadataRecord id="1"><cctvCameraIdentification>CAM 1</cctvCameraIdentification>
        <cctvCameraRecord><cameraBaseLocation><pointCoordinates><latitude>42.0676</latitude><longitude>-4.2227</longitude></pointCoordinates></cameraBaseLocation>
        <cctvStillImageService><urlLinkAddress>http://infocar.dgt.es/etraffic/data/camaras/2.jpg</urlLinkAddress></cctvStillImageService></cctvCameraRecord>
      </cctvCameraMetadataRecord>
      <cctvCameraMetadataRecord id="2"><cctvCameraRecord><cameraBaseLocation><pointCoordinates><latitude>41.98</latitude><longitude>-4.43</longitude></pointCoordinates></cameraBaseLocation>
        <cctvStillImageService><urlLinkAddress>http://infocar.dgt.es/etraffic/data/camaras/3.jpg</urlLinkAddress></cctvStillImageService></cctvCameraRecord>
      </cctvCameraMetadataRecord></payloadPublication></d2LogicalModel>`;
    const cams = parseDgtCameras(xml);
    expect(cams).toHaveLength(2);
    expect(cams[0]).toMatchObject({ id: 'dgt-cam-2', lat: 42.0676, lon: -4.2227, image: 'https://infocar.dgt.es/etraffic/data/camaras/2.jpg', name: 'CAM 1' });
  });
});

describe('Gasolineras', () => {
  it('lee precios con coma decimal y longitudes negativas', () => {
    const list = parseFuel({
      ListaEESSPrecio: [
        { IDEESS: '1', 'Rótulo': 'REPSOL', Latitud: '40,416775', 'Longitud (WGS84)': '-3,703790', 'Precio Gasolina 95 E5': '1,559', 'Precio Gasoleo A': '1,489', 'Precio Gasolina 98 E5': '' },
        { IDEESS: '2', Latitud: '', 'Longitud (WGS84)': '' },
      ],
    });
    expect(list).toHaveLength(1);
    expect(list[0].lon).toBeCloseTo(-3.70379, 5);
    expect(list[0].prices).toEqual({ g95: 1.559, diesel: 1.489 });
  });
});

import { createApp } from '../server/app';

describe('API', () => {
  const app = createApp();
  it('geocodifica coordenadas sin red y valida rutas', async () => {
    const g = await app.request('/api/geocode?q=40.41,-3.70');
    expect((await g.json()).places[0]).toMatchObject({ lat: 40.41, lon: -3.7 });
    const r = await app.request('/api/route?points=40.4,-3.7');
    expect(r.status).toBe(400);
    const h = await app.request('/api/health');
    expect((await h.json()).authorized).toBe(true);
  });
});

import { parseDonostia, parseEuskadi, parseNavarra } from '../server/sources/regional';

describe('Radares regionales', () => {
  it('Euskadi: convierte UTM 30N y lee límite y carretera', () => {
    const list = parseEuskadi(fx('euskadi_cabinas.html'));
    expect(list.length).toBeGreaterThanOrEqual(1);
    const r = list[0];
    expect(r).toMatchObject({ kind: 'fixed', road: 'A-8', maxspeed: 80, direction: 'DONOSTIA / SAN SEBASTIÁN', sources: ['euskadi'] });
    expect(r.lat).toBeGreaterThan(43.2);
    expect(r.lat).toBeLessThan(43.35);
    expect(r.lon).toBeGreaterThan(-3.05);
    expect(r.lon).toBeLessThan(-2.9);
  });
  it('Navarra: nombre con carretera, PK y sentido', () => {
    const list = parseNavarra(JSON.parse(fx('navarra_radars.json')));
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ id: 'navarra-A-1-401.6-C', road: 'A-1', direction: 'creciente' });
    expect(list[0].lat).toBeGreaterThan(42.8);
    expect(list[0].lat).toBeLessThan(43);
  });
  it('Donostia: capa GeoJSON', () => {
    const list = parseDonostia(JSON.parse(fx('donostia_radarra.json')));
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({ maxspeed: 30, sources: ['donostia'] });
  });
});
