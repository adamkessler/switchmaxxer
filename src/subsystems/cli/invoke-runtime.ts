import { readFileSync } from "node:fs";
import { APP_ERROR_CODES, type AppErrorCode } from "../../platform/error-codes";
import { parseCanonicalFiniteNumber } from "../../platform/number-parsing";
import { isRecord } from "../../platform/type-guards";
import {
  INVOKE_INSPECTION_REQUEST_HEADER,
  INVOKE_INSPECTION_RESPONSE_HEADER,
  INVOKE_INSPECTION_TOKEN_HEADER,
  type InvokeInspectionCaptureView
} from "../hot-path/manatee/runtime/invoke-inspection";
import { renderInvokeInspectionTable } from "./invoke-inspection-view";
import { parsePositiveIntegerFlagValue } from "./command-arg-primitives";

type InvokeApiMode = "openai" | "anthropic" | "auto";

export function createInvokeRuntime(deps: {
  readLongFlagValue: (
    argv: string[],
    index: number,
    flagName: string,
    missingValueMessage?: string
  ) => { consumed: number; value?: string; errorMessage?: string } | null;
  printUsageError: (message: string) => void;
  readCliStdin: () => Promise<string>;
  loadCliReadModel: (configPath?: string) => {
    routesByName: Record<string, { api_mode: string } | undefined>;
  };
  loadConfigJsonDocument: (configPath?: string) => {
    sourcePath: string;
    sourceFile: string;
    document: Record<string, unknown>;
  };
  buildLocalGatewayAuthHeaders: (
    inboundApiKeyEnv: string | null,
    allowUnauthenticatedGateway: boolean,
    oneTrustedOperatorBoundary?: boolean
  ) => Headers;
  writeJsonErrorEnvelope: (command: string, code: AppErrorCode, message: string) => void;
  writeJsonSuccessEnvelope: (command: string, data: unknown) => void;
  writeStderr: (message: string) => void;
  writeStdout: (message: string) => void;
  defaultCliFetchTimeoutMs: number;
  routeNotFoundCode: AppErrorCode;
}): {
  runInvoke: (
    argv: string[],
    options?: { commandName: "invoke"; failurePrefix: string }
  ) => Promise<number>;
} {
  function parseInvokeArgs(argv: string[]): {
    route?: string;
    api: InvokeApiMode;
    prompt?: string;
    system?: string;
    filePath?: string;
    stdin: boolean;
    stream: boolean;
    temperature?: number;
    maxTokens?: number;
    timeoutMs?: number;
    configPath?: string;
    json: boolean;
    inspect?: boolean;
    includeSecrets?: boolean;
    errorMessage?: string;
  } {
    let route: string | undefined;
    let api: InvokeApiMode = "auto";
    let prompt: string | undefined;
    let system: string | undefined;
    let filePath: string | undefined;
    let stdin = false;
    let stream = false;
    let temperature: number | undefined;
    let maxTokens: number | undefined;
    let timeoutMs: number | undefined;
    let configPath: string | undefined;
    let json = false;
    let inspect = false;
    let includeSecrets = false;

    for (let index = 0; index < argv.length; index += 1) {
      const arg = argv[index];

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--route");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          route = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--api");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          if (parsedFlag.value !== "openai" && parsedFlag.value !== "anthropic" && parsedFlag.value !== "auto") {
            return {
              route,
              api,
              prompt,
              system,
              filePath,
              stdin,
              stream,
              temperature,
              maxTokens,
              configPath,
              json,
              errorMessage: "Flag '--api' must be one of openai, anthropic, or auto"
            };
          }
          api = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--prompt");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          prompt = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--system");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          system = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--file");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          filePath = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      if (arg === "--stdin") {
        stdin = true;
        continue;
      }

      if (arg === "--stream") {
        stream = true;
        continue;
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--temperature");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          const parsed = parseCanonicalFiniteNumber(parsedFlag.value);
          if (parsed === null) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: "Flag '--temperature' must be numeric" };
          }
          temperature = parsed;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--max-tokens");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          const parsed = parsePositiveIntegerFlagValue(parsedFlag.value, "--max-tokens");
          if (parsed.errorMessage || typeof parsed.value !== "number") {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: "Flag '--max-tokens' must be a positive integer" };
          }
          maxTokens = parsed.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--timeout-ms");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, timeoutMs, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          const parsed = parsePositiveIntegerFlagValue(parsedFlag.value, "--timeout-ms");
          if (parsed.errorMessage || typeof parsed.value !== "number") {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, timeoutMs, configPath, json, errorMessage: "Flag '--timeout-ms' must be a positive integer" };
          }
          timeoutMs = parsed.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      {
        const parsedFlag = deps.readLongFlagValue(argv, index, "--config", "Flag '--config' requires a path value");
        if (parsedFlag) {
          if (parsedFlag.errorMessage) {
            return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, errorMessage: parsedFlag.errorMessage };
          }
          configPath = parsedFlag.value;
          index += parsedFlag.consumed;
          continue;
        }
      }

      if (arg === "--json") {
        json = true;
        continue;
      }

      if (arg === "--inspect") {
        inspect = true;
        continue;
      }

      if (arg === "--include-secrets") {
        includeSecrets = true;
        continue;
      }

      return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, inspect, includeSecrets, errorMessage: `Unknown flag '${arg}'` };
    }

    if (!route) {
      return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, inspect, includeSecrets, errorMessage: "Flag '--route' is required" };
    }

    const promptSources = [typeof prompt === "string", typeof filePath === "string", stdin].filter(Boolean).length;
    if (promptSources !== 1) {
      return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, inspect, includeSecrets, errorMessage: "Use exactly one of '--prompt', '--file', or '--stdin'" };
    }

    if (json && stream) {
      return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, inspect, includeSecrets, errorMessage: "Flag combination '--json --stream' is not supported" };
    }

    if (inspect && stream) {
      return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, inspect, includeSecrets, errorMessage: "Flag combination '--inspect --stream' is not supported" };
    }

    if (inspect && json) {
      return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, inspect, includeSecrets, errorMessage: "Flag combination '--inspect --json' is not supported" };
    }

    if (includeSecrets && !inspect) {
      return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, configPath, json, inspect, includeSecrets, errorMessage: "Flag '--include-secrets' requires '--inspect'" };
    }

    return { route, api, prompt, system, filePath, stdin, stream, temperature, maxTokens, timeoutMs, configPath, json, inspect, includeSecrets };
  }

  function extractInvokeText(api: InvokeApiMode, rawText: string): string | null {
    try {
      const parsed = JSON.parse(rawText) as unknown;
      if (!isRecord(parsed)) {
        return null;
      }

      if (api === "anthropic") {
        const content = parsed["content"];

        if (Array.isArray(content)) {
          const text = content
            .flatMap((item) => {
              if (isRecord(item)) {
                const block = item;
                if (block["type"] === "text" && typeof block["text"] === "string") {
                  return [block["text"]];
                }
              }
              return [];
            })
            .join("");

          return text.length > 0 ? text : null;
        }
      }

      const choices = parsed["choices"];
      if (Array.isArray(choices) && choices.length > 0) {
        const first = isRecord(choices[0]) ? choices[0] : null;
        const message = first && isRecord(first["message"]) ? first["message"] : null;
        if (message && typeof message["content"] === "string") {
          return message["content"];
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  async function fetchInvokeInspectionCapture(options: {
    port: number;
    id: string;
    readToken: string;
    includeSecrets: boolean;
    headers: Headers;
    timeoutMs: number;
  }): Promise<InvokeInspectionCaptureView> {
    const endpoint =
      `http://127.0.0.1:${options.port}/__switchmaxxer/runtime/inspect/${options.id}` +
      (options.includeSecrets ? "?include_secrets=true" : "");
    const headers = new Headers(options.headers);
    headers.set(INVOKE_INSPECTION_TOKEN_HEADER, options.readToken);

    const response = await fetch(endpoint, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(options.timeoutMs)
    });
    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(`inspection endpoint returned HTTP ${response.status}: ${rawText.trim()}`);
    }

    const payload = JSON.parse(rawText) as {
      data?: {
        capture?: InvokeInspectionCaptureView;
      };
    };
    const capture = payload.data?.capture;

    if (!capture) {
      throw new Error("inspection endpoint returned an invalid payload");
    }

    return capture;
  }

  async function runInvoke(
    argv: string[],
    options: { commandName: "invoke"; failurePrefix: string } = {
      commandName: "invoke",
      failurePrefix: "Invoke"
    }
  ): Promise<number> {
    const parsedArgs = parseInvokeArgs(argv);
    const timeoutMs = parsedArgs.timeoutMs ?? deps.defaultCliFetchTimeoutMs;

    if (parsedArgs.errorMessage) {
      deps.printUsageError(parsedArgs.errorMessage);
      return 2;
    }

    const promptText = (() => {
      if (typeof parsedArgs.prompt === "string") {
        return parsedArgs.prompt;
      }

      if (typeof parsedArgs.filePath === "string") {
        return readFileSync(parsedArgs.filePath, "utf8");
      }

      return null;
    })();

    const routeName = parsedArgs.route as string;
    const readModel = deps.loadCliReadModel(parsedArgs.configPath);
    const route = readModel.routesByName[routeName];

    if (!route) {
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope(options.commandName, deps.routeNotFoundCode, `Route '${routeName}' was not found`);
        return 1;
      }

      deps.writeStderr(`${options.failurePrefix} failed: Route '${routeName}' was not found`);
      return 1;
    }

    const { sourcePath, sourceFile, document } = deps.loadConfigJsonDocument(parsedArgs.configPath);
    const port = typeof document["port"] === "number" && Number.isFinite(document["port"]) ? document["port"] : null;

    if (typeof port !== "number" || port <= 0) {
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope(options.commandName, APP_ERROR_CODES.invalidConfig, `Config '${sourcePath}' does not contain a valid numeric 'port'`);
        return 1;
      }

      deps.writeStderr(`${options.failurePrefix} failed: Config '${sourcePath}' does not contain a valid numeric 'port'`);
      return 1;
    }

    const api: "openai" | "anthropic" =
      parsedArgs.api === "auto" ? (route.api_mode === "anthropic-messages" ? "anthropic" : "openai") : parsedArgs.api;
    const prompt = promptText ?? (await deps.readCliStdin());
    const body: Record<string, unknown> =
      api === "anthropic"
        ? {
            model: routeName,
            messages: [{ role: "user", content: prompt }],
            max_tokens: parsedArgs.maxTokens ?? 256,
            stream: parsedArgs.stream
          }
        : {
            model: routeName,
            messages: [
              ...(parsedArgs.system ? [{ role: "system", content: parsedArgs.system }] : []),
              { role: "user", content: prompt }
            ],
            max_completion_tokens: parsedArgs.maxTokens ?? 256,
            stream: parsedArgs.stream
          };

    if (api === "anthropic" && parsedArgs.system) {
      body["system"] = parsedArgs.system;
    }

    if (typeof parsedArgs.temperature === "number") {
      body["temperature"] = parsedArgs.temperature;
    }

    const endpoint =
      api === "anthropic"
        ? `http://127.0.0.1:${port}/anthropic/v1/messages`
        : `http://127.0.0.1:${port}/v1/chat/completions`;
    const inboundApiKeyEnv =
      typeof document["inbound_api_key_env"] === "string" && document["inbound_api_key_env"].trim().length > 0
        ? document["inbound_api_key_env"]
        : null;
    const allowUnauthenticatedGateway = document["allow_unauthenticated_gateway"] === true;
    const oneTrustedOperatorBoundary = document["one_trusted_operator_boundary"] === true;
    let headers: Headers;

    try {
      headers = deps.buildLocalGatewayAuthHeaders(
        inboundApiKeyEnv,
        allowUnauthenticatedGateway,
        oneTrustedOperatorBoundary
      );
    } catch {
      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope(
          options.commandName,
          APP_ERROR_CODES.invokeError,
          inboundApiKeyEnv !== null
            ? `The selected config file requires inbound gateway auth via env var '${inboundApiKeyEnv}', but it is not set or is empty.`
            : "The selected config file does not define a valid inbound auth mode."
        );
        return 1;
      }

      deps.writeStderr(
        inboundApiKeyEnv !== null
          ? `${options.failurePrefix} failed: The selected config file requires inbound gateway auth via env var '${inboundApiKeyEnv}', but it is not set or is empty.`
          : `${options.failurePrefix} failed: The selected config file does not define a valid inbound auth mode.`
      );
      return 1;
    }

    headers.set("content-type", "application/json; charset=utf-8");
    headers.set("accept", parsedArgs.stream ? "text/event-stream" : "application/json");
    const inspectionRequested = parsedArgs.inspect === true;
    if (inspectionRequested) {
      headers.set(INVOKE_INSPECTION_REQUEST_HEADER, "1");
    }

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (parsedArgs.stream) {
        if (!response.body) {
          deps.writeStderr(`${options.failurePrefix} failed: stream response was empty`);
          return 1;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          deps.writeStdout(decoder.decode(value, { stream: true }).replace(/\n$/, ""));
        }

        const remainder = decoder.decode();
        if (remainder.length > 0) {
          deps.writeStdout(remainder.replace(/\n$/, ""));
        }

        return response.ok ? 0 : 1;
      }

      const rawText = await response.text();

      if (parsedArgs.json) {
        deps.writeJsonSuccessEnvelope(options.commandName, {
          route: routeName,
          api,
          source_file: sourceFile,
          source_path: sourcePath,
          gateway_url: endpoint,
          status_code: response.status,
          response_text: rawText
        });
        return response.ok ? 0 : 1;
      }

      if (inspectionRequested) {
        const inspectionId = response.headers.get(INVOKE_INSPECTION_RESPONSE_HEADER);
        if (inspectionId === null || inspectionId.trim().length === 0) {
          deps.writeStderr(`${options.failurePrefix} failed: gateway did not return an inspection id`);
          return 1;
        }

        const inspectionReadToken = response.headers.get(INVOKE_INSPECTION_TOKEN_HEADER);
        if (inspectionReadToken === null || inspectionReadToken.trim().length === 0) {
          deps.writeStderr(`${options.failurePrefix} failed: gateway did not return an inspection read token`);
          return 1;
        }

        const capture = await fetchInvokeInspectionCapture({
          port,
          id: inspectionId.trim(),
          readToken: inspectionReadToken.trim(),
          includeSecrets: parsedArgs.includeSecrets === true,
          headers,
          timeoutMs
        });
        deps.writeStdout(renderInvokeInspectionTable(capture));
        return response.ok ? 0 : 1;
      }

      if (response.ok) {
        const extracted = extractInvokeText(api, rawText);
        deps.writeStdout(extracted ?? rawText.trimEnd());
        return 0;
      }

      deps.writeStderr(`${options.failurePrefix} failed: HTTP ${response.status}`);
      if (rawText.trim().length > 0) {
        deps.writeStderr(rawText.trim());
      }
      return 1;
    } catch (error) {
      const message =
        error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")
          ? `Request timed out after ${timeoutMs}ms`
          : error instanceof Error
            ? error.message
            : "Unknown invoke error";

      if (parsedArgs.json) {
        deps.writeJsonErrorEnvelope(options.commandName, APP_ERROR_CODES.invokeError, message);
        return 1;
      }

      deps.writeStderr(`${options.failurePrefix} failed: ${message}`);
      return 1;
    }
  }

  return {
    runInvoke
  };
}
