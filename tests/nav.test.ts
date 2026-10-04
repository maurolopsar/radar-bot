import { describe, expect, it } from 'vitest';
import { inferSpanishLimit } from '../shared/speedlimit';
import { adviseSpeed, curveSegments, curveSpeedKmh, findCurves, gradeForRadius } from '../shared/curves';
import { instructionEs, parseOsrm, RouteFollower, sliceRoute, type OsrmResponse } from '../shared/nav';
import { matchWay, pathAhead, type OsmWay } from '../shared/roadgraph';
import { destination } from '../shared/geo';

describe('límite de velocidad (normativa española)', () => {
  const f = { forward: true };
  it('usa la señalización y el sentido', () => {
    expect(inferSpanishLimit({ highway: 'primary', maxspeed: '70' }, f)).toMatchObject({ kmh: 70, source: 'signed' });
    expect(inferSpanishLimit({ highway: 'primary', 'maxspeed:backward': '60', maxspeed: '80' }, { forward: false }).kmh).toBe(60);
  });
  it('autovías y convencionales', () => {
    expect(inferSpanishLimit({ highway: 'motorway' }, f).kmh).toBe(120);
    expect(inferSpanishLimit({ highway: 'trunk', oneway: 'yes' }, f).kmh).toBe(120);
    expect(inferSpanishLimit({ highway: 'trunk' }, f).kmh).toBe(90);
    expect(inferSpanishLimit({ highway: 'secondary' }, f)).toMatchObject({ kmh: 90, reason: 'Carretera convencional' });
    expect(inferSpanishLimit({ highway: 'primary', maxspeed: 'ES:rural' }, f).kmh).toBe(90);
  });
  it('vías urbanas: 20 / 30 / 50 según plataforma y carriles', () => {
    expect(inferSpanishLimit({ highway: 'living_street' }, f).kmh).toBe(20);
    expect(inferSpanishLimit({ highway: 'residential' }, f).kmh).toBe(30);
    expect(inferSpanishLimit({ highway: 'secondary', lanes: '2' }, { forward: true, urbanArea: true }).kmh).toBe(30);
    expect(inferSpanishLimit({ highway: 'secondary', lanes: '4' }, { forward: true, urbanArea: true }).kmh).toBe(50);
    expect(inferSpanishLimit({ highway: 'secondary', lanes: '2', oneway: 'yes' }, { forward: true, urbanArea: true }).kmh).toBe(50);
    expect(inferSpanishLimit({ highway: 'primary', maxspeed: 'ES:urban' }, f).kmh).toBe(50);
    expect(inferSpanishLimit({ highway: 'tertiary', 'zone:maxspeed': 'ES:30' }, f).kmh).toBe(30);
  });
});

/** Arco de circunferencia de radio R (m) tras una recta. */
function arc(R: number, angleDeg: number): [number, number][] {
  const pts: [number, number][] = [];
  let p = { lat: 40, lon: -3 };
  for (let i = 0; i <= 30; i++) {
    pts.push([p.lon, p.lat]);
    p = destination(p.lat, p.lon, 0, 10);
  }
  const steps = Math.ceil(angleDeg / 2);
  let heading = 0;
  const len = (2 * Math.PI * R * 2) / 360;
  for (let i = 0; i < steps; i++) {
    heading += 2; // a la derecha
    p = destination(p.lat, p.lon, heading, len);
    pts.push([p.lon, p.lat]);
  }
  for (let i = 0; i < 30; i++) {
    p = destination(p.lat, p.lon, heading, 10);
    pts.push([p.lon, p.lat]);
  }
  return pts;
}

