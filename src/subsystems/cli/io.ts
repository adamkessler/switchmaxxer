import { AsyncLocalStorage } from "node:async_hooks";
import { readSync } from "node:fs";

import { getRuntimeEnv } from "../../platform/env";

export type CliStdinReadOptions = {
  maxBytes?: number;
  logicalName?: string;
};

export type CliIo = {
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  stdin: {
    isTTY: boolean;
    readAllSync: (options?: CliStdinReadOptions) => string;
    readAll: (options?: CliStdinReadOptions) => Promise<string>;
  };
  env: NodeJS.ProcessEnv;
  cwd: () => string;
};

const cliIoStorage = new AsyncLocalStorage<CliIo>();
const STDIN_READ_CHUNK_BYTES = 64 * 1024;

function formatByteLimit(maxBytes: number): string {
  if (maxBytes >= 1024 * 1024 && maxBytes % (1024 * 1024) === 0) {
    return `${maxBytes / (1024 * 1024)} MB`;
  }

  if (maxBytes >= 1024 && maxBytes % 1024 === 0) {
    return `${maxBytes / 1024} KiB`;
  }

  return `${maxBytes} bytes`;
}

function assertNextStdinChunkWithinLimit(totalBytes: number, nextBytes: number, options: CliStdinReadOptions): number {
  const nextTotalBytes = totalBytes + nextBytes;

  if (typeof options.maxBytes === "number" && nextTotalBytes > options.maxBytes) {
    const logicalName = options.logicalName ?? "stdin";
    throw new Error(`${logicalName} exceeds the maximum supported size of ${formatByteLimit(options.maxBytes)}.`);
  }

  return nextTotalBytes;
}

function readAllStdinSync(options: CliStdinReadOptions = {}): string {
  const chunks: Buffer[] = [];
  const readBuffer = Buffer.allocUnsafe(STDIN_READ_CHUNK_BYTES);
  let totalBytes = 0;

  while (true) {
    const bytesRead = readSync(0, readBuffer, 0, readBuffer.length, null);

    if (bytesRead === 0) {
      break;
    }

    totalBytes = assertNextStdinChunkWithinLimit(totalBytes, bytesRead, options);
    chunks.push(Buffer.from(readBuffer.subarray(0, bytesRead)));
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

async function readAllStdin(options: CliStdinReadOptions = {}): Promise<string> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes = assertNextStdinChunkWithinLimit(totalBytes, buffer.byteLength, options);
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes).toString("utf8");
}

export function createDefaultCliIo(): CliIo {
  return {
    stdout: (message: string) => {
      process.stdout.write(message);
    },
    stderr: (message: string) => {
      process.stderr.write(message);
    },
    stdin: {
      isTTY: Boolean(process.stdin.isTTY),
      readAllSync: readAllStdinSync,
      readAll: readAllStdin
    },
    env: getRuntimeEnv(),
    cwd: () => process.cwd()
  };
}

export function getCliIo(): CliIo {
  return cliIoStorage.getStore() ?? createDefaultCliIo();
}

export function getCliEnv(): NodeJS.ProcessEnv {
  return getCliIo().env;
}

export function getCliCwd(): string {
  return getCliIo().cwd();
}

export async function runWithCliIo<T>(io: CliIo, fn: () => Promise<T>): Promise<T> {
  return await cliIoStorage.run(io, fn);
}
