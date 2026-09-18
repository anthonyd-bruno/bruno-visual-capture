import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Dev: run the backend with `PORT=4011 pnpm dev` and this proxies /api to it. The proxy drops the
// browser's Origin header so the backend's same-origin guard (PRD §20) still holds in dev.
const API = `http://127.0.0.1:${process.env.BRU_CAPTURE_API_PORT ?? 4011}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': {
        target: API,
        changeOrigin: true,
        configure: (proxy) => { proxy.on('proxyReq', (req) => { req.removeHeader('origin'); }); },
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
});
