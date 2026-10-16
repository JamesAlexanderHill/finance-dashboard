/** Production server: serves built client assets, everything else goes to the TanStack Start handler. */
import { join, normalize } from 'node:path';
// @ts-expect-error built at deploy time by `vite build`
import app from './dist/server/server.js';

const clientDir = join(import.meta.dir, 'dist/client');
const port = Number(process.env.PORT ?? 5025);

Bun.serve({
  port,
  // Large statement uploads are allowed (validated again per file by the upload route).
  maxRequestBodySize: 200 * 1024 * 1024,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/assets/')) {
      const path = normalize(join(clientDir, pathname));
      if (path.startsWith(clientDir)) {
        const file = Bun.file(path);
        if (await file.exists()) return new Response(file, { headers: { 'cache-control': 'public, max-age=31536000, immutable' } });
      }
    }
    return app.fetch(request);
  },
});
console.log(`[web] listening on :${port}`);
