export const MODEL_INPUT_SHAPES = {
  cliStructured: {
    create: ["name", "display_name", "model_creator", "cost"] as const,
    update: ["display_name", "model_creator", "cost"] as const
  },
  mcp: {
    show: ["model_id"] as const,
    create: ["model_id", "display_name", "model_creator", "cost"] as const,
    update: ["model_id", "display_name", "model_creator", "cost"] as const,
    delete: ["model_id"] as const
  }
} as const;

export const PROVIDER_INPUT_SHAPES = {
  cliStructured: {
    create: [
      "name",
      "endpoint",
      "allow_private_endpoints",
      "allow_insecure_http",
      "api_mode",
      "api_key",
      "api_key_env",
      "anthropic_version",
      "model_id_format"
    ] as const,
    update: [
      "endpoint",
      "allow_private_endpoints",
      "allow_insecure_http",
      "api_mode",
      "api_key_env",
      "anthropic_version",
      "model_id_format"
    ] as const
  },
  mcp: {
    show: ["provider_id"] as const,
    create: [
      "provider_id",
      "endpoint",
      "allow_private_endpoints",
      "allow_insecure_http",
      "api_mode",
      "anthropic_version",
      "model_id_format",
      "no_auth"
    ] as const,
    update: [
      "provider_id",
      "endpoint",
      "allow_private_endpoints",
      "allow_insecure_http",
      "api_mode",
      "anthropic_version",
      "model_id_format",
      "api_key_env",
      "no_auth"
    ] as const,
    delete: ["provider_id"] as const,
    setKey: ["provider_id", "api_key"] as const,
    clearKey: ["provider_id"] as const,
    setKeyEnv: ["provider_id", "api_key_env"] as const
  }
} as const;

export const ROUTE_INPUT_SHAPES = {
  cliStructured: {
    create: ["name", "model", "service_provider", "provider_model_id", "display_name", "timeout_ms", "cost"] as const,
    update: ["model", "service_provider", "provider_model_id", "display_name", "timeout_ms", "cost"] as const
  },
  mcp: {
    show: ["route_id"] as const,
    explain: ["route_id"] as const,
    create: ["route_id", "model", "service_provider", "provider_model_id", "display_name", "timeout_ms", "cost"] as const,
    update: ["route_id", "model", "service_provider", "provider_model_id", "display_name", "timeout_ms", "cost"] as const,
    delete: ["route_id"] as const
  }
} as const;

export function rejectUnknownStructuredInputFields(
  payload: Record<string, unknown>,
  allowedFields: readonly string[],
  sourceLabel: "stdin payload" | "json input",
  invalidInputField: (message: string) => never
): void {
  for (const field of Object.keys(payload)) {
    if (!allowedFields.includes(field)) {
      invalidInputField(`${sourceLabel} does not support field '${field}'`);
    }
  }
}
