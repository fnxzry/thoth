import { DirectiveImpl } from "../types.js";

export class DirectiveRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectiveRegistryError";
  }
}

interface RegistryEntry {
  impl: DirectiveImpl;
  primaryKey: string | null;
}

const registry = new Map<string, RegistryEntry>();

export function register(name: string, primaryKey: string | null, impl: DirectiveImpl): void {
  if (registry.has(name)) {
    throw new DirectiveRegistryError(`Directive @${name} is already registered`);
  }
  registry.set(name, { impl, primaryKey });
}

export function get(name: string): Registration {
  const entry = registry.get(name);
  if (!entry) {
    throw new DirectiveRegistryError(`Unknown directive @${name}`);
  }
  return entry;
}

export interface Registration {
  impl: DirectiveImpl;
  primaryKey: string | null;
}

export function has(name: string): boolean {
  return registry.has(name);
}

export function clear(): void {
  registry.clear();
}