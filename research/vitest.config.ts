import { defineConfig } from "vitest/config";
import tsConfigPaths from "vite-tsconfig-paths";

// Tests only need the "@" path alias; the app build plugins (TanStack Start,
// Nitro, Tailwind) are not loaded here.
export default defineConfig({
  plugins: [tsConfigPaths({ projects: ["./tsconfig.json"] })],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
