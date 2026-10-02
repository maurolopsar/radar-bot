// Radares fijos y de tramo de la DGT (Punto de Acceso Nacional, DATEX II v1).
// https://nap.dgt.es/dataset/radares-fijos-dgt — Licencia CC BY. Cubre la red
// estatal salvo Cataluña y País Vasco (tienen competencias propias).
//
// Tramos con radar móvil (INVIVE): https://nap.dgt.es/es/dataset/tramos-invive

import type { Radar, Stretch } from '../../shared/types';
import { fetchText } from '../lib/http';
import { arr, coordsOf, num, parseXml, text, xsiType, type XNode } from '../lib/xml';

export const DGT_RADARS_URL = 'https://infocar.dgt.es/datex2/dgt/PredefinedLocationsPublication/radares/content.xml';
export const DGT_INVIVE_URL = 'https://nap.dgt.es/datex2/dgt/PredefinedLocationsPublication/tramos_invive/content.xml';

interface RefInfo {
  road?: string;
  pk?: number;
  direction?: string;
  directionRelative?: string;
  province?: string;
  area?: string;
}

function refInfo(ref: XNode): RefInfo {
  if (!ref) return {};
  const ext = ref.referencePointExtension?.ExtendedReferencePoint;
  const dist = num(ref.referencePointDistance);
  return {
    road: text(ref.roadNumber) ?? text(ref.roadName),
    pk: dist != null ? Math.round(dist) / 1000 : undefined,
    direction: text(ext?.directionNamed),
    directionRelative: text(ref.directionRelative),
    province: text(ext?.provinceINEIdentifier)?.padStart(2, '0'),
    area: text(ref.administrativeArea),
  };
}

function label(r: RefInfo): string {
  let s = r.road ?? 'Vía';
  if (r.pk != null) s += ` km ${r.pk.toFixed(1).replace('.', ',')}`;
  return s;
}

function* locations(doc: XNode): Generator<{ setId: string; id: string; inner: XNode }> {
  const pub = doc?.d2LogicalModel?.payloadPublication;
  for (const set of arr(pub?.predefinedLocationSet)) {
    const setId = String(set['@_id'] ?? '');
    for (const loc of arr(set.predefinedLocation)) {
      const id = String(loc['@_id'] ?? '').replace(/^GUID_/, '');
      const inner = arr(loc.predefinedLocation)[0];
      if (id && inner) yield { setId, id, inner };
    }
  }
}

export function parseDgtRadars(xml: string): { radars: Radar[]; stretches: Stretch[] } {
  const doc = parseXml(xml);
  const radars: Radar[] = [];
  const stretches: Stretch[] = [];
  for (const { setId, id, inner } of locations(doc)) {
    const type = xsiType(inner);
    if (type === 'Point') {
      const p = coordsOf(inner.tpegpointLocation?.point);
      if (!p) continue;
      const ref = refInfo(inner.referencePoint);
      const kind = /semaf/i.test(setId) ? 'redlight' : 'fixed';
      radars.push({
        id: `dgt-${id}`,
        kind,
        ...p,
        road: ref.road,
        pk: ref.pk,
        direction: ref.direction,
        name: `${kind === 'redlight' ? 'Semáforo' : 'Radar fijo'} ${label(ref)}`,
        sources: ['dgt'],
      });
    } else if (type === 'Linear') {
      const lin = inner.tpeglinearLocation;
      const from = coordsOf(lin?.from);
      const to = coordsOf(lin?.to);
      const rpl = inner.referencePointLinear;
      const ini = refInfo(rpl?.referencePointPrimaryLocation?.referencePoint);
      const fin = refInfo(rpl?.referencePointSecondaryLocation?.referencePoint);
      if (!from || !to) continue;
      const sectionId = `dgt-${id}`;
      const name = `Tramo ${ini.road ?? ''} km ${fmtKm(ini.pk)}–${fmtKm(fin.pk)}`.trim();
      stretches.push({
        id: sectionId,
        kind: 'section',
        coords: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
        road: ini.road,
        kmFrom: ini.pk,
        kmTo: fin.pk,
        direction: ini.direction,
        name,
        sources: ['dgt'],
      });
      for (const [end, p, r] of [
        ['ini', from, ini],
        ['fin', to, fin],
      ] as const) {
        radars.push({
          id: `dgt-${id}-${end}`,
          kind: 'section',
          ...p,
          road: r.road ?? ini.road,
          pk: r.pk,
          direction: r.direction ?? ini.direction,
          name: `Radar de tramo (${end === 'ini' ? 'inicio' : 'fin'}) ${label(r)}`,
          sectionId,
          sources: ['dgt'],
        });
      }
    }
  }
  return { radars, stretches };
}

function fmtKm(km: number | undefined): string {
  return km == null ? '?' : km.toFixed(1).replace('.', ',');
}

export function parseDgtInvive(xml: string): Stretch[] {
  const doc = parseXml(xml);
  const out: Stretch[] = [];
  for (const { id, inner } of locations(doc)) {
    const lin = inner.tpeglinearLocation;
    const from = coordsOf(lin?.from);
    const to = coordsOf(lin?.to);
    if (!from || !to) continue;
    const rpl = inner.referencePointLinear;
    const ini = refInfo(rpl?.referencePointPrimaryLocation?.referencePoint);
    const fin = refInfo(rpl?.referencePointSecondaryLocation?.referencePoint);
    const road = ini.road ?? text(arr(lin?.from?.name)[0]?.descriptor);
    const [a, b] = [ini.pk, fin.pk].sort((x, y) => (x ?? 0) - (y ?? 0));
    out.push({
      id: `invive-${id}`,
      kind: 'mobile_stretch',
      coords: [
        [from.lon, from.lat],
        [to.lon, to.lat],
      ],
      road,
      kmFrom: a,
      kmTo: b,
      name: `Tramo con radar móvil ${road ?? ''} km ${fmtKm(a)}–${fmtKm(b)}${ini.area ? ` (${ini.area})` : ''}`,
      sources: ['dgt_invive'],
    });
  }
  return out;
}

export async function fetchDgtRadars() {
  return parseDgtRadars(await fetchText(DGT_RADARS_URL, { timeoutMs: 60_000 }));
}

export async function fetchDgtInvive() {
  return { radars: [] as Radar[], stretches: parseDgtInvive(await fetchText(DGT_INVIVE_URL, { timeoutMs: 60_000 })) };
}
