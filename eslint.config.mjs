import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import globals from "globals";

export default [
  {
    ignores: ["dist/**", "node_modules/**"]
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname
      },
      globals: {
        ...globals.node
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin
    },
    rules: {
      "no-tabs": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        {
          checksVoidReturn: {
            attributes: false
          }
        }
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_"
        }
      ]
    }
  },
  // Boundary rule: code inside src/subsystems/hot-path/manatee/ must not
  // reach into smx subsystems that are not part of the hot path. The
  // contract package and observation-emit helper are the sanctioned
  // surfaces; the rest of smx (CLI, MCP, optimize, bench) is off-limits.
  // Observability access goes through manatee/observation-emit.ts; the
  // direct calls (recordGatewayObservation, recordGatewayFailureObservation)
  // are forbidden inside Manatee — `emitObservation` and the legacy
  // passthroughs are the only sanctioned imports from
  // ../observability/gateway, and only from observation-emit.ts itself.
  {
    files: ["src/subsystems/hot-path/manatee/**/*.ts"],
    ignores: ["src/subsystems/hot-path/manatee/observation-emit.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["**/subsystems/cli/**"],      message: "Hot-path code must not import smx CLI modules." },
            { group: ["**/subsystems/mcp/**"],      message: "Hot-path code must not import smx MCP modules." },
            { group: ["**/subsystems/optimize/**"], message: "Hot-path code must not import smx optimize modules." },
            { group: ["**/subsystems/bench/**"],    message: "Hot-path code must not import smx bench modules." },
            { group: ["**/subsystems/observability/**"], message: "Use emitObservation / emitLegacyGatewayObservation from manatee/observation-emit.ts instead." }
          ]
        }
      ]
    }
  }
];
