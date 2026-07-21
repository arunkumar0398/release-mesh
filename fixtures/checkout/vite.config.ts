import { defineConfig } from "vite";

export default defineConfig({
  server: {
    allowedHosts: ["checkout"],
    proxy: {
      "/pricing": {
        changeOrigin: false,
        target: process.env.PRICING_PROXY_TARGET ?? "http://127.0.0.1:4100"
      }
    }
  }
});
