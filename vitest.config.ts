import { defineConfig } from "vitest/config";

// only our own tests — research/ holds a reference clone with its own suite
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
