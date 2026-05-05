import { safeErrorMessage } from "../../platform/logger";
import {
  buildObservabilityIpcErrorResponse,
  OBSERVABILITY_IPC_ERROR_CODES,
  type ObservabilityIpcOperation,
  type ObservabilityIpcRequest,
  type ObservabilityIpcResponse
} from "./observability-ipc-contract";
import {
  validateObservabilityIpcRequest,
  validateObservabilityIpcResponse
} from "./observability-ipc-validation";
import { validateObservabilityIpcOperationResponseResult } from "./observability-ipc-result-validation";

export interface ObservabilityIpcExternalTransport {
  exchange<T extends ObservabilityIpcOperation>(
    request: ObservabilityIpcRequest<T>
  ): Promise<unknown>;
}

export async function dispatchExternalObservabilityIpcRequest<T extends ObservabilityIpcOperation>(
  transport: ObservabilityIpcExternalTransport,
  requestFrame: ObservabilityIpcRequest<T>
): Promise<ObservabilityIpcResponse<T>> {
  const requestValidation = validateObservabilityIpcRequest(requestFrame, {
    transport: "external"
  });
  if (!requestValidation.ok) {
    return buildObservabilityIpcErrorResponse({
      id: requestValidation.error.id,
      code: OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch,
      message: requestValidation.error.message,
      details: requestValidation.error.details
    });
  }

  const request = requestValidation.request as ObservabilityIpcRequest<T>;

  let responseFrame: unknown;
  try {
    responseFrame = await transport.exchange(request);
  } catch (error) {
    return buildObservabilityIpcErrorResponse({
      id: request.id,
      code: OBSERVABILITY_IPC_ERROR_CODES.engineUnavailable,
      message: safeErrorMessage(error),
      details: {
        operation: request.operation
      }
    });
  }

  const responseValidation = validateObservabilityIpcResponse(responseFrame);
  if (!responseValidation.ok) {
    return buildObservabilityIpcErrorResponse({
      id: responseValidation.error.id,
      code: OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch,
      message: responseValidation.error.message,
      details: responseValidation.error.details
    });
  }

  const resultValidation = validateObservabilityIpcOperationResponseResult(request.operation, responseValidation.response);
  if (resultValidation !== null) {
    return buildObservabilityIpcErrorResponse({
      id: responseValidation.response.id,
      code: OBSERVABILITY_IPC_ERROR_CODES.protocolMismatch,
      message: resultValidation.message,
      details: {
        field: resultValidation.field,
        operation: request.operation,
        transport: "external"
      }
    });
  }

  return responseValidation.response as ObservabilityIpcResponse<T>;
}
