// Descargas HTTP con tiempo límite y cabeceras comunes.

export const USER_AGENT =
  process.env.HTTP_USER_AGENT ??
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 radar-bot/0.1';

/** Identificación honesta para APIs (algunas rechazan con 403 un "navegador" que llega desde un servidor). */
export const API_USER_AGENT = 'radar-bot/0.3 (uso personal; +https://github.com/maurolopsar/radar-bot)';

export interface FetchOptions {
  timeoutMs?: number;
  headers?: Record<string, string>;
  method?: string;
  body?: string | URLSearchParams;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message?: string,
  ) {
    super(message ?? `HTTP ${status} en ${new URL(url).host}`);
  }
}

export async function fetchRaw(url: string, opts: FetchOptions = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      body: opts.body,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'es-ES,es;q=0.9',
        ...opts.headers,
      },
      signal: ctrl.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new HttpError(res.status, url);
    return res;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new Error(`Tiempo agotado en ${new URL(url).host}`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchText(url: string, opts: FetchOptions & { encoding?: string } = {}): Promise<string> {
  const res = await fetchRaw(url, opts);
  const buf = new Uint8Array(await res.arrayBuffer());
  const enc = opts.encoding ?? charsetOf(res.headers.get('content-type')) ?? 'utf-8';
  return new TextDecoder(enc).decode(buf);
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchRaw(url, { ...opts, headers: { Accept: 'application/json', ...opts.headers } });
  return (await res.json()) as T;
}

function charsetOf(ct: string | null): string | undefined {
  const m = ct ? /charset=([\w-]+)/i.exec(ct) : null;
  return m?.[1]?.toLowerCase();
}

export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as Error & { cause?: { code?: string; message?: string } }).cause;
  const detail = cause?.code ?? cause?.message;
  return detail && !err.message.includes(detail) ? `${err.message} (${detail})` : err.message;
}
