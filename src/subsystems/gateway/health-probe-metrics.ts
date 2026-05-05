export type GatewayHealthProbeMetricsSnapshot = {
  total_requests: number;
  allowed_requests: number;
  rate_limited_requests: number;
  last_seen_at: string | null;
};

const gatewayHealthProbeMetrics: GatewayHealthProbeMetricsSnapshot = {
  total_requests: 0,
  allowed_requests: 0,
  rate_limited_requests: 0,
  last_seen_at: null
};

export function recordGatewayHealthProbe(options: { rateLimited: boolean; observedAt?: Date }): void {
  gatewayHealthProbeMetrics.total_requests += 1;

  if (options.rateLimited) {
    gatewayHealthProbeMetrics.rate_limited_requests += 1;
  } else {
    gatewayHealthProbeMetrics.allowed_requests += 1;
  }

  gatewayHealthProbeMetrics.last_seen_at = (options.observedAt ?? new Date()).toISOString();
}

export function getGatewayHealthProbeMetricsSnapshot(): GatewayHealthProbeMetricsSnapshot {
  return {
    total_requests: gatewayHealthProbeMetrics.total_requests,
    allowed_requests: gatewayHealthProbeMetrics.allowed_requests,
    rate_limited_requests: gatewayHealthProbeMetrics.rate_limited_requests,
    last_seen_at: gatewayHealthProbeMetrics.last_seen_at
  };
}

export function resetGatewayHealthProbeMetrics(): void {
  gatewayHealthProbeMetrics.total_requests = 0;
  gatewayHealthProbeMetrics.allowed_requests = 0;
  gatewayHealthProbeMetrics.rate_limited_requests = 0;
  gatewayHealthProbeMetrics.last_seen_at = null;
}
