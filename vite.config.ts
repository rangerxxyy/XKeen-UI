import { defineConfig, type Plugin } from 'vite';

function applicationShell(): Plugin {
  const developmentDocument = '<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#080d18"><title>XKeen UI</title></head><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>';

  return {
    name: 'xkeen-application-shell',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.method !== 'GET' || (request.url !== '/' && request.url !== '/index.html')) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(developmentDocument);
      });
    },
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((item) => item.type === 'chunk' && item.isEntry);
      if (!entry || entry.type !== 'chunk') throw new Error('Vite entry chunk was not emitted');
      const styles = [...(entry.viteMetadata?.importedCss ?? [])]
        .map((file) => `<link rel="stylesheet" href="./${file}">`)
        .join('');
      this.emitFile({
        type: 'asset',
        fileName: 'index.html',
        source: `<!doctype html><html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#080d18"><meta name="description" content="Локальная панель управления XKeen, Xray и Mihomo"><title>XKeen UI</title>${styles}</head><body><div id="app"></div><script type="module" src="./${entry.fileName}"></script></body></html>`,
      });
    },
  };
}

export default defineConfig({
  plugins: [applicationShell()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/health': 'http://127.0.0.1:1001',
      '/api': 'http://127.0.0.1:1001',
    },
  },
  build: {
    outDir: 'release/web',
    emptyOutDir: true,
    rollupOptions: { input: 'src/main.ts' },
  },
});
