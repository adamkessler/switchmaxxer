import { AsyncLocalStorage } from "node:async_hooks";

export type CliUsageContext = {
  command: string;
  json: boolean;
};

const cliUsageContextStorage = new AsyncLocalStorage<CliUsageContext>();

export function getCliUsageContext(): CliUsageContext | undefined {
  return cliUsageContextStorage.getStore();
}

export async function runWithCliUsageContext<T>(
  context: CliUsageContext,
  fn: () => Promise<T>
): Promise<T> {
  return await cliUsageContextStorage.run(context, fn);
}
