import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    proxy: {
      '/api/denizli': {
        target: 'https://ulasim.denizli.bel.tr',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/denizli/, ''),
        secure: false,
      },
      '/api/google': {
        target: 'https://maps.googleapis.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/google/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