describe('curvas', () => {
  it('detecta el radio, la dirección y la severidad', () => {
    const { curves } = findCurves(arc(50, 90));
    expect(curves).toHaveLength(1);
    const c = curves[0];
    expect(c.direction).toBe('right');
    expect(c.minRadius).toBeGreaterThan(40);
    expect(c.minRadius).toBeLessThan(62);
    expect(c.grade).toBe(5);
    expect(c.angle).toBeGreaterThan(70);
  });
  it('una recta no tiene curvas', () => {
    const line: [number, number][] = [
      [-3, 40],
      [-3, 40.02],
    ];
    expect(findCurves(line).curves).toHaveLength(0);
    expect(curveSegments(line)).toHaveLength(0);
  });
  it('recomienda frenar antes de la curva', () => {
    const { curves } = findCurves(arc(50, 90));
    const target = curveSpeedKmh(50, 'normal');
    expect(target).toBeGreaterThan(45);
    expect(target).toBeLessThan(50);
    const near = adviseSpeed(curves, curves[0].apex - 60, 'normal');
    const far = adviseSpeed(curves, 0, 'normal');
    expect(near.recommendedKmh).toBeLessThan(far.recommendedKmh);
    expect(near.limiting?.direction).toBe('right');
    expect(adviseSpeed(curves, 0, 'tope').recommendedKmh).toBeGreaterThan(far.recommendedKmh);
    expect(gradeForRadius(20)).toBe(6);
    expect(gradeForRadius(1000)).toBe(0);
  });
});

describe('navegación', () => {
  const a = { lat: 40, lon: -3 };
  const b = destination(40, -3, 0, 1000);
  const c = destination(b.lat, b.lon, 90, 500);
  const osrm: OsrmResponse = {
    code: 'Ok',
    routes: [
      {
        distance: 1500,
        duration: 120,
        geometry: { coordinates: [[a.lon, a.lat], [b.lon, b.lat], [c.lon, c.lat]] },
        legs: [
          {
            distance: 1500,
            duration: 120,
            annotation: { duration: [80, 40], speed: [12.5, 12.5] },
            steps: [
              { distance: 1000, duration: 80, name: 'Calle Mayor', maneuver: { type: 'depart', location: [a.lon, a.lat] } },
              { distance: 500, duration: 40, name: 'Gran Vía', ref: 'N-1', maneuver: { type: 'turn', modifier: 'right', location: [b.lon, b.lat] } },
              { distance: 0, duration: 0, name: '', maneuver: { type: 'arrive', location: [c.lon, c.lat] } },
            ],
          },
        ],
      },
    ],
  };

  it('traduce las maniobras', () => {
    expect(instructionEs({ type: 'turn', modifier: 'left', name: 'Calle Sol' })).toBe('Gira a la izquierda por Calle Sol');
    expect(instructionEs({ type: 'roundabout', exit: 2, name: 'Avenida' })).toBe('En la rotonda, toma la segunda salida por Avenida');
    expect(instructionEs({ type: 'off ramp', modifier: 'slight right', destinations: 'A-6: Madrid' })).toBe('Toma la salida hacia Madrid');
    expect(instructionEs({ type: 'fork', modifier: 'slight left', ref: 'M-40' })).toBe('En la bifurcación, mantente a la izquierda por M-40');
    expect(instructionEs({ type: 'arrive', lastLeg: false })).toBe('Has llegado a la parada');
  });

  it('calcula el progreso y la siguiente maniobra', () => {
    const [route] = parseOsrm(osrm);
    expect(route.steps[1].instruction).toBe('Gira a la derecha por Gran Vía (N-1)');
    expect(route.steps[1].at).toBeCloseTo(1000, -1);
    expect(route.summary).toContain('Calle Mayor');
    const f = new RouteFollower(route);
    const mid = destination(40, -3, 0, 600);
    const p = f.update(mid.lat, mid.lon);
    expect(p.along).toBeCloseTo(600, -1);
    expect(p.next?.type).toBe('turn');
    expect(p.toNext).toBeCloseTo(400, -1);
    expect(p.remainingTime).toBeCloseTo(120 - 48, 0);
    const off = destination(mid.lat, mid.lon, 90, 200);
    expect(f.update(off.lat, off.lon).offRoute).toBeGreaterThan(150);
    expect(sliceRoute(route, 500, 700).length).toBeGreaterThanOrEqual(2);
  });
});

