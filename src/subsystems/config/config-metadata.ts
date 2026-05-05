import { API_MODES, MODEL_ID_FORMATS } from "../../platform/types";

export const MCP_USAGE_ERROR_CODES = {
  missingRequiredField: "missing_required_field",
  missingFlagValue: "missing_flag_value",
  invalidFlagValue: "invalid_flag_value",
  conflictingStructuredInput: "conflicting_structured_input",
  conflictingInputModes: "conflicting_input_modes",
  conflictingCostFlags: "conflicting_cost_flags",
  incompleteCostFlags: "incomplete_cost_flags",
  unsupportedClearCost: "unsupported_clear_cost",
  invalidInputField: "invalid_input_field",
  missingUpdateFields: "missing_update_fields"
} as const;

export const MCP_ENTITY_STATE_ERROR_CODES = {
  modelNotFound: "model_not_found",
  providerNotFound: "provider_not_found",
  routeNotFound: "route_not_found",
  modelAlreadyExists: "model_already_exists",
  providerAlreadyExists: "provider_already_exists",
  routeAlreadyExists: "route_already_exists",
  modelInUse: "model_in_use",
  providerInUse: "provider_in_use",
  unknownModel: "unknown_model",
  unknownServiceProvider: "unknown_service_provider"
} as const;

type ConfigFieldMetadata = {
  type: string;
  role?: "identifier";
  required_on_create?: boolean;
  writable_on?: Array<"create" | "update">;
  mutation_mode?: string;
  flag?: string;
  flags?: string[];
  clearable_on_update?: boolean;
  clear_flag?: string;
  values?: string[];
  constraints?: string[];
  derived?: boolean;
  effective?: boolean;
  notes?: string[];
};

type ConfigEntityMetadata = {
  list_command: string;
  show_command: string;
  create_command: string;
  update_command: string;
  delete_command: string;
  show_includes_editability: boolean;
  structured_input: string[];
  delete_constraints: string[];
  state_errors: string[];
  fields: Record<string, ConfigFieldMetadata>;
};

type ConfigMetadataProjection = {
  entities: Record<string, unknown>;
  error_codes: {
    mutation_usage: string[];
    entity_state: string[];
  };
};

