import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  plugins: [preact()],
  root: '.',
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    port: 5317,
    proxy: { '/api': { target: 'http://127.0.0.1:4317', changeOrigin: true } },
  },
});
