import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/** Merchant dapp — proxies Bagseven public API + local demo bootstrap. */
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5177,
    strictPort: true,
    proxy: {
      '/v1': {
        target: 'http://127.0.0.1:4001',
        changeOrigin: true,
      },
      '/api/demo': {
        target: 'http://127.0.0.1:5178',
        changeOrigin: true,
      },
    },
  },
});
