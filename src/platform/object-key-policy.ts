const RESERVED_OBJECT_KEYS = new Set([...Object.getOwnPropertyNames(Object.prototype), "prototype"]);

export function isReservedObjectKey(value: string): boolean {
  return RESERVED_OBJECT_KEYS.has(value.trim());
}

export function assertSafeObjectKey(value: string, label: string): void {
  if (isReservedObjectKey(value)) {
    throw new Error(`${label} '${value}' is reserved and cannot be used.`);
  }
}

export function assertNoReservedObjectKeysDeep(value: unknown, label: string): void {
  const seen = new WeakSet<object>();

  function visit(candidate: unknown, path: string): void {
    if (candidate === null || typeof candidate !== "object") {
      return;
    }

    if (seen.has(candidate)) {
      return;
    }
    seen.add(candidate);

    if (Array.isArray(candidate)) {
      for (let index = 0; index < candidate.length; index += 1) {
        visit(candidate[index], `${path}[${index}]`);
      }
      return;
    }

    for (const [key, child] of Object.entries(candidate)) {
      const childPath = `${path}.${key}`;
      if (isReservedObjectKey(key)) {
        throw new Error(`${label} field '${childPath}' uses reserved object key '${key}'.`);
      }

      visit(child, childPath);
    }
  }

  visit(value, "$");
}

export function createStringKeyRecord<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

export function setSafeObjectKey<T>(
  record: Record<string, T>,
  key: string,
  value: T,
  label: string
): void {
  assertSafeObjectKey(key, label);
  record[key] = value;
}

export function shallowCloneRecordWithSafeKeys<T>(
  record: Record<string, T>,
  label: string
): Record<string, T> {
  const clone = createStringKeyRecord<T>();

  for (const [key, value] of Object.entries(record)) {
    setSafeObjectKey(clone, key, value, label);
  }

  return clone;
}
