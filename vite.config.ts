import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

function ghostPagesSourceSwap(): Plugin {
  return {
    name: 'ghost-pages-source-swap',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html
          .replace(
            /<link[^>]*href="\.\/assets\/ghost-analyzer\.css"[^>]*>\s*/g,
            ''
          )
          .replace(
            /<script[^>]*src="\.\/assets\/ghost-analyzer\.js"[^>]*><\/script>/g,
            '<script type="module" src="/src/main.tsx"></script>'
          );
      },
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [ghostPagesSourceSwap(), react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    assetsDir: 'assets',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/ghost-analyzer.js',
        chunkFileNames: 'assets/ghost-analyzer-[name].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name && assetInfo.name.endsWith('.css')) {
            return 'assets/ghost-analyzer.css';
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
});
