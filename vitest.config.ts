import "dotenv/config";
import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
resolve: {
    alias: {
      // Match the existing TypeScript/Next.js @/* alias.
      "@": path.resolve(process.cwd(), "src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
  },
});
