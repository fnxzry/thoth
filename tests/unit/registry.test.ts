import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  register,
  get,
  has,
  clear,
  DirectiveRegistryError,
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
    register("reg-foo", impl);
    expect(has("reg-foo")).toBe(true);
    expect(get("reg-foo")).toBe(impl);
  });

  it("throws on duplicate registration", () => {
    const impl: DirectiveImpl = async () => ({ text: "a" });
    register("reg-dup", impl);
    expect(() => register("reg-dup", impl)).toThrowError(DirectiveRegistryError);
  });

  it("throws on unknown directive lookup", () => {
    expect(() => get("reg-nope")).toThrowError(DirectiveRegistryError);
  });

  it("returns false from has() for unregistered directives", () => {
    expect(has("reg-nope")).toBe(false);
  });

  it("clears all registered directives", () => {
    register("reg-clear-a", async () => ({ text: "" }));
    register("reg-clear-b", async () => ({ text: "" }));
    clear();
    expect(has("reg-clear-a")).toBe(false);
    expect(has("reg-clear-b")).toBe(false);
  });
});