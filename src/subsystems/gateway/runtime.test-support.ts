import type { IncomingMessage, ServerResponse } from "node:http";

import {
  createGatewayRuntimeRequestHandler,
  type GatewayRuntimeRequestHandlerDeps
} from "./runtime-request-handler";
import type { GatewayRuntimeSnapshot } from "./runtime-snapshot";

type TestEnvValue = string | null | undefined;
type OriginalEnvValue = { hadValue: true; value: string } | { hadValue: false };

export function createGatewayRequestHandlerFactoryForTests(
  deps: GatewayRuntimeRequestHandlerDeps
): (
  activeRuntime?: GatewayRuntimeSnapshot
) => (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const requestHandler = createGatewayRuntimeRequestHandler(deps);

  return (
    activeRuntime?: GatewayRuntimeSnapshot
  ): (request: IncomingMessage, response: ServerResponse) => Promise<void> =>
    async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
      await requestHandler(request, response, activeRuntime);
    };
}

export function buildGatewayRequestHandlerForTests(
  deps: GatewayRuntimeRequestHandlerDeps,
  activeRuntime?: GatewayRuntimeSnapshot
): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  return createGatewayRequestHandlerFactoryForTests(deps)(activeRuntime);
}

export async function withEnv<T>(
  values: Record<string, TestEnvValue>,
  fn: () => T | Promise<T>
): Promise<T> {
  const originalValues = new Map<string, OriginalEnvValue>();

  for (const key of Object.keys(values)) {
    const value = process.env[key];
    if (Object.prototype.hasOwnProperty.call(process.env, key) && value !== undefined) {
      originalValues.set(key, { hadValue: true, value });
    } else {
      originalValues.set(key, { hadValue: false });
    }
  }

  try {
    for (const [key, value] of Object.entries(values)) {
      if (value === null || value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    return await fn();
  } finally {
    for (const [key, original] of originalValues) {
      if (original.hadValue) {
        process.env[key] = original.value;
      } else {
        delete process.env[key];
      }
    }
  }
}
