import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Proxy for the browser preview, so Google Calendar .ics URLs can be tested
      // in the live preview without being blocked by CORS.
      '/ics-proxy': {
        target: 'https://calendar.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ics-proxy/, ''),
      },
    },
  },
});
