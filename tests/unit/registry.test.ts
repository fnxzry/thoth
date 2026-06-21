import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  register,
  get,
  has,
  clear,
  DirectiveRegistryError,
  Registration,
} from "../../src/directives/index.js";
import { DirectiveImpl } from "../../src/types.js";

describe("directive registry", () => {
  beforeEach(() => {
    clear();
  });

  afterEach(() => {
    clear();
  });

  it("registers and retrieves a directive", () => {
    const impl: DirectiveImpl = async () => ({ text: "result" });
    register("reg-foo", "param", impl);
    expect(has("reg-foo")).toBe(true);
    const reg: Registration = get("reg-foo");
    expect(reg.impl).toBe(impl);
    expect(reg.primaryKey).toBe("param");
  });

  it("throws on duplicate registration", () => {
    const impl: DirectiveImpl = async () => ({ text: "a" });
    register("reg-dup", null, impl);
    expect(() => register("reg-dup", null, impl)).toThrowError(DirectiveRegistryError);
  });

  it("throws on unknown directive lookup", () => {
    expect(() => get("reg-nope")).toThrowError(DirectiveRegistryError);
  });

  it("returns false from has() for unregistered directives", () => {
    expect(has("reg-nope")).toBe(false);
  });

  it("clears all registered directives", () => {
    register("reg-clear-a", null, async () => ({ text: "" }));
    register("reg-clear-b", null, async () => ({ text: "" }));
    clear();
    expect(has("reg-clear-a")).toBe(false);
    expect(has("reg-clear-b")).toBe(false);
  });

  it("supports null primaryKey for directives without a primary parameter", () => {
    const impl: DirectiveImpl = async () => ({ text: "ok" });
    register("no-primary", null, impl);
    const reg = get("no-primary");
    expect(reg.primaryKey).toBeNull();
  });
});