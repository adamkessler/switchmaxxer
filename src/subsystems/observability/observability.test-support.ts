import baseTest from "node:test";

export const test: typeof baseTest = ((name, optionsOrFn, maybeFn) => {
  if (typeof optionsOrFn === "function") {
    return baseTest(name, { concurrency: false }, optionsOrFn);
  }

  return baseTest(name, { ...optionsOrFn, concurrency: false }, maybeFn!);
}) as typeof baseTest;
