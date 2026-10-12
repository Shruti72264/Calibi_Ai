import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Dev server configuration.
 *
 * The dashboard talks to the API through a *same-origin* relative path
 * (`/api/...`) and this proxy forwards it to the FastAPI process. Two reasons:
 *
 *  1. no CORS negotiation in the browser, and no API host baked into the bundle;
 *  2. the sandbox preview proxies the dev server, so requests from the preview
 *     origin reach the backend without the browser ever calling localhost.
 *
 * `allowedHosts: true` lets the preview host (https://<port>-<id>.e2b.app) and
 * any LAN hostname load the app; Vite otherwise rejects unknown Host headers.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiTarget = env.VITE_PROXY_TARGET || 'http://127.0.0.1:8000';

  return {
    // Pin the project root and keep PostCSS isolated: inline config stops Vite
    // from walking up into a parent directory and loading some other project's
    // postcss.config.js.
    root: __dirname,
    css: { postcss: { plugins: [] } },
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          // A dashboard poll should fail fast and visibly, not hang.
          configure: (proxy) => {
            proxy.on('error', (err) => {
              console.warn(`[vite-proxy] ${apiTarget} unreachable: ${err.message}`);
            });
          },
        },
      },
      headers: {
        // The preview runs inside an iframe; without this the app is blocked.
        'X-Frame-Options': 'ALLOWALL',
        'Content-Security-Policy': "frame-ancestors *",
      },
    },
    preview: {
      host: '0.0.0.0',
      port: 4173,
      allowedHosts: true,
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
