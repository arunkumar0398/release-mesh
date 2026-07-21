import { federation } from "@module-federation/vite";
import { defineConfig } from "vite";

const apiTarget = process.env.CONTROL_PLANE_API_TARGET ?? "http://127.0.0.1:4000";

export default defineConfig({
  build: { target: "chrome89" },
  plugins: federation({
    dev: {
      disableDynamicRemoteTypeHints: true,
      disableHotTypesReload: true,
      disableLiveReload: true
    },
    name: "shell",
    shared: {
      react: { singleton: true },
      "react/": { singleton: true },
      "react-dom": { singleton: true },
      "react-dom/": { singleton: true }
    }
  }),
  server: {
    allowedHosts: ["shell"],
    host: "0.0.0.0",
    port: 4174,
    proxy: {
      "/api": {
        changeOrigin: false,
        rewrite: (path) => path.replace(/^\/api/, ""),
        target: apiTarget
      }
    }
  }
});
