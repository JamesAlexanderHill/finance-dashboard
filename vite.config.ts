import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import { defineConfig } from 'vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

export default defineConfig({
  server: {
    port: 3000,
  },
  plugins: [
    tailwindcss(),
    tsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tanstackStart(),
    viteReact(),
  ],
  resolve: {
    // In the browser/client bundle, replace the Node.js-only pg driver
    // with an empty stub. TanStack Start's createServerFn ensures DB code never
    // executes in the browser — this keeps Rollup happy at build time.
    // The ssr.external config below overrides this for the server environment.
    alias: {
      pg: path.resolve(__dirname, 'src/db/browser-stub.ts'),
    },
  },
  ssr: {
    // In the SSR/server environment, use the real pg package (not the alias).
    external: ['pg', 'drizzle-orm', 'drizzle-orm/node-postgres', 'uuidv7'],
  },
})
