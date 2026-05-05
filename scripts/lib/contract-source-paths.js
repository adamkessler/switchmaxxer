const path = require("node:path");

function getRepoRoot() {
  return path.resolve(__dirname, "..", "..");
}

function getContractSourcePaths() {
  const repoRoot = getRepoRoot();

  return {
    repoRoot,
    platform: {
      responseEnvelope: path.join(repoRoot, "src", "platform", "response-envelope.ts"),
      errorCodes: path.join(repoRoot, "src", "platform", "error-codes.ts")
    },
    subsystems: {
      configMetadata: path.join(repoRoot, "src", "subsystems", "config", "config-metadata.ts"),
      // gatewayRoot and proxyRoot point at the hot-path slices. The original
      // src/subsystems/gateway directory still holds cold-path code (CLI
      // commands, journalctl helpers, gateway-runner, etc.); the per-request
      // hot path now lives under src/subsystems/hot-path/manatee/. Contract
      // checks walk the hot-path locations because that is where error-code
      // references and request-handling logic live.
      gatewayRoot: path.join(repoRoot, "src", "subsystems", "hot-path", "manatee", "runtime"),
      proxyRoot: path.join(repoRoot, "src", "subsystems", "hot-path", "manatee", "proxy")
    },
    docs: {
      errorCodesReference: path.join(repoRoot, "docs", "contracts", "error-codes-reference.md")
    }
  };
}

module.exports = {
  getContractSourcePaths
};
