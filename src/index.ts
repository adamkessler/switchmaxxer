import { createDefaultCliIo } from "./subsystems/cli/io";
import { logLine, safeErrorMessage } from "./platform/logger";
import { createSwitchmaxxerApp } from "./app-cli";

export { createSwitchmaxxerApp, run, runCli, type SwitchmaxxerApp } from "./app-cli";
export type { CliIo } from "./app-cli";

async function main(): Promise<void> {
  const app = createSwitchmaxxerApp({
    io: createDefaultCliIo()
  });
  process.exitCode = await app.run(process.argv.slice(2));
}

if (require.main === module) {
  void main().catch((error: Error) => {
    logLine(`x ERROR     model=startup  reason="${safeErrorMessage(error, 512)}"  status=1`);
    process.exit(1);
  });
}
