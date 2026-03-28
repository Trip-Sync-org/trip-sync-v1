import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR + middlewareMode are configured in server.ts (hmr.server = shared httpServer) for LAN/mobile.
      // AI Studio: set DISABLE_HMR=true to disable HMR / file watching.
      allowedHosts: true,
      // If you run `vite` alone while `tsx server.ts` listens on 3000, point another port (e.g. 5173) here and use this proxy.
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
