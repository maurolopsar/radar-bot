// Cachés en memoria con persistencia opcional en disco y "stale-while-revalidate".

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { errorMessage } from './http';

export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data');

async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(value));
  await rename(tmp, file);
}

export interface CachedValue<T> {
  value: T | undefined;
  updatedAt?: number;
  error?: string;
  stale: boolean;
}

interface Persisted<T> {
  value: T;
  updatedAt: number;
}

/**
 * Valor que se recarga cada `ttlMs`. Si la recarga falla se sigue sirviendo el
 * último valor bueno (en memoria o en disco) marcado como `stale`.
 */
export class CachedResource<T> {
  private value: T | undefined;
  private updatedAt: number | undefined;
  private lastError: string | undefined;
  private lastAttempt = 0;
  private inflight: Promise<void> | null = null;
  private loadedFromDisk = false;

  constructor(
    public readonly key: string,
    private readonly ttlMs: number,
    private readonly loader: () => Promise<T>,
    private readonly opts: { persist?: boolean; retryMs?: number } = {},
  ) {}

  private get file(): string {
    return join(DATA_DIR, `cache-${this.key}.json`);
  }

  private async loadDisk(): Promise<void> {
    if (this.loadedFromDisk || !this.opts.persist) return;
    this.loadedFromDisk = true;
    const p = await readJsonFile<Persisted<T>>(this.file);
    if (p && this.value === undefined) {
      this.value = p.value;
      this.updatedAt = p.updatedAt;
    }
  }

  private fresh(now: number): boolean {
    return this.updatedAt !== undefined && now - this.updatedAt < this.ttlMs;
  }

  private refresh(): Promise<void> {
    if (this.inflight) return this.inflight;
    this.lastAttempt = Date.now();
    this.inflight = (async () => {
      try {
        const v = await this.loader();
        this.value = v;
        this.updatedAt = Date.now();
        this.lastError = undefined;
        if (this.opts.persist) {
          await writeJsonFile(this.file, { value: v, updatedAt: this.updatedAt } satisfies Persisted<T>).catch((e) =>
            console.warn(`[cache] no se pudo guardar ${this.key}: ${errorMessage(e)}`),
          );
        }
      } catch (err) {
        this.lastError = errorMessage(err);
        console.warn(`[cache] ${this.key}: ${this.lastError}`);
      } finally {
        this.inflight = null;
      }
    })();
    return this.inflight;
  }

  /**
   * Devuelve el valor. Si está caducado: con `wait` espera la recarga (hasta
   * `waitMs`); sin `wait` devuelve el valor viejo y recarga en segundo plano.
   */
  async get(opts: { wait?: boolean; waitMs?: number } = {}): Promise<CachedValue<T>> {
    await this.loadDisk();
    const now = Date.now();
    const retryMs = this.opts.retryMs ?? Math.min(this.ttlMs, 60_000);
    if (!this.fresh(now) && now - this.lastAttempt > retryMs) {
      const p = this.refresh();
      if (opts.wait || this.value === undefined) {
        await (opts.waitMs ? Promise.race([p, new Promise((r) => setTimeout(r, opts.waitMs))]) : p);
      }
    } else if (this.inflight && this.value === undefined) {
      await (opts.waitMs ? Promise.race([this.inflight, new Promise((r) => setTimeout(r, opts.waitMs))]) : this.inflight);
    }
    return {
      value: this.value,
      updatedAt: this.updatedAt,
      error: this.lastError,
      stale: !this.fresh(Date.now()) || this.lastError !== undefined,
    };
  }

  /** Fuerza recarga en la próxima petición. */
  invalidate(): void {
    this.updatedAt = undefined;
    this.lastAttempt = 0;
  }
}

/** Caché clave->valor con caducidad, para consultas por zona (Waze, aviones...). */
export class TtlMap<V> {
  private map = new Map<string, { v: V; exp: number }>();
  private inflight = new Map<string, Promise<V>>();

  constructor(
    private ttlMs: number,
    private max = 200,
  ) {}

  async getOrLoad(key: string, loader: () => Promise<V>): Promise<V> {
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit && hit.exp > now) return hit.v;
    const running = this.inflight.get(key);
    if (running) return running;
    const p = loader()
      .then((v) => {
        this.map.set(key, { v, exp: Date.now() + this.ttlMs });
        if (this.map.size > this.max) {
          const oldest = [...this.map.entries()].sort((a, b) => a[1].exp - b[1].exp)[0];
          if (oldest) this.map.delete(oldest[0]);
        }
        return v;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}
