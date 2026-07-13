import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.CLONE_BASE_PATH || "/",
  plugins: [tanstackRouter({ autoCodeSplitting: true }), react()],
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
});
