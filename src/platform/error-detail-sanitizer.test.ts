import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeErrorDetails } from "./error-detail-sanitizer";

void test("sanitizeErrorDetails strips sensitive keys while preserving safe metadata", () => {
  assert.deepEqual(
    sanitizeErrorDetails({
      store_path: "/tmp/observability.sqlite",
      run_id: "run-123",
      api_key: "should-not-leak",
      api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
      auth_mode: "header",
      authentication_scheme: "bearer",
      nested: {
        trace_id: "trace-123",
        auth_token: "should-not-leak",
        auth_source: "env var"
      },
      camelCase: {
        sessionToken: "should-not-leak",
        apiKeyEnv: "SWITCHMAXXER_ANTHROPIC_API_KEY"
      },
      deep: {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  level6: "too-deep"
                }
              }
            }
          }
        }
      }
    }),
    {
      store_path: "/tmp/observability.sqlite",
      run_id: "run-123",
      api_key_env: "SWITCHMAXXER_OPENAI_API_KEY",
      auth_mode: "header",
      authentication_scheme: "bearer",
      nested: {
        trace_id: "trace-123",
        auth_source: "env var"
      },
      camelCase: {
        apiKeyEnv: "SWITCHMAXXER_ANTHROPIC_API_KEY"
      },
      deep: {
        level1: {
          level2: {
            level3: {
              level4: {
                level5: {
                  truncated: true
                }
              }
            }
          }
        }
      }
    }
  );
});

void test("sanitizeErrorDetails redacts sensitive keys with surrounding underscores", () => {
  assert.deepEqual(
    sanitizeErrorDetails({
      _api_key: "should-not-leak",
      apiKey_: "should-not-leak",
      __authorization__: "should-not-leak",
      safe_value: "ok"
    }),
    {
      safe_value: "ok"
    }
  );
});
