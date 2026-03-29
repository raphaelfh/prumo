import {defineConfig} from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// https://vitejs.dev/config/
export default defineConfig(({mode: _mode}) => ({
  server: {
    host: "::",
    port: 8080,
  },
    build: {
        chunkSizeWarningLimit: 800,
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes("node_modules")) return undefined;

                    if (id.includes("react-pdf") || id.includes("pdfjs-dist") || id.includes("@react-pdf-viewer")) {
                        return "pdf-vendor";
                    }

                    if (id.includes("@tanstack/react-query")) {
                        return "query-vendor";
                    }

                    if (id.includes("@radix-ui")) {
                        return "radix-vendor";
                    }

                    if (id.includes("react-router-dom")) {
                        return "router-vendor";
                    }

                    if (id.includes("react") || id.includes("react-dom") || id.includes("scheduler")) {
                        return "react-vendor";
                    }

                    if (id.includes("lucide-react")) {
                        return "icons-vendor";
                    }

                    return undefined;
                },
            },
        },
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