function buildConfigEntityDefinitions(): Record<string, ConfigEntityMetadata> {
  return {
    model: {
      list_command: "switchmaxxer models list",
      show_command: "switchmaxxer models show <model-id>",
      create_command: "switchmaxxer models create <model-id>",
      update_command: "switchmaxxer models update <model-id>",
      delete_command: "switchmaxxer models delete <model-id>",
      show_includes_editability: true,
      structured_input: ["--stdin", "--json-input"],
      delete_constraints: [
        "model delete is blocked while any route still references the model"
      ],
      state_errors: [
        MCP_ENTITY_STATE_ERROR_CODES.modelNotFound,
        MCP_ENTITY_STATE_ERROR_CODES.modelAlreadyExists,
        MCP_ENTITY_STATE_ERROR_CODES.modelInUse
      ],
      fields: {
        name: {
          type: "string",
          role: "identifier",
          required_on_create: true,
          writable_on: ["create"],
          mutation_mode: "positional"
        },
        display_name: {
          type: "string",
          required_on_create: true,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--display-name"
        },
        model_creator: {
          type: "string",
          required_on_create: true,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--model-creator"
        },
        cost: {
          type: "cost",
          required_on_create: false,
          writable_on: ["create", "update"],
          clearable_on_update: true,
          mutation_mode: "cost_flags_or_structured_input",
          flags: ["--cost-input", "--cost-output", "--cost-cache-read", "--cost-cache-write"],
          clear_flag: "--clear-cost",
          constraints: [
            "all four cost flags are required when using flag-based cost input",
            "cost flags cannot be mixed with --stdin or --json-input"
          ]
        },
        route_count: {
          type: "integer",
          derived: true
        }
      }
    },
    provider: {
      list_command: "switchmaxxer providers list",
      show_command: "switchmaxxer providers show <provider-id>",
      create_command: "switchmaxxer providers create <provider-id>",
      update_command: "switchmaxxer providers update <provider-id>",
      delete_command: "switchmaxxer providers delete <provider-id>",
      show_includes_editability: true,
      structured_input: ["--stdin", "--json-input"],
      delete_constraints: [
        "provider delete is blocked while any route still references the provider"
      ],
      state_errors: [
        MCP_ENTITY_STATE_ERROR_CODES.providerNotFound,
        MCP_ENTITY_STATE_ERROR_CODES.providerAlreadyExists,
        MCP_ENTITY_STATE_ERROR_CODES.providerInUse
      ],
      fields: {
        name: {
          type: "string",
          role: "identifier",
          required_on_create: true,
          writable_on: ["create"],
          mutation_mode: "positional"
        },
        endpoint: {
          type: "string",
          required_on_create: true,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--endpoint"
        },
        allow_private_endpoints: {
          type: "boolean",
          required_on_create: false,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--allow-private-endpoints",
          notes: [
            "required to permit localhost, loopback, link-local, or RFC1918/private provider endpoints"
          ]
        },
        allow_insecure_http: {
          type: "boolean",
          required_on_create: false,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--allow-insecure-http",
          notes: [
            "required to permit plain http:// provider endpoints instead of https://"
          ]
        },
        api_mode: {
          type: "enum",
          values: [...API_MODES],
          required_on_create: true,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--api-mode"
        },
        anthropic_version: {
          type: "string_or_null",
          required_on_create: false,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--anthropic-version"
        },
        model_id_format: {
          type: "enum",
          values: [...MODEL_ID_FORMATS],
          required_on_create: false,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--model-id-format",
          notes: ["controls how provider_model_id is shaped for upstream requests"]
        },
        api_key: {
          type: "secret_or_null",
          required_on_create: false,
          writable_on: ["create"],
          mutation_mode: "stdin_or_structured_input",
          flag: "--api-key-stdin",
          notes: [
            "providers show returns a masked display-safe value rather than the raw secret",
            "rotate or clear inline secrets after creation with providers set-key / providers clear-key rather than providers update"
          ]
        },
        api_key_env: {
          type: "string_or_null",
          required_on_create: false,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--api-key-env"
        },
        auth_source: {
          type: "enum",
          values: ["inline override", "secrets override", "env var", "not required"],
          derived: true
        }
      }
    },
    route: {
      list_command: "switchmaxxer routes list",
      show_command: "switchmaxxer routes show <route-id>",
      create_command: "switchmaxxer routes create <route-id>",
      update_command: "switchmaxxer routes update <route-id>",
      delete_command: "switchmaxxer routes delete <route-id>",
      show_includes_editability: true,
      structured_input: ["--stdin", "--json-input"],
      delete_constraints: [],
      state_errors: [
        MCP_ENTITY_STATE_ERROR_CODES.routeNotFound,
        MCP_ENTITY_STATE_ERROR_CODES.routeAlreadyExists,
        MCP_ENTITY_STATE_ERROR_CODES.unknownModel,
        MCP_ENTITY_STATE_ERROR_CODES.unknownServiceProvider
      ],
      fields: {
        name: {
          type: "string",
          role: "identifier",
          required_on_create: true,
          writable_on: ["create"],
          mutation_mode: "positional"
        },
        display_name: {
          type: "string",
          required_on_create: true,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--display-name"
        },
        model: {
          type: "string",
          required_on_create: true,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--model"
        },
        service_provider: {
          type: "string",
          required_on_create: true,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--service-provider"
        },
        provider_model_id: {
          type: "string",
          required_on_create: true,
          writable_on: ["create", "update"],
          mutation_mode: "flag_or_structured_input",
          flag: "--provider-model-id"
        },
        timeout_ms: {
          type: "integer_or_null",
          required_on_create: false,
          writable_on: ["create", "update"],
          clearable_on_update: true,
          mutation_mode: "flag_or_structured_input",
          flag: "--timeout-ms",
          clear_flag: "--clear-timeout-ms",
          constraints: [
            "route timeout override must be a positive integer when provided",
            "when omitted, the route inherits the top-level timeout_ms default"
          ]
        },
        cost: {
          type: "cost",
          required_on_create: false,
          writable_on: ["create", "update"],
          clearable_on_update: true,
          mutation_mode: "cost_flags_or_structured_input",
          flags: ["--cost-input", "--cost-output", "--cost-cache-read", "--cost-cache-write"],
          clear_flag: "--clear-cost",
          constraints: [
            "all four cost flags are required when using flag-based cost input",
            "cost flags cannot be mixed with --stdin or --json-input",
            "route cost overrides model cost when both are present"
          ]
        },
        api_mode: {
          type: "enum",
          derived: true
        },
        model_cost: {
          type: "cost_or_null",
          derived: true
        },
        effective_timeout_ms: {
          type: "integer_or_null",
          effective: true
        },
        effective_cost: {
          type: "cost_or_null",
          effective: true
        }
      }
    }
  };
}

