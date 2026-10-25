import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    globalSetup: ["./src/test/globalSetup.ts"],
    env: { DATABASE_URL: "file:./test.db" },
    fileParallelism: false,
  },
});
