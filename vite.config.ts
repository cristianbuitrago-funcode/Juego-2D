import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// El cliente vive en /client. En desarrollo, Vite redirige /socket.io al servidor de juego (puerto 3000).
export default defineConfig({
  root: 'client',
  publicDir: 'public',
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/socket.io': { target: 'http://localhost:3000', ws: true },
    },
  },
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
  },
});
