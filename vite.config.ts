import {defineConfig} from "vite";
import {reactWithCompiler} from "./vite.shared-plugins";
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

                    if (id.includes("react-router")) {
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
  // React + React Compiler — shared with vitest.config.ts so the test
  // pipeline can never drift from the app pipeline. panicThreshold
  // 'all_errors' is permanent: a non-compiling component fails the build.
  // See scripts/enumerate_compiler_bailouts.mjs for a full-tree listing.
  plugins: reactWithCompiler(),
  resolve: {
    alias: {
        "@": path.resolve(__dirname, "./frontend"),
        // Resolve directory import to index so Vite/Rollup load the file (fixes ENOENT on Vercel)
        "@/lib/copy": path.resolve(__dirname, "./frontend/lib/copy/index.ts"),
        "@prumo/pdf-viewer": path.resolve(__dirname, "./frontend/pdf-viewer/index.ts"),
    },
  },
}));
