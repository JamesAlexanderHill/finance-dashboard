import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Single .env at the repo root, shared with the worker and migrations.
  Object.assign(process.env, loadEnv(mode, '../..', ''));
  return {
    envDir: '../..',
    server: { port: 3000 },
    plugins: [tailwindcss(), tanstackStart(), viteReact()],
  };
});
