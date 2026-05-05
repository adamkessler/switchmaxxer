type MaybePromise<T> = T | Promise<T>;

export type CliObservabilityHandleLifecycleDeps<THandle> = {
  resolveObservabilityStorePath: () => string;
  closeObservabilityServiceHandle: (handle: THandle | null) => void;
};

export async function withObservabilityHandle<THandle>(
  deps: CliObservabilityHandleLifecycleDeps<THandle>,
  options: {
    openHandle: (dbPath: string) => THandle | null;
    onError: (context: {
      error: unknown;
      dbPath: string;
    }) => MaybePromise<number>;
    onFinally?: () => MaybePromise<void>;
  },
  handler: (context: {
    dbPath: string;
    handle: THandle | null;
  }) => MaybePromise<number>
): Promise<number> {
  let handle: THandle | null = null;
  let dbPath = "";

  try {
    dbPath = deps.resolveObservabilityStorePath();
    handle = options.openHandle(dbPath);
    return await handler({ dbPath, handle });
  } catch (error) {
    return await options.onError({ error, dbPath });
  } finally {
    await options.onFinally?.();
    deps.closeObservabilityServiceHandle(handle);
  }
}

export function cliErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
