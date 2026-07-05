import { defineConfig } from "vite";
import { unitflowAliases } from "../vite.shared";

export default defineConfig({
  resolve: {
    alias: unitflowAliases,
  },
  server: {
    host: "127.0.0.1",
    port: 4304,
  },
  preview: {
    host: "127.0.0.1",
    port: 4404,
  },
});