function buildCliFieldProjection(field: ConfigFieldMetadata): Record<string, unknown> {
  return { ...field };
}

function buildMcpFieldProjection(field: ConfigFieldMetadata): Record<string, unknown> {
  const result: Record<string, unknown> = {
    type: field.type
  };

  if (field.role !== undefined) {
    result["role"] = field.role;
  }
  if (field.required_on_create !== undefined) {
    result["required_on_create"] = field.required_on_create;
  }
  if (field.writable_on !== undefined) {
    result["writable_on"] = [...field.writable_on];
  }
  if (field.clearable_on_update !== undefined) {
    result["clearable_on_update"] = field.clearable_on_update;
  }
  if (field.values !== undefined) {
    result["values"] = [...field.values];
  }
  if (field.constraints !== undefined) {
    result["constraints"] = [...field.constraints];
  }
  if (field.derived !== undefined) {
    result["derived"] = field.derived;
  }
  if (field.effective !== undefined) {
    result["effective"] = field.effective;
  }
  if (field.notes !== undefined) {
    result["notes"] = [...field.notes];
  }

  return result;
}

function buildConfigMetadataProjection(
  projectEntity: (entity: ConfigEntityMetadata) => Record<string, unknown>
): ConfigMetadataProjection {
  const entities = buildConfigEntityDefinitions();
  return {
    entities: Object.fromEntries(
      Object.entries(entities).map(([name, entity]) => [name, projectEntity(entity)])
    ),
    error_codes: {
      mutation_usage: Object.values(MCP_USAGE_ERROR_CODES),
      entity_state: Object.values(MCP_ENTITY_STATE_ERROR_CODES)
    }
  };
}

export function buildCliConfigSchemaMetadata(): ConfigMetadataProjection {
  return buildConfigMetadataProjection((entity) => ({
    list_command: entity.list_command,
    show_command: entity.show_command,
    create_command: entity.create_command,
    update_command: entity.update_command,
    delete_command: entity.delete_command,
    show_includes_editability: entity.show_includes_editability,
    structured_input: [...entity.structured_input],
    delete_constraints: [...entity.delete_constraints],
    state_errors: [...entity.state_errors],
    fields: Object.fromEntries(
      Object.entries(entity.fields).map(([fieldName, field]) => [fieldName, buildCliFieldProjection(field)])
    )
  }));
}

export function buildMcpConfigSchemaMetadata(): ConfigMetadataProjection {
  return buildConfigMetadataProjection((entity) => ({
    show_includes_editability: entity.show_includes_editability,
    delete_constraints: [...entity.delete_constraints],
    state_errors: [...entity.state_errors],
    fields: Object.fromEntries(
      Object.entries(entity.fields).map(([fieldName, field]) => [fieldName, buildMcpFieldProjection(field)])
    )
  }));
}

export function buildModelFieldMetadata(): {
  writable: string[];
  derived: string[];
  effective: string[];
} {
  return {
    writable: ["display_name", "model_creator", "cost"],
    derived: ["name", "route_count"],
    effective: []
  };
}

export function buildProviderFieldMetadata(): {
  writable: string[];
  derived: string[];
  effective: string[];
} {
  return {
    writable: ["endpoint", "allow_private_endpoints", "allow_insecure_http", "api_mode", "anthropic_version", "model_id_format", "api_key_env"],
    derived: ["name", "auth_source"],
    effective: []
  };
}

export function buildRouteFieldMetadata(): {
  writable: string[];
  derived: string[];
  effective: string[];
} {
  return {
    writable: ["display_name", "model", "service_provider", "provider_model_id", "timeout_ms", "cost"],
    derived: ["name", "api_mode", "model_cost"],
    effective: ["effective_cost", "effective_timeout_ms"]
  };
}
