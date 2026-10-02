// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseCsvRadars, parseGeoJsonRadars, parseGpxRadars, parseKmlRadars, parseRadarFile } from '../src/services/importer';
import { matchWay, roadInfoOf } from '../src/services/road';
import { createDeriver } from '../src/services/geolocation';
import { alertRank } from '../src/services/engine';
import { destination } from '../shared/geo';

describe('importador de bases de datos', () => {
  it('CSV con cabecera y separador ;', () => {
    const list = parseCsvRadars('lat;lon;tipo;velocidad;rumbo\n40,1;-3,5;Radar de tramo;100;90\n40,2;-3,6;fijo;80;', 'mio');
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ lat: 40.1, lon: -3.5, kind: 'section', maxspeed: 100, heading: 90, sources: ['import:mio'] });
    expect(list[1].kind).toBe('fixed');
  });

  it('CSV de POIs sin cabecera (lon,lat,"nombre")', () => {
    const list = parseCsvRadars('-3.70379,40.41678,"Radar fijo 50 km/h"\n2.17,41.38,"Semáforo"', 'poi');
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ lat: 40.41678, lon: -3.70379, maxspeed: 50, kind: 'fixed' });
    expect(list[1].kind).toBe('redlight');
  });

  it('GPX, KML y GeoJSON', () => {
    const gpx = parseGpxRadars('<gpx><wpt lat="40.1" lon="-3.1"><name>Radar 120</name></wpt><wpt lat="x" lon="y"/></gpx>', 'g');
    expect(gpx).toHaveLength(1);
    expect(gpx[0].maxspeed).toBe(120);
    const kml = parseKmlRadars('<kml><Document><Placemark><name>Tramo 80</name><Point><coordinates>-3.2,40.2,0</coordinates></Point></Placemark></Document></kml>', 'k');
    expect(kml[0]).toMatchObject({ lat: 40.2, lon: -3.2, kind: 'section', maxspeed: 80 });
    const gj = parseGeoJsonRadars(JSON.stringify({ features: [{ geometry: { type: 'Point', coordinates: [-3.3, 40.3] }, properties: { type: 'mobile', maxspeed: 90 } }] }), 'j');
    expect(gj[0]).toMatchObject({ kind: 'mobile', maxspeed: 90 });
    expect(parseRadarFile('mis radares.gpx', '<gpx><wpt lat="1" lon="2"/></gpx>')[0].sources).toEqual(['import:mis_radares']);
  });
});

describe('vía actual', () => {
  const way = (id: number, tags: Record<string, string>, pts: [number, number][]) => ({ id, tags, geometry: pts.map(([lat, lon]) => ({ lat, lon })) });
  const main = way(1, { highway: 'trunk', ref: 'A-6', maxspeed: '100' }, [[40.0, -3.0], [40.02, -3.0]]);
  const side = way(2, { highway: 'residential', name: 'Calle Mayor' }, [[40.01, -3.0004], [40.01, -2.99]]);
  const fwd = way(3, { highway: 'primary', 'maxspeed:forward': '80', 'maxspeed:backward': '60' }, [[41, -3], [41.02, -3]]);

  it('elige la vía alineada con el rumbo y usa su límite', () => {
    const m = matchWay({ lat: 40.01, lon: -3.0002, heading: 2 }, [main, side])!;
    expect(m.way.id).toBe(1);
    expect(roadInfoOf(m.way, m.forward)).toMatchObject({ ref: 'A-6', maxspeed: 100, inferred: false });
    const m2 = matchWay({ lat: 40.01, lon: -2.995, heading: 90 }, [main, side])!;
    expect(m2.way.id).toBe(2);
    expect(roadInfoOf(m2.way, m2.forward)).toMatchObject({ maxspeed: 50, inferred: true });
  });

  it('respeta maxspeed:forward / backward', () => {
    const n = matchWay({ lat: 41.01, lon: -3, heading: 0 }, [fwd])!;
    expect(roadInfoOf(n.way, n.forward).maxspeed).toBe(80);
    const s = matchWay({ lat: 41.01, lon: -3, heading: 180 }, [fwd])!;
    expect(roadInfoOf(s.way, s.forward).maxspeed).toBe(60);
  });

  it('no asigna vía si está lejos', () => {
    expect(matchWay({ lat: 40.5, lon: -3.5, heading: 0 }, [main, side])).toBeNull();
  });
});

describe('GPS', () => {
  it('calcula velocidad y rumbo si el dispositivo no los da', () => {
    const d = createDeriver();
    const a = d.next({ lat: 40, lon: -3, speed: null, heading: null, accuracy: 5, time: 0 });
    expect(a.speed).toBeNull();
    expect(a.heading).toBeNull();
    const p2 = destination(40, -3, 90, 25);
    const b = d.next({ lat: p2.lat, lon: p2.lon, speed: null, heading: null, accuracy: 5, time: 1000 });
    expect(b.speed).toBeCloseTo(25, 0);
    expect(b.heading).toBeCloseTo(90, 0);
    // Parado: conserva el último rumbo y la velocidad baja
    const c = d.next({ lat: p2.lat, lon: p2.lon, speed: 0, heading: null, accuracy: 5, time: 2000 });
    expect(c.heading).toBeCloseTo(90, 0);
    expect(c.speed!).toBeLessThan(10);
  });
});

describe('prioridad del banner', () => {
  it('los radares van antes que un helicóptero lejano', () => {
    const radar = { id: 'r', kind: 'radar', title: '', stage: 'approach', severity: 'warning', icon: '' } as const;
    const heli = { id: 'h', kind: 'aircraft', title: '', stage: 'approach', severity: 'danger', icon: '' } as const;
    const heliClose = { ...heli, stage: 'close' } as const;
    expect(alertRank(radar)).toBeLessThan(alertRank(heli));
    expect(alertRank(heliClose)).toBeLessThan(alertRank(heli));
  });
});
