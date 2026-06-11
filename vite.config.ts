import {defineConfig} from "vite";
import react, {reactCompilerPreset} from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
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

                    if (id.includes("pdfjs-dist")) {
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
  plugins: [
    react(),
    // Bailout enumeration (plan Task 4): reactCompilerPreset({panicThreshold: 'all_errors'})
    babel({presets: [reactCompilerPreset()]}),
  ],
  resolve: {
    alias: {
        "@": path.resolve(__dirname, "./frontend"),
        // Resolve directory import to index so Vite/Rollup load the file (fixes ENOENT on Vercel)
        "@/lib/copy": path.resolve(__dirname, "./frontend/lib/copy/index.ts"),
        "@prumo/pdf-viewer": path.resolve(__dirname, "./frontend/pdf-viewer/index.ts"),
    },
  },
}));
