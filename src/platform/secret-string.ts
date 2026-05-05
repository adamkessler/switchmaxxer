import util from "node:util";

export const REDACTED_SECRET = "***redacted***";

export class SecretString {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  toString(): string {
    return REDACTED_SECRET;
  }

  toJSON(): string {
    return REDACTED_SECRET;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED_SECRET;
  }

  [util.inspect.custom](): string {
    return REDACTED_SECRET;
  }
}
