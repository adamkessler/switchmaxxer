import { isRecord } from "../../platform/type-guards";

export function renderGatewayRuntimeConfigText(payload: Record<string, unknown>): string {
  const models = Array.isArray(payload["models"]) ? payload["models"] : [];
  const providers = Array.isArray(payload["providers"]) ? payload["providers"] : [];
  const routes = Array.isArray(payload["routes"]) ? payload["routes"] : [];
  const observability = isRecord(payload["observability"]) ? payload["observability"] : {};
  const retention = isRecord(observability["retention"]) ? observability["retention"] : {};

  const lines = [
    `Source File: ${String(payload["source_file"] ?? "(unknown)")}`,
    `Started At: ${String(payload["started_at"] ?? "(unknown)")}`,
    `Loaded At: ${String(payload["loaded_at"] ?? "(unknown)")}`,
    `Last Reload Status: ${String(payload["last_reload_status"] ?? "(unknown)")}`,
    `Last Reload Error: ${String(payload["last_reload_error"] ?? "(none)")}`,
    `Last Reload Attempted At: ${String(payload["last_reload_attempted_at"] ?? "(never)")}`,
    `Last Reload Succeeded At: ${String(payload["last_reload_succeeded_at"] ?? "(never)")}`,
    `Process Integrity Status: ${String(payload["process_integrity_status"] ?? "(unknown)")}`,
    `Last Fatal Error: ${String(payload["last_fatal_error"] ?? "(none)")}`,
    `Last Fatal At: ${String(payload["last_fatal_at"] ?? "(never)")}`,
    `Bind Host: ${String(payload["bind_host"] ?? "(unknown)")}`,
    `Allow Remote Bind: ${String(payload["allow_remote_bind"] ?? false)}`,
    `Allow Wildcard Bind: ${String(payload["allow_wildcard_bind"] ?? false)}`,
    `One Trusted Operator Boundary: ${String(payload["one_trusted_operator_boundary"] ?? false)}`,
    `Port: ${String(payload["port"] ?? "(unknown)")}`,
    `Max Connections: ${String(payload["max_connections"] ?? "(unknown)")}`,
    `Timeout Ms: ${String(payload["timeout_ms"] ?? "(unknown)")}`,
    `Stream Idle Timeout Ms: ${String(payload["stream_idle_timeout_ms"] ?? "(unknown)")}`,
    `Systemd Unit: ${String(payload["systemd_unit"] ?? "(unknown)")}`,
    `Observability Retention Older Than: ${String(retention?.["older_than"] ?? "(none)")}`,
    `Max Payload Size: ${String(payload["max_payload_size"] ?? "(unknown)")}`,
    `Models: ${String(payload["model_count"] ?? models.length)}`,
    `Providers: ${String(payload["provider_count"] ?? providers.length)}`,
    `Routes: ${String(payload["route_count"] ?? routes.length)}`
  ];

  if (models.length > 0) {
    lines.push("", "Models:");
    for (const model of models) {
      const view = isRecord(model) ? model : {};
      lines.push(
        `${String(view["name"] ?? "(unknown)")}  ${String(view["display_name"] ?? "(none)")}  creator=${String(view["model_creator"] ?? "(unknown)")}  routes=${String(view["route_count"] ?? 0)}`
      );
    }
  }

  if (providers.length > 0) {
    lines.push("", "Providers:");
    for (const provider of providers) {
      const view = isRecord(provider) ? provider : {};
      lines.push(
        `${String(view["name"] ?? "(unknown)")}  ${String(view["api_mode"] ?? "(unknown)")}  ${String(view["endpoint"] ?? "(none)")}  anthropic_version=${String(view["anthropic_version"] ?? "null")}  auth=${String(view["auth_source"] ?? "(unknown)")}  api_key_env=${String(view["api_key_env"] ?? "null")}  api_key=${String(view["api_key"] ?? "null")}`
      );
    }
  }

  if (routes.length > 0) {
    lines.push("", "Routes:");
    for (const route of routes) {
      const view = isRecord(route) ? route : {};
      lines.push(
        `${String(view["name"] ?? "(unknown)")}  ${String(view["display_name"] ?? "(none)")}  model=${String(view["model"] ?? "(unknown)")}  provider=${String(view["service_provider"] ?? "(unknown)")}  provider_model_id=${String(view["provider_model_id"] ?? "(unknown)")}  api_mode=${String(view["api_mode"] ?? "(unknown)")}`
      );
    }
  }

  return lines.join("\n");
}
