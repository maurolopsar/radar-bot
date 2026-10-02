// API HTTP (Hono). Funciona en Node; el front se sirve aparte o desde server/index.ts.

import { Hono, type Context } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { DEFAULT_DGT_MATCHER, type DgtMatcher } from '../shared/aircraft';
import { bboxAround, distanceM } from '../shared/geo';
import type { SourceStatus, TrafficEvent } from '../shared/types';
import { CachedResource, TtlMap } from './lib/cache';
import { errorMessage } from './lib/http';
import { getRadarDataset } from './radars';
import { addReport, deleteReport, listReports, validateReport } from './reports';
import { aircraftNear, dgtFleet } from './sources/aircraft';
import { fetchDgtCameras } from './sources/cameras';
import { fetchDgtIncidents } from './sources/dgt-incidents';
import { fetchFuel } from './sources/fuel';
import { fetchWaze } from './sources/waze';

const MIN = 60_000;

const incidents = new CachedResource('dgt-incidents', 3 * MIN, fetchDgtIncidents, { retryMs: MIN });
const cameras = new CachedResource('dgt-cameras', 24 * 60 * MIN, fetchDgtCameras, { persist: true, retryMs: 30 * MIN });
const fuel = new CachedResource('fuel', 60 * MIN, fetchFuel, { persist: true, retryMs: 10 * MIN });
const wazeCache = new TtlMap<TrafficEvent[]>(60_000);
const aircraftCache = new TtlMap<Awaited<ReturnType<typeof aircraftNear>>>(6_000, 50);
const fleetCache = new TtlMap<Awaited<ReturnType<typeof dgtFleet>>>(15_000, 10);

function coords(c: Context): { lat: number; lon: number; radiusKm: number } | null {
  const lat = Number(c.req.query('lat'));
  const lon = Number(c.req.query('lon'));
  const radiusKm = Math.min(250, Math.max(0.5, Number(c.req.query('radius') ?? 20)));
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return { lat, lon, radiusKm: Number.isFinite(radiusKm) ? radiusKm : 20 };
}

function csv(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z0-9-]{2,12}$/.test(s));
}

function matcherFrom(c: Context): DgtMatcher {
  return {
    registrations: [...new Set([...DEFAULT_DGT_MATCHER.registrations, ...csv(c.req.query('regs'))])],
    hexes: csv(c.req.query('hex')).map((h) => h.toLowerCase()),
    callsignPrefixes: [...new Set([...DEFAULT_DGT_MATCHER.callsignPrefixes, ...csv(c.req.query('cs'))])],
  };
}

const round = (v: number, step: number) => Math.round(v / step) * step;

