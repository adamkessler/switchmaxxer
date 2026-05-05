export type RuntimeRoute =
  | {
      kind: "health";
      trustClass: "health_probe";
    }
  | {
      kind: "data_plane";
      trustClass: "data_plane";
      isAnthropicPath: boolean;
    }
  | {
      kind: "runtime_config";
      trustClass: "control_plane_read";
    }
  | {
      kind: "runtime_inspect";
      trustClass: "control_plane_read";
      inspectId: string;
    }
  | {
      kind: "unknown_runtime_control_plane";
      trustClass: "control_plane_read";
    }
  | {
      kind: "not_found";
      trustClass: "unknown";
    };

const RUNTIME_INSPECT_PATH_PATTERN = /^\/__switchmaxxer\/runtime\/inspect\/([^/]+)$/;

export function classifyRuntimeRoute(method: string, pathname: string): RuntimeRoute {
  if (method === "GET" && pathname === "/health") {
    return {
      kind: "health",
      trustClass: "health_probe"
    };
  }

  if (method === "POST" && pathname === "/v1/chat/completions") {
    return {
      kind: "data_plane",
      trustClass: "data_plane",
      isAnthropicPath: false
    };
  }

  if (method === "POST" && pathname === "/anthropic/v1/messages") {
    return {
      kind: "data_plane",
      trustClass: "data_plane",
      isAnthropicPath: true
    };
  }

  if (method === "GET" && pathname === "/__switchmaxxer/runtime/config") {
    return {
      kind: "runtime_config",
      trustClass: "control_plane_read"
    };
  }

  const inspectId = parseRuntimeInspectRequestPath(method, pathname);
  if (inspectId !== null) {
    return {
      kind: "runtime_inspect",
      trustClass: "control_plane_read",
      inspectId
    };
  }

  if (method === "GET" && pathname.startsWith("/__switchmaxxer/runtime/")) {
    return {
      kind: "unknown_runtime_control_plane",
      trustClass: "control_plane_read"
    };
  }

  return {
    kind: "not_found",
    trustClass: "unknown"
  };
}

function parseRuntimeInspectRequestPath(method: string, pathname: string): string | null {
  if (method !== "GET") {
    return null;
  }

  const match = pathname.match(RUNTIME_INSPECT_PATH_PATTERN);
  return match?.[1] ?? null;
}

export function requiresUnauthenticatedLocalClientGate(route: RuntimeRoute): boolean {
  return route.kind === "data_plane" || route.trustClass === "control_plane_read";
}

export function requiresCallerRateLimit(route: RuntimeRoute): boolean {
  return route.kind === "data_plane" || route.kind === "runtime_config" || route.kind === "runtime_inspect";
}