describe('grafo de vías', () => {
  const P = (d: number, brg = 0, from = { lat: 40, lon: -3 }) => destination(from.lat, from.lon, brg, d);
  const n0 = P(0);
  const n1 = P(300);
  const n2 = P(600);
  const east = P(300, 90, n1);
  const ways: OsmWay[] = [
    { id: 1, tags: { highway: 'primary', ref: 'N-1' }, nodes: [10, 11], geometry: [n0, n1] },
    { id: 2, tags: { highway: 'primary', ref: 'N-1' }, nodes: [11, 12], geometry: [n1, n2] },
    { id: 3, tags: { highway: 'secondary' }, nodes: [11, 13], geometry: [n1, east] },
  ];

  it('sigue la misma carretera y detecta el cruce', () => {
    const start = P(100);
    const m = matchWay({ lat: start.lat, lon: start.lon, heading: 0 }, ways)!;
    expect(m.way.id).toBe(1);
    expect(m.forward).toBe(true);
    const path = pathAhead(ways, m, 1000);
    expect(path.wayIds).toEqual([1, 2]);
    expect(path.length).toBeCloseTo(500, -1);
    expect(path.junctions).toHaveLength(1);
    expect(path.junctions[0].along).toBeCloseTo(200, -1);
    expect(path.junctions[0].exits).toBe(1);
  });

  it('en sentido contrario recorre la vía hacia atrás', () => {
    const start = P(450);
    const m = matchWay({ lat: start.lat, lon: start.lon, heading: 180 }, ways)!;
    expect(m.way.id).toBe(2);
    expect(m.forward).toBe(false);
    const path = pathAhead(ways, m, 1000);
    expect(path.wayIds[0]).toBe(2);
    expect(path.wayIds).toContain(1);
  });
});

import { classifyHazard, hazardWarnDistance } from '../shared/hazards';
import { parseCoordinates, parsePhoton } from '../shared/geocode';

describe('avisos de la vía', () => {
  it('clasifica nodos OSM', () => {
    expect(classifyHazard(1, 40, -3, { railway: 'level_crossing' })?.type).toBe('level_crossing');
    expect(classifyHazard(2, 40, -3, { traffic_calming: 'table' })).toMatchObject({ type: 'bump', label: 'Paso elevado' });
    expect(classifyHazard(3, 40, -3, { traffic_calming: 'choker' })?.type).toBe('narrow');
    expect(classifyHazard(4, 40, -3, { barrier: 'toll_booth' })?.label).toBe('Peaje');
    expect(classifyHazard(5, 40, -3, { hazard: 'animal_crossing' })?.label).toBe('Paso de animales');
    expect(classifyHazard(6, 40, -3, { highway: 'stop' })?.type).toBe('stop');
    expect(classifyHazard(7, 40, -3, { amenity: 'bench' })).toBeNull();
    expect(hazardWarnDistance('toll', 33)).toBeGreaterThan(hazardWarnDistance('bump', 33));
  });
});

describe('búsqueda', () => {
  it('reconoce coordenadas y respuestas de Photon', () => {
    expect(parseCoordinates('40.4168, -3.7038')).toMatchObject({ lat: 40.4168, lon: -3.7038 });
    expect(parseCoordinates('Calle Mayor 1')).toBeNull();
    const [p] = parsePhoton({ features: [{ geometry: { coordinates: [-3.7, 40.4] }, properties: { name: 'Puerta del Sol', city: 'Madrid', osm_id: 1, osm_type: 'N', country: 'España' } }] });
    expect(p).toMatchObject({ name: 'Puerta del Sol', detail: 'Madrid', lat: 40.4, lon: -3.7 });
  });
});
