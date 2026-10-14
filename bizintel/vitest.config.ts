import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // Test files share one throwaway SQLite file; run them one at a time.
    fileParallelism: false,
    // Tests never touch the real workspace database.
    env: { BIZINTEL_DATA_DIR: join(tmpdir(), `bizintel-test-${process.pid}`) },
  },
});
