import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs, run, usage } from "../../src/cli.js";

class StringWritable extends Writable {
  chunks: string[] = [];

  override _write(
    chunk: Buffer | string,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    this.chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
    callback();
  }

  get text(): string {
    return this.chunks.join("");
  }
}

interface Harness {
  stdout: StringWritable;
  stderr: StringWritable;
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  getPackageVersion: () => string;
}

function makeHarness(version = "9.9.9"): Harness {
  const stdout = new StringWritable();
  const stderr = new StringWritable();
  return {
    stdout,
    stderr,
    readFile: vi.fn(),
    writeFile: vi.fn(),
    getPackageVersion: () => version,
  };
}

describe("usage", () => {
  it("includes every CLI grammar flag", () => {
    const text = usage();
    for (const flag of [
      "--help",
      "--version",
      "--config",
      "--check",
      "--output",
      "--cache-dir",
      "--no-cache",
      "<input.md>",
    ]) {
      expect(text).toContain(flag);
    }
  });

  it("documents the exit codes", () => {
    const text = usage();
    expect(text).toContain("0");
    expect(text).toContain("1");
    expect(text).toContain("2");
    expect(text).toContain("3");
  });
});

describe("parseArgs", () => {
  it("parses an empty argv", () => {
    const result = parseArgs([]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.input).toBeUndefined();
      expect(result.args.help).toBe(false);
      expect(result.args.version).toBe(false);
      expect(result.args.check).toBe(false);
      expect(result.args.noCache).toBe(false);
    }
  });

  it("captures a positional input file", () => {
    const result = parseArgs(["input.md"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.input).toBe("input.md");
    }
  });

  it("parses --help", () => {
    const result = parseArgs(["--help"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.help).toBe(true);
  });

  it("parses --version", () => {
    const result = parseArgs(["--version"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.version).toBe(true);
  });

  it("parses --check", () => {
    const result = parseArgs(["--check", "input.md"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.check).toBe(true);
  });

  it("parses --no-cache", () => {
    const result = parseArgs(["--no-cache", "input.md"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.noCache).toBe(true);
  });

  it("parses --config with a value", () => {
    const result = parseArgs(["--config", "cfg.json", "input.md"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.config).toBe("cfg.json");
  });

  it("parses --output with a value", () => {
    const result = parseArgs(["--output", "out.md", "input.md"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.output).toBe("out.md");
  });

  it("parses --cache-dir with a value", () => {
    const result = parseArgs(["--cache-dir", ".cache", "input.md"]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.args.cacheDir).toBe(".cache");
  });

  it("parses all flags together in any order", () => {
    const result = parseArgs([
      "--no-cache",
      "--check",
      "--cache-dir",
      ".doc-cache",
      "--config",
      "cfg.json",
      "--output",
      "out.md",
      "input.md",
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.noCache).toBe(true);
      expect(result.args.check).toBe(true);
      expect(result.args.cacheDir).toBe(".doc-cache");
      expect(result.args.config).toBe("cfg.json");
      expect(result.args.output).toBe("out.md");
      expect(result.args.input).toBe("input.md");
    }
  });

  it("rejects an unknown flag", () => {
    const result = parseArgs(["--bogus"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--bogus");
  });

  it("rejects --config without a value", () => {
    const result = parseArgs(["--config"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--config");
  });

  it("rejects --output without a value", () => {
    const result = parseArgs(["input.md", "--output"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--output");
  });

  it("rejects --cache-dir without a value", () => {
    const result = parseArgs(["--cache-dir"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("--cache-dir");
  });

  it("rejects more than one positional argument", () => {
    const result = parseArgs(["a.md", "b.md"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("unexpected positional");
  });
});

describe("run", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-cli-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function file(name: string, contents: string): string {
    const p = join(tmpDir, name);
    writeFileSync(p, contents, "utf8");
    return p;
  }

  it("writes the file's contents to stdout and exits 0", async () => {
    const input = file("input.md", "hello world\n");
    const harness = makeHarness();
    harness.readFile.mockResolvedValue("hello world\n");

    const code = await run([input], harness);

    expect(code).toBe(0);
    expect(harness.readFile).toHaveBeenCalledWith(input);
    expect(harness.stdout.text).toBe("hello world\n");
    expect(harness.stderr.text).toBe("");
    expect(harness.writeFile).not.toHaveBeenCalled();
  });

  it("writes to --output instead of stdout", async () => {
    const input = file("input.md", "rendered text");
    const output = join(tmpDir, "out.md");
    const harness = makeHarness();
    harness.readFile.mockResolvedValue("rendered text");
    harness.writeFile.mockResolvedValue(undefined);

    const code = await run(["--output", output, input], harness);

    expect(code).toBe(0);
    expect(harness.writeFile).toHaveBeenCalledWith(output, "rendered text");
    expect(harness.stdout.text).toBe("");
  });

  it("exits 2 and prints usage to stderr with no args", async () => {
    const harness = makeHarness();
    const code = await run([], harness);
    expect(code).toBe(2);
    expect(harness.stderr.text).toContain("error:");
    expect(harness.stderr.text).toContain("Usage: thoth");
    expect(harness.stdout.text).toBe("");
  });

  it("exits 0 and prints usage to stdout for --help", async () => {
    const harness = makeHarness();
    const code = await run(["--help"], harness);
    expect(code).toBe(0);
    expect(harness.stdout.text).toContain("Usage: thoth");
    expect(harness.stderr.text).toBe("");
  });

  it("exits 0 and prints version to stdout for --version", async () => {
    const harness = makeHarness("1.2.3-test");
    const code = await run(["--version"], harness);
    expect(code).toBe(0);
    expect(harness.stdout.text).toBe("1.2.3-test\n");
    expect(harness.stderr.text).toBe("");
  });

  it("exits 2 with a stderr message that names the missing file", async () => {
    const harness = makeHarness();
    const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    harness.readFile.mockRejectedValue(err);

    const missing = join(tmpDir, "does-not-exist.md");
    const code = await run([missing], harness);

    expect(code).toBe(2);
    expect(harness.stderr.text).toContain(missing);
    expect(harness.stderr.text).toContain("no such file");
    expect(harness.stdout.text).toBe("");
  });

  it("exits 2 with a stderr message that names the path on EACCES", async () => {
    const harness = makeHarness();
    const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
    harness.readFile.mockRejectedValue(err);

    const protectedPath = join(tmpDir, "locked.md");
    const code = await run([protectedPath], harness);

    expect(code).toBe(2);
    expect(harness.stderr.text).toContain(protectedPath);
    expect(harness.stderr.text).toContain("permission denied");
  });

  it("exits 1 for unexpected I/O errors", async () => {
    const harness = makeHarness();
    const err = Object.assign(new Error("disk on fire"), { code: "EIO" });
    harness.readFile.mockRejectedValue(err);

    const input = join(tmpDir, "input.md");
    const code = await run([input], harness);

    expect(code).toBe(1);
    expect(harness.stderr.text).toContain(input);
    expect(harness.stderr.text).toContain("disk on fire");
  });

  it("exits 2 with an unknown-flag error", async () => {
    const harness = makeHarness();
    const code = await run(["--not-a-flag"], harness);
    expect(code).toBe(2);
    expect(harness.stderr.text).toContain("--not-a-flag");
    expect(harness.stderr.text).toContain("Usage: thoth");
    expect(harness.stdout.text).toBe("");
  });

  it("exits 2 when a value-requiring flag has no value", async () => {
    const harness = makeHarness();
    const code = await run(["--config"], harness);
    expect(code).toBe(2);
    expect(harness.stderr.text).toContain("--config");
  });

  it("accepts --check without using it", async () => {
    const input = file("input.md", "data");
    const harness = makeHarness();
    harness.readFile.mockResolvedValue("data");

    const code = await run(["--check", input], harness);
    expect(code).toBe(0);
    expect(harness.stdout.text).toBe("data");
  });

  it("accepts --no-cache without using it", async () => {
    const input = file("input.md", "data");
    const harness = makeHarness();
    harness.readFile.mockResolvedValue("data");

    const code = await run(["--no-cache", input], harness);
    expect(code).toBe(0);
    expect(harness.stdout.text).toBe("data");
  });

  it("accepts --cache-dir without using it", async () => {
    const input = file("input.md", "data");
    const harness = makeHarness();
    harness.readFile.mockResolvedValue("data");

    const code = await run(["--cache-dir", join(tmpDir, "alt-cache"), input], harness);
    expect(code).toBe(0);
    expect(harness.stdout.text).toBe("data");
  });

  it("accepts --config without using it", async () => {
    const input = file("input.md", "data");
    const cfg = join(tmpDir, "cfg.json");
    const harness = makeHarness();
    harness.readFile.mockResolvedValue("data");

    const code = await run(["--config", cfg, input], harness);
    expect(code).toBe(0);
    expect(harness.stdout.text).toBe("data");
  });

  it("exits 2 with an output-write EACCES error naming the output path", async () => {
    const input = file("input.md", "data");
    const output = join(tmpDir, "out.md");
    const harness = makeHarness();
    harness.readFile.mockResolvedValue("data");
    const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
    harness.writeFile.mockRejectedValue(err);

    const code = await run(["--output", output, input], harness);

    expect(code).toBe(2);
    expect(harness.stderr.text).toContain(output);
    expect(harness.stderr.text).toContain("permission denied");
  });

  it("integrates with the real filesystem when no overrides are provided", async () => {
    const input = join(tmpDir, "real-input.md");
    writeFileSync(input, "real content\n", "utf8");

    const code = await run([input], {
      stdout: new StringWritable() as unknown as NodeJS.WritableStream,
      stderr: new StringWritable() as unknown as NodeJS.WritableStream,
    });

    expect(code).toBe(0);
  });
});

describe("filesystem integration (real disk, controlled permissions)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-cli-fs-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports a real ENOENT with the requested path", async () => {
    const stdout = new StringWritable();
    const stderr = new StringWritable();
    const missing = join(tmpDir, "missing.md");

    const code = await run([missing], {
      stdout: stdout as unknown as NodeJS.WritableStream,
      stderr: stderr as unknown as NodeJS.WritableStream,
    });

    expect(code).toBe(2);
    expect(stderr.text).toContain(missing);
    expect(stderr.text).toContain("no such file");
  });

  it("writes to --output and reads it back identically", async () => {
    const input = join(tmpDir, "in.md");
    const output = join(tmpDir, "out.md");
    writeFileSync(input, "round-trip content", "utf8");

    const stdout = new StringWritable();
    const stderr = new StringWritable();

    const code = await run(["--output", output, input], {
      stdout: stdout as unknown as NodeJS.WritableStream,
      stderr: stderr as unknown as NodeJS.WritableStream,
    });

    expect(code).toBe(0);
    expect(stdout.text).toBe("");
    expect(stderr.text).toBe("");
    expect(readFileSync(output, "utf8")).toBe("round-trip content");
  });

  it("reports EACCES when the input file is unreadable", async () => {
    if (process.platform === "win32") return;
    if (typeof process.getuid === "function" && process.getuid() === 0) return;
    const input = join(tmpDir, "locked.md");
    writeFileSync(input, "secret", "utf8");
    chmodSync(input, 0o000);
    try {
      if ((statSync(input).mode & 0o777) === 0o000) {
        const stdout = new StringWritable();
        const stderr = new StringWritable();

        const code = await run([input], {
          stdout: stdout as unknown as NodeJS.WritableStream,
          stderr: stderr as unknown as NodeJS.WritableStream,
        });

        expect(code).toBe(2);
        expect(stderr.text).toContain(input);
        expect(stderr.text).toContain("permission denied");
      }
    } finally {
      chmodSync(input, 0o600);
    }
  });
});