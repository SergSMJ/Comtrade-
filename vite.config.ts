import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// SINGLE=1 — збірка в один HTML-файл (відкривається з диска без сервера).
const single = process.env.SINGLE === '1';

export default defineConfig({
  base: './',
  plugins: single ? [viteSingleFile()] : [],
  build: { outDir: single ? 'dist-single' : 'dist', chunkSizeWarningLimit: 6000 },
});
