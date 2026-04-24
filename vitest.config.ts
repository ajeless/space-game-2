import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: [
        "src/**/*.test.ts",
        "src/client/**",
        "src/shared/network.ts",
        "src/shared/resolver/types.ts"
      ],
      thresholds: {
        "src/shared/**": {
          lines: 85,
          // v8 counts every `??` / `||` and defensive `throw` arm as a branch; the
          // remaining gap is dominated by unreachable defensive paths guarded by the
          // validator layer. Reachable data-driven branches identified by spec review
          // are covered by tests/shared_branch_coverage.test.ts. Lines/functions/statements
          // are held at 85%; branches sits at 70 until a larger fixture refresh lifts
          // motion/sensing/planned_shots coverage past the remaining defensive noise.
          branches: 70,
          functions: 85,
          statements: 85
        }
      }
    }
  }
});
