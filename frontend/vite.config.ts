import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "icons/*.svg", "fonts/*.woff2"],
      manifest: {
        name: "Chindi",
        short_name: "chindi",
        description: "Keep more. Regret less.",
        display: "standalone",
        background_color: "#FFFBF3",
        theme_color: "#FFFBF3",
        start_url: "/",
        shortcuts: [{ name: "Add expense", url: "/?add=1" }],
        icons: [
          {
            src: "/icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any",
          },
          {
            src: "/icons/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,woff2,png,svg}"],
        navigateFallbackDenylist: [/^\/api/],
        importScripts: ["/push-sw.js"],
      },
    }),
  ],
  server: {
    proxy: { "/api": process.env.CHINDI_API_URL || "http://127.0.0.1:8000" },
  },
  preview: {
    proxy: { "/api": process.env.CHINDI_API_URL || "http://127.0.0.1:8000" },
  },
});
