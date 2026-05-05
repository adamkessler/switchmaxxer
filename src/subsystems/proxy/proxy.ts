// Public proxy barrel. External consumers import from here; internal proxy modules use ./proxy-core.
export { proxyChatCompletion } from "./proxy-openai";
export { proxyAnthropicMessage } from "./proxy-anthropic";

export {
  classifyFetchError,
  classifyUpstreamStatus,
  describeFetchErrorDiagnostics,
  describeTestFailure,
  getAbortReason,
  getCallerDisplayLabel,
  normalizeTextContent,
  runRouteTests,
  runRouteTestsDetailed,
  sanitizeHeadersForLogging,
  sendJsonError,
  translateAnthropicEventToOpenAiChunks,
  translateAnthropicResponse,
  type ProxyRequest,
  type ProxyResponse,
  type RouteTestResult
} from "./proxy-core";
