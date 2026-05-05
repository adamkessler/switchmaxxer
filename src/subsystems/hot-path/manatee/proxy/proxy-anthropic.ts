import type { AppConfig } from "../../../../platform/types";
import type { GatewayAnthropicMessagesRequestBody } from "../runtime/request-body-types";
import { handleUpstreamResponseForAnthropicClient } from "./proxy-response-handlers";
import { buildPatchedJsonBody } from "./proxy-request-shape";
import { buildUpstreamModel } from "./proxy-upstream-model";
import {
  executeProxyRequest,
  validateListenerForRequest,
  type ProxyRequest,
  type ProxyResponse
} from "./proxy-core";

export async function proxyAnthropicMessage(
  request: ProxyRequest,
  response: ProxyResponse,
  config: AppConfig,
  parsedBody: GatewayAnthropicMessagesRequestBody,
  rawBody: string,
  runtimeOptions: {
    fetchImpl?: typeof fetch;
  } = {}
): Promise<void> {
  await executeProxyRequest(request, response, config, parsedBody, rawBody, {
    apiSurface: "anthropic",
    forwardMode: "anthropic-listener",
    fetchImpl: runtimeOptions.fetchImpl,
    validateRoute: validateListenerForRequest,
    buildRequestBody: (route, requestBody, maxSerializedBytes) =>
      buildPatchedJsonBody(
        requestBody,
        parsedBody,
        { model: buildUpstreamModel(route) },
        { maxSerializedBytes }
      ),
    handleResponse: handleUpstreamResponseForAnthropicClient
  });
}
