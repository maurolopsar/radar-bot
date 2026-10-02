import { describe, expect, it } from 'vitest';
import {
  angleDiff,
  bearingDeg,
  destination,
  distanceM,
  formatDistance,
  parseBearing,
  parseMaxspeed,
  projectOnLine,
} from '../shared/geo';
import { utmToLatLon } from '../shared/utm';
import {
  corridorsAt,
  DEFAULT_PROXIMITY,
  ProximityTracker,
  SectionTracker,
  type Fix,
  type Target,
} from '../shared/alerts';
import { mergeRadars } from '../shared/merge';
import { fromReadsb, isDgtAircraft } from '../shared/aircraft';
import type { Radar } from '../shared/types';

describe('geo', () => {
  it('calcula distancias y rumbos', () => {
    // Madrid (Puerta del Sol) - Barcelona (Plaça Catalunya) ≈ 505 km
    const d = distanceM(40.4168, -3.7038, 41.387, 2.17);
    expect(d / 1000).toBeGreaterThan(495);
    expect(d / 1000).toBeLessThan(510);
    expect(bearingDeg(40, -3, 41, -3)).toBeCloseTo(0, 5);
    expect(bearingDeg(40, -3, 40, -2)).toBeGreaterThan(89);
    expect(angleDiff(350, 10)).toBe(20);
    expect(angleDiff(90, 270)).toBe(180);
  });

  it('destination es la inversa de distance+bearing', () => {
    const p = destination(40, -3, 45, 1000);
    expect(distanceM(40, -3, p.lat, p.lon)).toBeCloseTo(1000, 0);
    expect(bearingDeg(40, -3, p.lat, p.lon)).toBeCloseTo(45, 1);
  });

  it('proyecta sobre una polilínea', () => {
    const line: [number, number][] = [
      [-3, 40],
      [-3, 40.01],
    ];
    const mid = destination(40.005, -3, 90, 50);
    const p = projectOnLine(mid.lat, mid.lon, line);
    expect(p.distance).toBeCloseTo(50, 0);
    expect(p.along).toBeCloseTo(p.length / 2, -1);
  });

  it('interpreta maxspeed y direcciones OSM', () => {
    expect(parseMaxspeed('50')).toBe(50);
    expect(parseMaxspeed('ES:urban')).toBe(50);
    expect(parseMaxspeed('30 mph')).toBe(48);
    expect(parseMaxspeed('none')).toBeUndefined();
    expect(parseMaxspeed('80;60')).toBe(80);
    expect(parseBearing('90')).toBe(90);
    expect(parseBearing('NE')).toBe(45);
    expect(parseBearing('SO')).toBe(225);
    expect(parseBearing('forward')).toBeUndefined();
  });

  it('formatea distancias', () => {
    expect(formatDistance(234)).toBe('230 m');
    expect(formatDistance(1520)).toBe('1,5 km');
    expect(formatDistance(23_400)).toBe('23 km');
  });
});

describe('utm', () => {
  it('convierte UTM 30N (dato del CSV de radares de Madrid)', () => {
    const p = utmToLatLon(442843.0, 4481180.0, 30);
    expect(p.lat).toBeCloseTo(40.47934148, 4);
    expect(p.lon).toBeCloseTo(-3.67433808, 4);
  });
});

/** Genera fijos a lo largo de una recta. */
function drive(start: { lat: number; lon: number }, heading: number, speed: number, seconds: number): Fix[] {
  const fixes: Fix[] = [];
  for (let t = 0; t <= seconds; t++) {
    const p = destination(start.lat, start.lon, heading, speed * t);
    fixes.push({ lat: p.lat, lon: p.lon, speed, heading, accuracy: 5, time: t * 1000 });
  }
  return fixes;
}

describe('ProximityTracker', () => {
  const start = { lat: 40, lon: -3 };
  const ahead = destination(40, -3, 0, 2000);

  it('avisa al aproximarse, al estar cerca y al superar el radar', () => {
    const tracker = new ProximityTracker<Target>(DEFAULT_PROXIMITY);
    const radar: Target = { id: 'r1', lat: ahead.lat, lon: ahead.lon };
    const events: { type: string; d: number }[] = [];
    for (const fix of drive(start, 0, 30, 90)) {
      const res = tracker.update(fix, [radar]);
      for (const e of res.events) events.push({ type: e.type, d: Math.round(e.distance) });
    }
    expect(events.map((e) => e.type)).toEqual(['approach', 'close', 'passed']);
    // 30 m/s * 40 s = 1200 m de antelación
    expect(events[0].d).toBeLessThanOrEqual(1200);
    expect(events[0].d).toBeGreaterThan(1150);
    expect(events[1].d).toBeLessThanOrEqual(360);
  });

  it('ignora radares en sentido contrario y radares laterales', () => {
    const tracker = new ProximityTracker<Target>(DEFAULT_PROXIMITY);
    const opposite: Target = { id: 'opp', lat: ahead.lat, lon: ahead.lon, heading: 180 };
    const side = destination(40.009, -3, 90, 600);
    const lateral: Target = { id: 'lat', lat: side.lat, lon: side.lon };
    let count = 0;
    for (const fix of drive(start, 0, 30, 90)) count += tracker.update(fix, [opposite, lateral]).events.length;
    expect(count).toBe(0);
  });

  it('no avisa si el vehículo está parado', () => {
    const tracker = new ProximityTracker<Target>(DEFAULT_PROXIMITY);
    const near = destination(40, -3, 0, 200);
    const res = tracker.update({ lat: 40, lon: -3, speed: 0, heading: null, time: 0 }, [
      { id: 'x', lat: near.lat, lon: near.lon },
    ]);
    expect(res.events).toHaveLength(0);
  });
});

