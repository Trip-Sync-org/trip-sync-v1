import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, path.resolve(__dirname, ".."), "");
  return {
    root: path.resolve(__dirname),
    plugins: [react(), tailwindcss()],
    build: {
      outDir: "dist",
      emptyOutDir: true,
      chunkSizeWarningLimit: 1000,
    },
    define: {
      "process.env.GEMINI_API_KEY": JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "."),
      },
    },
    server: {
      allowedHosts: true,
      proxy: {
        "/api": {
          target: "http://127.0.0.1:3000",
          changeOrigin: true,
        },
      },
    },
  };
});

