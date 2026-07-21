import { federation } from "@module-federation/vite";
import { defineConfig } from "vite";

const remoteOrigin = process.env.RELEASE_MFE_ORIGIN ?? "http://127.0.0.1:4175";
const apiTarget = process.env.CONTROL_PLANE_API_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  base: `${remoteOrigin}/`,
  build: { target: "chrome89" },
  plugins: federation({
    dev: {
      disableDynamicRemoteTypeHints: true,
      disableHotTypesReload: true,
      disableLiveReload: true
    },
    exposes: { "./ReleaseApp": "./src/ReleaseApp.tsx" },
    filename: "remoteEntry.js",
    manifest: { fileName: "mf-manifest.json" },
    name: "release_mfe",
    shared: {
      react: { singleton: true },
      "react/": { singleton: true },
      "react-dom": { singleton: true },
      "react-dom/": { singleton: true }
    }
  }),
  server: {
    allowedHosts: ["release-mfe"],
    cors: true,
    host: "0.0.0.0",
    origin: remoteOrigin,
    port: 4175,
    proxy: {
      "/api": {
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
        target: apiTarget
      }
    }
  }
});
