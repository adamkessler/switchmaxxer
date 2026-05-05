import { isLoopbackHostname, isWildcardBindHostname } from "./net-utils";

export type GatewayBindPolicyInput = {
  sourceName: string;
  bindHost: string;
  inboundApiKeyEnv?: string | null;
  allowUnauthenticatedGateway?: boolean;
  allowRemoteBind?: boolean;
  allowWildcardBind?: boolean;
};

export function isGatewayRemoteBindEnabled(
  input: Pick<GatewayBindPolicyInput, "bindHost" | "allowRemoteBind">
): boolean {
  return input.allowRemoteBind === true && !isLoopbackHostname(input.bindHost);
}

export function assertGatewayBindPolicy(input: GatewayBindPolicyInput): void {
  const isLoopbackBind = isLoopbackHostname(input.bindHost);
  const isWildcardBind = isWildcardBindHostname(input.bindHost);

  if (input.allowUnauthenticatedGateway === true && !isLoopbackBind) {
    throw new Error(
      `${input.sourceName} must not set 'allow_unauthenticated_gateway: true' unless 'bind_host' stays on a loopback address like '127.0.0.1' or '::1'.`
    );
  }

  if (input.allowRemoteBind === true && input.inboundApiKeyEnv == null) {
    throw new Error(
      `${input.sourceName} field 'allow_remote_bind' requires 'inbound_api_key_env' and must not be used with unauthenticated gateway mode.`
    );
  }

  if (input.allowWildcardBind === true && !isWildcardBind) {
    throw new Error(
      `${input.sourceName} field 'allow_wildcard_bind' only applies when 'bind_host' is '0.0.0.0' or '::'.`
    );
  }

  if (isWildcardBind && (input.allowRemoteBind !== true || input.allowWildcardBind !== true)) {
    throw new Error(
      `${input.sourceName} must not set wildcard 'bind_host' unless 'allow_remote_bind: true' and 'allow_wildcard_bind: true' are explicitly configured with 'inbound_api_key_env'.`
    );
  }

  if (!isLoopbackBind && input.allowRemoteBind !== true) {
    throw new Error(
      `${input.sourceName} must not set non-loopback 'bind_host' unless 'allow_remote_bind: true' is explicitly configured with 'inbound_api_key_env'.`
    );
  }
}
