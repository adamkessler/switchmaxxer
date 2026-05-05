import { resetGatewayHealthProbeMetrics } from "./health-probe-metrics";

export function resetGatewayHealthProbeMetricsForTests(): void {
  resetGatewayHealthProbeMetrics();
}
