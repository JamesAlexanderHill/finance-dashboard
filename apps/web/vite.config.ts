import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Single .env at the repo root, shared with the worker and migrations.
  Object.assign(process.env, loadEnv(mode, '../..', ''));
  return {
    envDir: '../..',
    // PORT is shared with the production server (serve.ts).
    server: { port: Number(process.env.PORT ?? 5025), strictPort: true },
    plugins: [tailwindcss(), tanstackStart(), viteReact()],
  };
});
