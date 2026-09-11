import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { handlePasskeyApi } from "./server/passkeys/index.js";

const passkeyApi: Plugin = {
  name: "passkey-api",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!(await handlePasskeyApi(req, res))) next();
    });
  },
};

export default defineConfig(({ mode }) => {
  // These values stay in the Node process. Only VITE_* values may enter the client.
  const localEnv = loadEnv(mode, import.meta.dirname, "");
  for (const key of ["DATABASE_URL", "PASSKEY_ORIGIN", "PASSKEY_RP_ID", "PASSKEY_DEV_ORIGINS"]) {
    if (process.env[key] === undefined && localEnv[key]) process.env[key] = localEnv[key];
  }
  return {
    plugins: [react(), tailwindcss(), passkeyApi],
    root: path.resolve(import.meta.dirname, "client"),
    envDir: import.meta.dirname,
    resolve: { alias: {
      "@": path.resolve(import.meta.dirname, "client/src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
    } },
    build: { outDir: path.resolve(import.meta.dirname, "dist/public"), emptyOutDir: true },
    server: { host: "127.0.0.1", port: 4173, strictPort: true },
  };
});
