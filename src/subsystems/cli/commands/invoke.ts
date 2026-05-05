import { buildRegisteredFamilyHelpText } from "../registry";

export function createInvokeCli(deps: {
  runHelpAwareCommand: (
    argv: string[],
    options: {
      help: () => void;
      run: (args: string[]) => Promise<number>;
      helpOnEmpty?: boolean;
    }
  ) => Promise<number | undefined>;
  runInvoke: (argv: string[]) => Promise<number>;
  writeStdout: (message: string) => void;
}): {
  getHelpText: () => string;
  printHelp: () => void;
  runInvokeCommand: (argv: string[]) => Promise<number | undefined>;
} {
  function getHelpText(): string {
    return buildRegisteredFamilyHelpText({
      title: "switchmaxxer invoke",
      description:
        "Sends a one-off request through the local Switchmaxxer gateway, exercising the real listener and routing path on the configured port.",
      commands: [],
      usageLines: [
        "switchmaxxer invoke --route <route-id> [--api <openai|anthropic|auto>] [--prompt <text>|--stdin|--file <path>] [--system <text>] [--stream] [--inspect [--include-secrets]] [--temperature <number>] [--max-tokens <number>] [--timeout-ms <number>] [--config <path>] [--json]"
      ],
      flags: [
        "--route <route-id>         Target route ID",
        "--api <mode>           Request surface to use: openai, anthropic, or auto",
        "--prompt <text>        Prompt text for the user message",
        "--system <text>        Optional system message",
        "--file <path>          Read prompt text from a file",
        "--stdin                Read prompt text from stdin",
        "--stream               Request streaming output",
        "--inspect              Show the ephemeral four-hop request/response inspection view",
        "--include-secrets      With --inspect, include local secret-bearing headers; requires SWITCHMAXXER_ALLOW_INSPECT_SECRETS=1",
        "--temperature <n>      Set temperature on the outbound request",
        "--max-tokens <n>       Set max tokens / max_completion_tokens",
        "--config <path>        Read gateway port and route metadata from the specified config file",
        "--json                 Emit a simple JSON envelope for non-streaming invocations"
      ],
      exampleLines: [
        "switchmaxxer invoke --route gpt-4o-mini --prompt \"hello\"",
        "switchmaxxer invoke --route gpt-4o-mini --prompt \"hello\" --inspect",
        "switchmaxxer invoke --route gpt-4o-mini --stdin",
        "switchmaxxer invoke --route claude-sonnet-4-6 --api anthropic --prompt \"hello\"",
        "switchmaxxer invoke --route gpt-4o-mini --prompt \"hello\" --stream"
      ],
      docsPath: "docs/subsystems/cli/tech-spec-for-tools.md",
      proTip: "smx invoke is the official short operator alias form."
    });
  }

  function printHelp(): void {
    deps.writeStdout(getHelpText());
  }

  async function runInvokeCommand(argv: string[]): Promise<number | undefined> {
    return await deps.runHelpAwareCommand(argv, {
      help: printHelp,
      run: async (leafArgs) => await deps.runInvoke(leafArgs)
    });
  }

  return {
    getHelpText,
    printHelp,
    runInvokeCommand
  };
}
