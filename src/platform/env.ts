import { parseCanonicalNonNegativeInteger, parseCanonicalPositiveInteger } from "./number-parsing";

export type RuntimeEnv = NodeJS.ProcessEnv;

export function getRuntimeEnv(env?: RuntimeEnv): RuntimeEnv {
  return env ?? process.env;
}

export function getEnvValue(name: string, env: RuntimeEnv = process.env): string | undefined {
  return env[name];
}

export function getNonEmptyEnvValue(name: string, env: RuntimeEnv = process.env): string | null {
  const value = getEnvValue(name, env);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function isEnvFlagEnabled(name: string, env: RuntimeEnv = process.env): boolean {
  return getEnvValue(name, env) === "1";
}

export function parsePositiveIntegerEnv(name: string, env: RuntimeEnv = process.env): number | null {
  const raw = getNonEmptyEnvValue(name, env);
  return raw === null ? null : parseCanonicalPositiveInteger(raw);
}

export function parseNonNegativeIntegerEnv(name: string, env: RuntimeEnv = process.env): number | null {
  const raw = getNonEmptyEnvValue(name, env);
  return raw === null ? null : parseCanonicalNonNegativeInteger(raw);
}

export function resolvePositiveIntegerEnv(name: string, fallback: number, env: RuntimeEnv = process.env): number {
  return parsePositiveIntegerEnv(name, env) ?? fallback;
}

export function resolveNonNegativeIntegerEnv(name: string, fallback: number, env: RuntimeEnv = process.env): number {
  return parseNonNegativeIntegerEnv(name, env) ?? fallback;
}
