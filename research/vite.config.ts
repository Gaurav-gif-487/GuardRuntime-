// Plugin stack: TanStack devtools (dev-only, first), tsConfigPaths (for the "@" alias),
// tailwindcss, tanstackStart, viteReact, and nitro (build-only, cloudflare-module preset).
import { defineConfig } from "vite";
import { devtools } from "@tanstack/devtools-vite";
import tsConfigPaths from "vite-tsconfig-paths";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";

export default defineConfig({
  plugins: [
    devtools(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      // nitro/vite builds from this
      server: { entry: "server" },
    }),
    viteReact(),
    nitro({ preset: "cloudflare-module" }),
  ],
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router", "@tanstack/react-start"],
  },
});
