import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppConfig } from "../../../../platform/types";
import type { InboundApiKeyOverrides, LocalGatewayInboundAuthState } from "./local-gateway-auth";
import type {
  GatewayAnthropicMessagesRequestBody,
  GatewayOpenAiChatRequestBody
} from "./request-body-types";
import type {
  JsonParseConcurrencyManager,
  StreamingRequestConcurrencyManager
} from "./runtime-state-managers";
import type {
  GatewayReadModel,
  GatewayRuntimeSnapshot
} from "./runtime-snapshot";

export type GatewayRuntimeRequestHandler = {
  (
    request: IncomingMessage,
    response: ServerResponse,
    activeRuntime?: GatewayRuntimeSnapshot
  ): Promise<void>;
  dispose: () => void;
};

export type GatewayRuntimeRequestHandlerDeps = {
  loadConfig: (configPath?: string) => AppConfig;
  loadCliReadModel: (configPath?: string) => GatewayReadModel;
  resolveLocalGatewayInboundAuthState: (
    inboundApiKeyEnv: string | null | undefined,
    allowUnauthenticatedGateway: boolean,
    apiKeyOverrides?: InboundApiKeyOverrides
  ) => LocalGatewayInboundAuthState;
  apiKeyOverrides?: InboundApiKeyOverrides;
  timingSafeTokenMatches: (providedToken: string, expectedToken: string) => boolean;
  proxyAnthropicMessage: (
    request: IncomingMessage,
    response: ServerResponse,
    config: AppConfig,
    parsedBody: GatewayAnthropicMessagesRequestBody,
    rawBody: string
  ) => Promise<void>;
  proxyChatCompletion: (
    request: IncomingMessage,
    response: ServerResponse,
    config: AppConfig,
    parsedBody: GatewayOpenAiChatRequestBody,
    rawBody: string
  ) => Promise<void>;
  sendJsonError: (
    response: ServerResponse,
    statusCode: number,
    message: string,
    code: string
  ) => void;
  readRequestBodyWithLimit: (
    request: IncomingMessage,
    maxPayloadSize: number,
    idleTimeoutMs: number,
    totalTimeoutMs: number
  ) => Promise<string>;
  validateParsedRequestBodyShape: (body: Record<string, unknown>, maxPayloadSize: number) => void;
  resolveConfiguredSystemdUnit: (config: Pick<AppConfig, "systemdUnit">) => string;
  logLine: (message: string) => void;
  logWarning: (message: string) => void;
  defaultRequestBodyIdleTimeoutMs: number;
  isInvokeInspectionSecretRevealAllowed?: () => boolean;
  jsonParseConcurrencyManager?: JsonParseConcurrencyManager;
  streamingRequestConcurrencyManager?: StreamingRequestConcurrencyManager;
};
