import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  resolve: { alias: { "@sm/shared": path.resolve(__dirname, "packages/shared/src/index.ts") } },
  test: { include: ["packages/**/tests/**/*.test.ts", "apps/server/tests/**/*.test.ts"] },
});
