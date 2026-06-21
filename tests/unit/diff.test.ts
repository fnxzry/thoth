import { describe, expect, it } from "vitest";

import { unifiedDiff } from "../../src/diff.js";

describe("unifiedDiff", () => {
  it("returns the empty string for identical inputs", () => {
    expect(unifiedDiff("a\nb\nc", "a\nb\nc", "a", "b")).toBe("");
  });

  it("returns the empty string when both inputs are empty", () => {
    expect(unifiedDiff("", "", "a", "b")).toBe("");
  });

  it("includes the --- and +++ header lines on mismatch", () => {
    const out = unifiedDiff("a\n", "b\n", "left", "right");
    expect(out).toContain("--- left");
    expect(out).toContain("+++ right");
  });

  it("includes a @@ hunk header", () => {
    const out = unifiedDiff("a\n", "b\n", "left", "right");
    expect(out).toContain("@@");
  });

  it("marks removed lines with '-' and added lines with '+'", () => {
    const out = unifiedDiff("kept\nremoved\n", "kept\nadded\n", "left", "right");
    expect(out).toContain("-removed");
    expect(out).toContain("+added");
  });

  it("marks unchanged context lines with ' '", () => {
    const out = unifiedDiff("kept\nchanged\n", "kept\nchanged2\n", "left", "right");
    expect(out).toContain(" kept");
  });

  it("reports added lines that have no counterpart", () => {
    const out = unifiedDiff("", "new line\n", "left", "right");
    expect(out).toContain("+new line");
  });

  it("reports removed lines that have no counterpart", () => {
    const out = unifiedDiff("gone\n", "", "left", "right");
    expect(out).toContain("-gone");
  });

  it("produces a single hunk for a single change near the top", () => {
    const a = "a\nb\nc\nd\n";
    const b = "a\nB\nc\nd\n";
    const out = unifiedDiff(a, b, "left", "right");
    const hunkCount = (out.match(/^@@/gm) ?? []).length;
    expect(hunkCount).toBe(1);
  });

  it("produces multiple hunks when changes are far apart", () => {
    // Two actual changes (X→Y and A→B) separated by 20 unchanged lines so
    // they land in separate hunks with the default contextLines=3.
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    const a = lines.join("\n") + "\n" + "X" + "\n" + lines.join("\n") + "\n" + "A" + "\n";
    const b = lines.join("\n") + "\n" + "Y" + "\n" + lines.join("\n") + "\n" + "B" + "\n";
    const out = unifiedDiff(a, b, "left", "right");
    const hunkCount = (out.match(/^@@/gm) ?? []).length;
    expect(hunkCount).toBe(2);
  });

  it("merges changes that are within 2*contextLines of each other", () => {
    // Two changes (X→Y and A→B) 5 lines apart -- with contextLines=3
    // (so 2*3=6 apart) they should be merged into one hunk.
    const lines = Array.from({ length: 5 }, (_, i) => `line${i + 1}`);
    const a = lines.join("\n") + "\n" + "X" + "\n" + lines.join("\n") + "\n" + "A" + "\n";
    const b = lines.join("\n") + "\n" + "Y" + "\n" + lines.join("\n") + "\n" + "B" + "\n";
    const out = unifiedDiff(a, b, "left", "right", 3);
    const hunkCount = (out.match(/^@@/gm) ?? []).length;
    expect(hunkCount).toBe(1);
  });

  it("handles trailing-newline differences", () => {
    const out = unifiedDiff("a\n", "a", "left", "right");
    // a trailing newline removal is a one-line diff
    expect(out).toContain("--- left");
    expect(out).toContain("+++ right");
    expect(out).toContain("@@");
  });
});