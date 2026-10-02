// Avisos propios del usuario, guardados en disco para compartirlos entre dispositivos.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ReportKind, UserReport } from '../shared/types';
import { DATA_DIR, writeJsonFile } from './lib/cache';

const FILE = join(DATA_DIR, 'reports.json');
const KINDS: ReportKind[] = ['mobile_radar', 'police', 'helicopter', 'accident', 'hazard', 'other'];

let reports: UserReport[] | null = null;

async function load(): Promise<UserReport[]> {
  if (reports) return reports;
  try {
    reports = JSON.parse(await readFile(FILE, 'utf8')) as UserReport[];
  } catch {
    reports = [];
  }
  return reports;
}

function active(list: UserReport[], now = Date.now()): UserReport[] {
  return list.filter((r) => !r.expiresAt || Date.parse(r.expiresAt) > now);
}

export async function listReports(): Promise<UserReport[]> {
  return active(await load());
}

export function validateReport(body: unknown): UserReport {
  const b = body as Partial<UserReport>;
  if (!b || typeof b !== 'object') throw new Error('Cuerpo inválido');
  if (!KINDS.includes(b.kind as ReportKind)) throw new Error('Tipo de aviso inválido');
  if (typeof b.lat !== 'number' || typeof b.lon !== 'number' || Math.abs(b.lat) > 90 || Math.abs(b.lon) > 180) {
    throw new Error('Coordenadas inválidas');
  }
  return {
    id: typeof b.id === 'string' && b.id.length <= 64 ? b.id : crypto.randomUUID(),
    kind: b.kind as ReportKind,
    lat: b.lat,
    lon: b.lon,
    heading: typeof b.heading === 'number' ? b.heading : undefined,
    note: typeof b.note === 'string' ? b.note.slice(0, 280) : undefined,
    createdAt: typeof b.createdAt === 'string' ? b.createdAt : new Date().toISOString(),
    expiresAt: typeof b.expiresAt === 'string' ? b.expiresAt : undefined,
  };
}

export async function addReport(r: UserReport): Promise<UserReport> {
  const list = active(await load()).filter((x) => x.id !== r.id);
  list.push(r);
  reports = list;
  await writeJsonFile(FILE, list);
  return r;
}

export async function deleteReport(id: string): Promise<boolean> {
  const list = await load();
  const next = list.filter((r) => r.id !== id);
  reports = next;
  await writeJsonFile(FILE, next);
  return next.length !== list.length;
}
