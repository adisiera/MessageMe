import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            return id.includes('@mui') || id.includes('@emotion') ? 'ui' : 'vendor';
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3001' },
      '/ws': { target: 'ws://127.0.0.1:3001', ws: true },
    },
  },
});
