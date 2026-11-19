import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      // Handige proxy voor tijdens browser-preview zodat je .ics URLs van Google Calendar
      // zonder CORS-blokkade rechtstreeks in de live preview kunt testen!
      '/ics-proxy': {
        target: 'https://calendar.google.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/ics-proxy/, ''),
      },
    },
  },
});
