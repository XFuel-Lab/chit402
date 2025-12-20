import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Use Vite's default esbuild minifier and configure it to drop console/debugger
    esbuild: {
      drop: ['console', 'debugger'],
    },
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
        },
        // Ensure no eval is used in production build
        format: 'es',
      },
    },
    // Ensure production build doesn't use eval
    minify: 'esbuild',
  },
  server: {
    port: 3000,
    open: true,
  },
  preview: {
    port: 3000,
  },
})

