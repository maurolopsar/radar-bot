// Punto de entrada Node: API + ficheros estáticos de la app (dist/client).

import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createApp } from './app';
import { warmUpRadars } from './radars';

const port = Number(process.env.PORT ?? 8787);
const clientDir = process.env.CLIENT_DIR ?? join(process.cwd(), 'dist/client');

const app = createApp();

if (existsSync(clientDir)) {
  app.use(
    '/*',
    serveStatic({
      root: clientDir,
      onFound: (path, c) => {
        if (/\/assets\//.test(path)) c.header('Cache-Control', 'public, max-age=31536000, immutable');
        else c.header('Cache-Control', 'no-cache');
      },
    }),
  );
  const index = join(clientDir, 'index.html');
  app.get('*', async (c) => {
    if (c.req.path.startsWith('/api/')) return c.notFound();
    return c.html(await readFile(index, 'utf8'));
  });
}

serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '0.0.0.0' }, (info) => {
  console.log(`radar-bot escuchando en http://localhost:${info.port}`);
  if (process.env.APP_TOKEN) console.log('API protegida con APP_TOKEN');
  if (process.env.WARMUP !== '0') warmUpRadars();
});
