export interface RunTasksWithConcurrencyOptions {
  signal?: AbortSignal;
}

function errorFromAbortSignal(signal: AbortSignal): Error {
  const reason = signal.reason;

  if (reason instanceof Error && reason.name.endsWith("CancelledError")) {
    return reason;
  }

  if (reason instanceof Error && /cancel/i.test(reason.message)) {
    return reason;
  }

  if (reason instanceof Error) {
    return new Error(`Task execution cancelled: ${reason.message}`);
  }

  if (typeof reason === "string" && reason.trim().length > 0) {
    return new Error(`Task execution cancelled: ${reason}`);
  }

  return new Error("Task execution cancelled");
}

export async function runTasksWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number,
  options: RunTasksWithConcurrencyOptions = {}
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;
  const signal = options.signal;

  const worker = async (): Promise<void> => {
    while (nextIndex < tasks.length) {
      if (signal?.aborted) {
        return;
      }

      const currentIndex = nextIndex;
      nextIndex += 1;
      const task = tasks[currentIndex];
      if (typeof task === "undefined") {
        return;
      }
      results[currentIndex] = await task();
    }
  };

  const workerCount = Math.max(1, Math.min(concurrency, tasks.length || 1));
  const settled = await Promise.allSettled(Array.from({ length: workerCount }, () => worker()));

  if (signal?.aborted) {
    throw errorFromAbortSignal(signal);
  }

  const rejection = settled.find(
    (result): result is PromiseRejectedResult => result.status === "rejected"
  );
  if (rejection) {
    throw rejection.reason;
  }

  return results;
}
