import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
  },
    build: {
        chunkSizeWarningLimit: 800,
    },
  plugins: [react()],
  resolve: {
    alias: {
        "@": path.resolve(__dirname, "./frontend"),
        // Resolve directory import to index so Vite/Rollup load the file (fixes ENOENT on Vercel)
        "@/lib/copy": path.resolve(__dirname, "./frontend/lib/copy/index.ts"),
    },
  },
}));
