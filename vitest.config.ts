import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts?(x)"],
    // These suites exercise retired HTTP contracts. Their simulation coverage lives in simulation.test.ts.
    exclude: [...configDefaults.exclude, "tests/{background-bus-api,bus-journey-api,departure-empty-states,train-positions-api}.test.ts"],
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
