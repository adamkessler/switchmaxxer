import { safeJsonStringifyWithinBounds } from "../../../../platform/json-bounds";
import type { AppConfig } from "../../../../platform/types";
import type { GatewayOpenAiChatRequestBody } from "../runtime/request-body-types";
import { handleUpstreamResponseForOpenAiClient } from "./proxy-response-handlers";
import { buildPatchedJsonBody } from "./proxy-request-shape";
import { buildAnthropicRequestBodyFromOpenAi } from "./proxy-translation";
import { buildUpstreamModel } from "./proxy-upstream-model";
import {
  executeProxyRequest,
  validateListenerForRequest,
  type ProxyRequest,
  type ProxyResponse
} from "./proxy-core";

export async function proxyChatCompletion(
  request: ProxyRequest,
  response: ProxyResponse,
  config: AppConfig,
  parsedBody: GatewayOpenAiChatRequestBody,
  rawBody: string,
  runtimeOptions: {
    fetchImpl?: typeof fetch;
  } = {}
): Promise<void> {
  await executeProxyRequest(request, response, config, parsedBody, rawBody, {
    apiSurface: "openai",
    forwardMode: "openai-listener",
    fetchImpl: runtimeOptions.fetchImpl,
    validateRoute: validateListenerForRequest,
    buildRequestBody: (route, requestBody, maxSerializedBytes) =>
      route.api_mode === "anthropic-messages"
        ? safeJsonStringifyWithinBounds(
            buildAnthropicRequestBodyFromOpenAi(parsedBody, buildUpstreamModel(route)),
            { maxSerializedBytes }
          )
        : buildPatchedJsonBody(
            requestBody,
            parsedBody,
            { model: buildUpstreamModel(route) },
            { maxSerializedBytes }
          ),
    handleResponse: handleUpstreamResponseForOpenAiClient
  });
}
