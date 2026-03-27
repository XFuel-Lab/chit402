/**
 * Root vite.config.ts — LEGACY / COSMOS YIELD STATION
 *
 * This config was the build entry for the old Cosmos Yield Station frontend (src/).
 * That frontend has been archived to legacy-archive/cosmos-yield-station/.
 *
 * The canonical frontend is now xfuel-app/.
 * Its build config lives at xfuel-app/vite.config.ts.
 *
 * Retained here only so `npx vite` at root doesn't crash tools that probe it.
 */
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  root: 'xfuel-app',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 3000,
    open: true,
  },
})
