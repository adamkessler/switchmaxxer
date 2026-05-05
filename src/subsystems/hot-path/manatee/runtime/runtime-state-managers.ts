export type GatewaySlotRelease = () => void;

export class JsonParseConcurrencyManager {
  #activeRequests = 0;

  tryAcquire(maxConcurrentJsonParses: number): GatewaySlotRelease | null {
    if (this.#activeRequests >= maxConcurrentJsonParses) {
      return null;
    }

    this.#activeRequests += 1;
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      this.#activeRequests = Math.max(0, this.#activeRequests - 1);
    };
  }

  getActiveRequestCount(): number {
    return this.#activeRequests;
  }
}

export class StreamingRequestConcurrencyManager {
  #activeRequestsBySourceIp = new Map<string, number>();

  tryAcquire(sourceIp: string, maxConcurrentStreamsPerIp: number): GatewaySlotRelease | null {
    const current = this.#activeRequestsBySourceIp.get(sourceIp) ?? 0;

    if (current >= maxConcurrentStreamsPerIp) {
      return null;
    }

    this.#activeRequestsBySourceIp.set(sourceIp, current + 1);
    let released = false;

    return () => {
      if (released) {
        return;
      }

      released = true;
      const active = this.#activeRequestsBySourceIp.get(sourceIp) ?? 0;

      if (active <= 1) {
        this.#activeRequestsBySourceIp.delete(sourceIp);
        return;
      }

      this.#activeRequestsBySourceIp.set(sourceIp, active - 1);
    };
  }

  getActiveRequestCountForSourceIp(sourceIp: string): number {
    return this.#activeRequestsBySourceIp.get(sourceIp) ?? 0;
  }

  getTrackedSourceIpCount(): number {
    return this.#activeRequestsBySourceIp.size;
  }
}
