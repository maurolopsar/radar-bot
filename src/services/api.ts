// Cliente de la API propia (servidor proxy). Si no hay servidor, la app usa
// las fuentes que permiten acceso directo desde el navegador.

import type { AircraftResponse, FuelStation, RadarDataset, SourceStatus, TrafficCamera, TrafficEvent, UserReport } from '../../shared/types';
import { settings } from '../state/settings';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function base(): string {
  return settings.value.serverUrl.trim().replace(/\/+$/, '');
}

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ data: T | null; res: Response }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
  const headers = new Headers(init.headers);
  const token = settings.value.token.trim();
  if (token) headers.set('x-app-token', token);
  try {
    const res = await fetch(`${base()}/api${path}`, { ...init, headers, signal: ctrl.signal });
    if (res.status === 304) return { data: null, res };
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw new ApiError(res.status, res.ok ? 'Respuesta inesperada (¿hay servidor?)' : `HTTP ${res.status}`);
    const body = await res.json();
    if (!res.ok) throw new ApiError(res.status, body?.error ?? `HTTP ${res.status}`);
    return { data: body as T, res };
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new ApiError(0, 'Tiempo de espera agotado');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

const q = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

export function matcherParams() {
  const s = settings.value;
  const list = (v: string) => v.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean).join(',');
  return { regs: list(s.extraRegs), hex: list(s.extraHex), cs: list(s.extraCallsigns) };
}

export const api = {
  async health(): Promise<{ ok: boolean; tokenRequired: boolean; authorized?: boolean }> {
    return (await request<{ ok: boolean; tokenRequired: boolean; authorized?: boolean }>('/health', { timeoutMs: 8000 })).data!;
  },

  /** Devuelve null si el servidor responde 304 (sin cambios). */
  async radars(etag?: string): Promise<{ dataset: RadarDataset | null; etag?: string }> {
    const { data, res } = await request<RadarDataset>('/radars', {
      headers: etag ? { 'If-None-Match': etag } : {},
      timeoutMs: 90_000,
    });
    return { dataset: data, etag: res.headers.get('etag') ?? undefined };
  },

  async events(lat: number, lon: number, radiusKm: number, opts: { dgt: boolean; waze: boolean }) {
    const { data } = await request<{ events: TrafficEvent[]; sources: SourceStatus[] }>(
      `/events?${q({ lat: lat.toFixed(4), lon: lon.toFixed(4), radius: radiusKm, dgt: opts.dgt ? 1 : 0, waze: opts.waze ? 1 : 0 })}`,
      { timeoutMs: 40_000 },
    );
    return data!;
  },

  async aircraft(lat: number, lon: number, radiusKm: number): Promise<AircraftResponse> {
    const { data } = await request<AircraftResponse>(
      `/aircraft?${q({ lat: lat.toFixed(3), lon: lon.toFixed(3), radius: Math.round(radiusKm), ...matcherParams() })}`,
      { timeoutMs: 20_000 },
    );
    return data!;
  },

  async fleet(): Promise<AircraftResponse> {
    const { data } = await request<AircraftResponse>(`/aircraft/dgt?${q(matcherParams())}`, { timeoutMs: 40_000 });
    return data!;
  },

  async cameras(lat: number, lon: number, radiusKm: number): Promise<TrafficCamera[]> {
    const { data } = await request<{ cameras: TrafficCamera[] }>(`/cameras?${q({ lat, lon, radius: radiusKm })}`, { timeoutMs: 60_000 });
    return data!.cameras;
  },

  async fuel(lat: number, lon: number, radiusKm: number): Promise<FuelStation[]> {
    const { data } = await request<{ stations: FuelStation[] }>(`/fuel?${q({ lat, lon, radius: radiusKm, limit: 200 })}`, { timeoutMs: 90_000 });
    return data!.stations;
  },

  async reports(): Promise<UserReport[]> {
    const { data } = await request<{ reports: UserReport[] }>('/reports', { timeoutMs: 10_000 });
    return data!.reports;
  },

  async addReport(r: UserReport): Promise<void> {
    await request('/reports', { method: 'POST', body: JSON.stringify(r), headers: { 'content-type': 'application/json' } });
  },

  async deleteReport(id: string): Promise<void> {
    await request(`/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },
};