describe('SectionTracker', () => {
  it('calcula la velocidad media del tramo', () => {
    const a = { lat: 40, lon: -3 };
    const b = destination(40, -3, 0, 3000);
    const tracker = new SectionTracker();
    const section = {
      id: 's1',
      coords: [
        [a.lon, a.lat],
        [b.lon, b.lat],
      ] as [number, number][],
      maxspeed: 80,
    };
    const before = destination(40, -3, 180, 200);
    let entered = false;
    let summary: ReturnType<SectionTracker['update']>['exited'];
    let lastStatus: ReturnType<SectionTracker['update']>['status'] = null;
    for (const fix of drive(before, 0, 25, 140)) {
      const r = tracker.update(fix, [section]);
      if (r.entered) entered = true;
      if (r.status) lastStatus = r.status;
      if (r.exited) summary = r.exited;
    }
    expect(entered).toBe(true);
    expect(lastStatus?.over).toBe(true);
    expect(summary).toBeDefined();
    expect(summary!.avgKmh).toBeGreaterThan(88);
    expect(summary!.avgKmh).toBeLessThan(92);
    expect(summary!.over).toBe(true);
  });
});

describe('corridorsAt', () => {
  const line: [number, number][] = [
    [-3, 40],
    [-3, 40.1],
  ];
  it('exige la misma carretera si se conoce', () => {
    const c = { id: 'c', coords: line, road: 'CM-220' };
    expect(corridorsAt(40.05, -3.003, [c], ['CM 220'])).toHaveLength(1);
    expect(corridorsAt(40.05, -3.003, [c], ['A-3'])).toHaveLength(0);
    expect(corridorsAt(40.05, -3.001, [c])).toHaveLength(1);
  });
});

describe('mergeRadars', () => {
  const base = (over: Partial<Radar>): Radar => ({ id: 'x', kind: 'fixed', lat: 40, lon: -3, sources: ['dgt'], ...over });

  it('fusiona el mismo radar de varias fuentes', () => {
    const dgt = base({ id: 'dgt-1', road: 'A-2', pk: 202.3 });
    const osm = base({ id: 'osm-1', sources: ['osm'], lat: 40.0008, maxspeed: 100 });
    const far = base({ id: 'osm-2', sources: ['osm'], lat: 40.01 });
    const merged = mergeRadars([[dgt], [osm, far]]);
    expect(merged).toHaveLength(2);
    const m = merged.find((r) => r.id === 'dgt-1')!;
    expect(m.sources.sort()).toEqual(['dgt', 'osm']);
    expect(m.maxspeed).toBe(100);
    expect(m.lat).toBeCloseTo(40.0008, 6); // posición OSM, más precisa
  });

  it('no fusiona radares de sentidos opuestos ni de distinto grupo', () => {
    const a = base({ id: 'a', heading: 0 });
    const b = base({ id: 'b', heading: 180, sources: ['madrid'] });
    const c = base({ id: 'c', kind: 'redlight', sources: ['osm'] });
    expect(mergeRadars([[a, b, c]])).toHaveLength(3);
  });
});

describe('aircraft', () => {
  it('reconoce helicópteros de la DGT', () => {
    expect(isDgtAircraft({ hex: '343000', reg: 'EC-MHU' })).toBe(true);
    expect(isDgtAircraft({ hex: '343000', reg: 'ECMHU' })).toBe(true);
    expect(isDgtAircraft({ hex: '343000', callsign: 'PEGASO1' })).toBe(true);
    expect(isDgtAircraft({ hex: '343000', operator: 'DIRECCION GENERAL DE TRAFICO' })).toBe(true);
    expect(isDgtAircraft({ hex: '343000', reg: 'EC-ABC' })).toBe(false);
  });

  it('normaliza el formato readsb', () => {
    const a = fromReadsb(
      { hex: '3443c5', r: 'EC-KXU', t: 'AS55', flight: 'ECKXU   ', lat: 40.1, lon: -3.5, alt_baro: 1500, gs: 90, track: 180 },
      'adsb.lol',
    )!;
    expect(a.isDgt).toBe(true);
    expect(a.isHeli).toBe(true);
    expect(a.tag).toBe('DGT');
    expect(a.callsign).toBe('ECKXU');
    const g = fromReadsb({ hex: 'abc', lat: 1, lon: 2, alt_baro: 'ground', category: 'A7', ownOp: 'GUARDIA CIVIL' }, 'x')!;
    expect(g.onGround).toBe(true);
    expect(g.isHeli).toBe(true);
    expect(g.tag).toBe('Guardia Civil');
    expect(fromReadsb({ hex: 'abc' }, 'x')).toBeNull();
  });
});