export function createApp(): Hono {
  const app = new Hono();
  const api = new Hono();

  api.use('*', cors());
  api.use('*', compress());
  api.use('*', async (c, next) => {
    const token = process.env.APP_TOKEN;
    if (token && c.req.method !== 'OPTIONS') {
      const given = c.req.header('x-app-token') ?? c.req.query('token');
      if (given !== token) return c.json({ error: 'Token incorrecto' }, 401);
    }
    await next();
  });

  api.get('/health', (c) => c.json({ ok: true, time: new Date().toISOString(), tokenRequired: !!process.env.APP_TOKEN }));

  api.get('/radars', async (c) => {
    const ds = await getRadarDataset();
    const etag = `"${ds.generatedAt}"`;
    c.header('ETag', etag);
    c.header('Cache-Control', 'no-cache');
    if (c.req.header('if-none-match') === etag) return c.body(null, 304);
    return c.json(ds);
  });

  api.get('/events', async (c) => {
    const p = coords(c);
    if (!p) return c.json({ error: 'lat/lon requeridos' }, 400);
    const wantDgt = c.req.query('dgt') !== '0';
    const wantWaze = c.req.query('waze') !== '0';
    const sources: SourceStatus[] = [];
    const events: TrafficEvent[] = [];
    const tasks: Promise<void>[] = [];
    if (wantDgt) {
      tasks.push(
        incidents.get({ waitMs: 20_000 }).then((v) => {
          const list = (v.value ?? []).filter((e) => distanceM(p.lat, p.lon, e.lat, e.lon) <= p.radiusKm * 1000);
          events.push(...list);
          sources.push({ key: 'dgt', label: 'DGT · incidencias y balizas V16', ok: !!v.value && !v.error, stale: v.stale, count: list.length, error: v.error, updatedAt: v.updatedAt ? new Date(v.updatedAt).toISOString() : undefined });
        }),
      );
    }
    if (wantWaze) {
      const r = Math.min(p.radiusKm, 40);
      const key = `${round(p.lat, 0.02)}:${round(p.lon, 0.02)}:${Math.round(r)}`;
      tasks.push(
        wazeCache
          .getOrLoad(key, () => fetchWaze(bboxAround(round(p.lat, 0.02), round(p.lon, 0.02), r * 1000)))
          .then((list) => {
            events.push(...list);
            sources.push({ key: 'waze', label: 'Waze · avisos de usuarios', ok: true, count: list.length });
          })
          .catch((err) => {
            sources.push({ key: 'waze', label: 'Waze · avisos de usuarios', ok: false, count: 0, error: errorMessage(err) });
          }),
      );
    }
    await Promise.all(tasks);
    return c.json({ events, sources, fetchedAt: new Date().toISOString() });
  });

  api.get('/aircraft', async (c) => {
    const p = coords(c);
    if (!p) return c.json({ error: 'lat/lon requeridos' }, 400);
    const m = matcherFrom(c);
    const key = `${round(p.lat, 0.01)}:${round(p.lon, 0.01)}:${Math.round(p.radiusKm)}:${c.req.query('regs') ?? ''}:${c.req.query('hex') ?? ''}:${c.req.query('cs') ?? ''}`;
    return c.json(await aircraftCache.getOrLoad(key, () => aircraftNear(p.lat, p.lon, p.radiusKm, m)));
  });

  api.get('/aircraft/dgt', async (c) => {
    const m = matcherFrom(c);
    const key = `${c.req.query('regs') ?? ''}:${c.req.query('hex') ?? ''}:${c.req.query('cs') ?? ''}`;
    return c.json(await fleetCache.getOrLoad(key, () => dgtFleet(m)));
  });

  api.get('/cameras', async (c) => {
    const p = coords(c);
    if (!p) return c.json({ error: 'lat/lon requeridos' }, 400);
    const v = await cameras.get({ waitMs: 30_000 });
    const list = (v.value ?? []).filter((cam) => distanceM(p.lat, p.lon, cam.lat, cam.lon) <= p.radiusKm * 1000);
    return c.json({ cameras: list, error: v.error });
  });

  api.get('/fuel', async (c) => {
    const p = coords(c);
    if (!p) return c.json({ error: 'lat/lon requeridos' }, 400);
    const limit = Math.min(500, Number(c.req.query('limit') ?? 150) || 150);
    const v = await fuel.get({ waitMs: 60_000 });
    const list = (v.value ?? [])
      .map((s) => ({ s, d: distanceM(p.lat, p.lon, s.lat, s.lon) }))
      .filter((x) => x.d <= p.radiusKm * 1000)
      .sort((a, b) => a.d - b.d)
      .slice(0, limit)
      .map((x) => x.s);
    return c.json({ stations: list, error: v.error, updatedAt: v.updatedAt ? new Date(v.updatedAt).toISOString() : undefined });
  });

  api.get('/reports', async (c) => c.json({ reports: await listReports() }));

  api.post('/reports', async (c) => {
    try {
      return c.json(await addReport(validateReport(await c.req.json())));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
  });

  api.delete('/reports/:id', async (c) => c.json({ deleted: await deleteReport(c.req.param('id')) }));

  api.onError((err, c) => {
    console.error('[api]', err);
    return c.json({ error: errorMessage(err) }, 500);
  });

  app.route('/api', api);
  return app;
}
