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
      gatewayRoot: path.join(repoRoot, "src", "subsystems", "gateway"),
      proxyRoot: path.join(repoRoot, "src", "subsystems", "proxy")
    },
    docs: {
      errorCodesReference: path.join(repoRoot, "docs", "contracts", "error-codes-reference.md")
    }
  };
}

module.exports = {
  getContractSourcePaths
};
