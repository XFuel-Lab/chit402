import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';

export default defineConfig({
  plugins: [react()],
  server: { port: 3000 },
  build: { outDir: 'dist', sourcemap: true },
  define: {
    'import.meta.env.VITE_SPLITTER_ADDRESS': JSON.stringify(process.env.VITE_SPLITTER_ADDRESS || ''),
    'import.meta.env.VITE_VERIFIER_ADDRESS': JSON.stringify(process.env.VITE_VERIFIER_ADDRESS || ''),
    'import.meta.env.VITE_GOVERNANCE_ADDRESS': JSON.stringify(process.env.VITE_GOVERNANCE_ADDRESS || ''),
    'import.meta.env.VITE_THETA_INFERENCE_ADDRESS': JSON.stringify(process.env.VITE_THETA_INFERENCE_ADDRESS || ''),
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || ''),
  },
});
