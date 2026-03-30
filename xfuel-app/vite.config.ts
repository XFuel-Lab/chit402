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
  define: {
    'import.meta.env.VITE_SPLITTER_ADDRESS': JSON.stringify(process.env.VITE_SPLITTER_ADDRESS || ''),
    'import.meta.env.VITE_VERIFIER_ADDRESS': JSON.stringify(process.env.VITE_VERIFIER_ADDRESS || ''),
    'import.meta.env.VITE_GOVERNANCE_ADDRESS': JSON.stringify(process.env.VITE_GOVERNANCE_ADDRESS || ''),
    'import.meta.env.VITE_THETA_INFERENCE_ADDRESS': JSON.stringify(process.env.VITE_THETA_INFERENCE_ADDRESS || ''),
    'import.meta.env.VITE_BELIEVER_ROUND_ADDRESS': JSON.stringify(process.env.VITE_BELIEVER_ROUND_ADDRESS || ''),
    'import.meta.env.VITE_ANGEL_ROUND_ADDRESS': JSON.stringify(process.env.VITE_ANGEL_ROUND_ADDRESS || ''),
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || ''),
    'import.meta.env.VITE_M2M_API_URL': JSON.stringify(process.env.VITE_M2M_API_URL || ''),
    'import.meta.env.VITE_COMMUNITY_CONTENT_URL': JSON.stringify(process.env.VITE_COMMUNITY_CONTENT_URL || ''),
    'import.meta.env.VITE_SUBCHAIN_TESTNET_RPC': JSON.stringify(process.env.VITE_SUBCHAIN_TESTNET_RPC || ''),
    'import.meta.env.VITE_SUBCHAIN_MAINNET_RPC': JSON.stringify(process.env.VITE_SUBCHAIN_MAINNET_RPC || ''),
    'import.meta.env.VITE_SUBCHAIN_CHAINID': JSON.stringify(process.env.VITE_SUBCHAIN_CHAINID || ''),
  },
});
