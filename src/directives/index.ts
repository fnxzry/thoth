import { DirectiveImpl } from "../types.js";

export class DirectiveRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DirectiveRegistryError";
  }
}

const registry = new Map<string, DirectiveImpl>();

export function register(name: string, impl: DirectiveImpl): void {
  if (registry.has(name)) {
    throw new DirectiveRegistryError(`Directive @${name} is already registered`);
  }
  registry.set(name, impl);
}

export function get(name: string): DirectiveImpl {
  const impl = registry.get(name);
  if (!impl) {
    throw new DirectiveRegistryError(`Unknown directive @${name}`);
  }
  return impl;
}

export function has(name: string): boolean {
  return registry.has(name);
}

export function clear(): void {
  registry.clear();
}