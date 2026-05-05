import http from "node:http";
import type net from "node:net";

export interface TrackedTimeoutRegistry {
  schedule: (callback: () => void, delayMs: number) => NodeJS.Timeout;
  clearAll: () => void;
}

function waitForServerListen(server: http.Server): Promise<net.AddressInfo> {
  return new Promise<net.AddressInfo>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();

      if (!address || typeof address === "string") {
        reject(new Error("Expected a TCP address for test server."));
        return;
      }

      resolve(address);
    });
  });
}

export function createTrackedTimeoutRegistry(): TrackedTimeoutRegistry {
  const timeouts = new Set<NodeJS.Timeout>();

  return {
    schedule: (callback, delayMs) => {
      const timeout = setTimeout(() => {
        timeouts.delete(timeout);
        callback();
      }, delayMs);
      timeouts.add(timeout);
      return timeout;
    },
    clearAll: () => {
      for (const timeout of timeouts) {
        clearTimeout(timeout);
      }
      timeouts.clear();
    }
  };
}

export function createManagedTestServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse, timers: TrackedTimeoutRegistry) => void
): {
  listen: () => Promise<net.AddressInfo>;
  close: () => Promise<void>;
} {
  const timers = createTrackedTimeoutRegistry();
  const sockets = new Set<net.Socket>();
  const server = http.createServer((request, response) => {
    handler(request, response, timers);
  });
  let listening = false;

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  return {
    listen: async () => {
      const address = await waitForServerListen(server);
      listening = true;
      server.once("close", () => {
        listening = false;
      });
      return address;
    },
    close: async () => {
      timers.clearAll();

      for (const socket of sockets) {
        socket.destroy();
      }

      if (!listening) {
        return;
      }

      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code === "ERR_SERVER_NOT_RUNNING") {
            resolve();
            return;
          }

          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}
