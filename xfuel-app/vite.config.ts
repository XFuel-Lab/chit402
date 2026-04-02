import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    strictPort: false,
    // Windows: some setups resolve localhost poorly; 0.0.0.0 + http://127.0.0.1:PORT is reliable
    host: true,
  },
  build: { outDir: 'dist', sourcemap: true },
});
