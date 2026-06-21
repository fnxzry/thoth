import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Writable } from "node:stream";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, chmodSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseArgs, run, usage } from "../../src/cli.js";
import type { ResolvedConfig } from "../../src/types.js";

const stubConfig: ResolvedConfig = {
  cacheDir: ".doc-cache",
  llm: {
    provider: "openai",
    apiKey: "test-key",
    baseUrl: "https://api.example.com/v1",
    defaultModel: "gpt-test",
  },
  cache: {
    enabled: true,
  },
};

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
  readStdin: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  getPackageVersion: () => string;
  loadConfigFn: (opts: unknown) => Promise<ResolvedConfig>;
}

function makeHarness(version = "9.9.9"): Harness {
  const stdout = new StringWritable();
  const stderr = new StringWritable();
  return {
    stdout,
    stderr,
    readFile: vi.fn(),
    readStdin: vi.fn(),
    writeFile: vi.fn(),
    getPackageVersion: () => version,
    loadConfigFn: async () => stubConfig,
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

  it("documents that the input file is optional and stdin is used when omitted", () => {
    const text = usage();
    expect(text).toContain("[<input.md>|-]");
    expect(text).toContain("stdin");
    expect(text).toContain("terminal");
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

  it("treats '-' as the stdin marker, leaving input undefined", () => {
    const result = parseArgs(["-"]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.args.input).toBeUndefined();
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

  it("exits 2 with a stdin-TTY error and usage text when no args and stdin is a TTY", async () => {
    const harness = makeHarness();
    const err = Object.assign(new Error("stdin is a terminal"), {
      code: "EISTTY",
    });
    harness.readStdin.mockRejectedValue(err);

    const code = await run([], harness);

    expect(code).toBe(2);
    expect(harness.readStdin).toHaveBeenCalled();
    expect(harness.readFile).not.toHaveBeenCalled();
    expect(harness.stderr.text).toContain("error:");
    expect(harness.stderr.text).toContain("Usage: thoth");
    expect(harness.stdout.text).toBe("");
  });

  it("exits 1 when reading from stdin fails with a non-TTY error", async () => {
    const harness = makeHarness();
    harness.readStdin.mockRejectedValue(new Error("stream blew up"));

    const code = await run([], harness);

    expect(code).toBe(1);
    expect(harness.stderr.text).toContain("stream blew up");
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

  it("rejects --check without --output as a usage error", async () => {
    const input = file("input.md", "data");
    const harness = makeHarness();
    harness.readFile.mockResolvedValue("data");

    const code = await run(["--check", input], harness);
    expect(code).toBe(2);
    expect(harness.stderr.text).toContain("--check");
    expect(harness.stderr.text).toContain("--output");
    expect(harness.stdout.text).toBe("");
  });

  it("--check with --output exits 0 when rendered output matches", async () => {
    const input = file("input.md", "rendered content");
    const reference = file("reference.md", "rendered content");
    const harness = makeHarness();
    harness.readFile.mockImplementation(async (p: string) => {
      if (p === input) return "rendered content";
      if (p === reference) return "rendered content";
      throw new Error(`unexpected read ${p}`);
    });

    const code = await run(["--check", "--output", reference, input], harness);

    expect(code).toBe(0);
    expect(harness.stdout.text).toBe("");
    expect(harness.stderr.text).toBe("");
    expect(harness.writeFile).not.toHaveBeenCalled();
  });

  it("--check with --output exits 3 and writes a unified diff on mismatch", async () => {
    const input = file("input.md", "fresh content");
    const reference = file("reference.md", "stale content");
    const harness = makeHarness();
    harness.readFile.mockImplementation(async (p: string) => {
      if (p === input) return "fresh content";
      if (p === reference) return "stale content";
      throw new Error(`unexpected read ${p}`);
    });

    const code = await run(["--check", "--output", reference, input], harness);

    expect(code).toBe(3);
    expect(harness.stdout.text).toBe("");
    expect(harness.stderr.text).toContain("---");
    expect(harness.stderr.text).toContain("+++");
    expect(harness.stderr.text).toContain("@@");
    expect(harness.writeFile).not.toHaveBeenCalled();
  });

  it("--check exits 2 when --output file does not exist (ENOENT)", async () => {
    const input = file("input.md", "data");
    const missing = join(tmpDir, "missing-reference.md");
    const harness = makeHarness();
    harness.readFile.mockImplementation(async (p: string) => {
      if (p === input) return "data";
      const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      throw err;
    });

    const code = await run(["--check", "--output", missing, input], harness);

    expect(code).toBe(2);
    expect(harness.stderr.text).toContain(missing);
    expect(harness.stderr.text).toContain("no such file");
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
      loadConfigFn: async () => stubConfig,
    });

    expect(code).toBe(0);
  });
});

describe("stdin input", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "thoth-cli-stdin-"));
  });

  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reads the template from stdin when no positional argument is given", async () => {
    const harness = makeHarness();
    harness.readStdin.mockResolvedValue("from stdin\n");

    const code = await run([], harness);

    expect(code).toBe(0);
    expect(harness.readStdin).toHaveBeenCalledTimes(1);
    expect(harness.readFile).not.toHaveBeenCalled();
    expect(harness.stdout.text).toBe("from stdin\n");
    expect(harness.stderr.text).toBe("");
  });

  it("reads the template from stdin when '-' is given as the positional argument", async () => {
    const harness = makeHarness();
    harness.readStdin.mockResolvedValue("from stdin via dash\n");

    const code = await run(["-"], harness);

    expect(code).toBe(0);
    expect(harness.readStdin).toHaveBeenCalledTimes(1);
    expect(harness.readFile).not.toHaveBeenCalled();
    expect(harness.stdout.text).toBe("from stdin via dash\n");
  });

  it("produces byte-identical output from '-' and from the omitted-positional form", async () => {
    const harnessDash = makeHarness();
    harnessDash.readStdin.mockResolvedValue("same template\n");
    await run(["-"], harnessDash);

    const harnessBare = makeHarness();
    harnessBare.readStdin.mockResolvedValue("same template\n");
    await run([], harnessBare);

    expect(harnessDash.stdout.text).toBe(harnessBare.stdout.text);
  });

  it("writes stdin-rendered output to --output when given", async () => {
    const output = join(tmpDir, "stdin-out.md");
    const harness = makeHarness();
    harness.readStdin.mockResolvedValue("piped output");
    harness.writeFile.mockResolvedValue(undefined);

    const code = await run(["--output", output], harness);

    expect(code).toBe(0);
    expect(harness.readStdin).toHaveBeenCalledTimes(1);
    expect(harness.readFile).not.toHaveBeenCalled();
    expect(harness.writeFile).toHaveBeenCalledWith(output, "piped output");
    expect(harness.stdout.text).toBe("");
  });

  it("uses process.cwd() as templateDir when input comes from stdin", async () => {
    const cwdDir = mkdtempSync(join(tmpdir(), "thoth-stdin-cwd-"));
    const includeName = "stdin-include-target.md";
    writeFileSync(join(cwdDir, includeName), "FROM_CWD_INCLUDE", "utf8");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwdDir);
    try {
      const harness = makeHarness();
      harness.readStdin.mockResolvedValue(
        `prefix\n@include ${includeName}\nsuffix`,
      );

      const code = await run([], harness);

      expect(code).toBe(0);
      expect(harness.stdout.text).toBe(
        "prefix\nFROM_CWD_INCLUDE\nsuffix",
      );
    } finally {
      cwdSpy.mockRestore();
      rmSync(cwdDir, { recursive: true, force: true });
    }
  });

  it("uses the file's directory as templateDir when input is a file, not cwd", async () => {
    const cwdDir = mkdtempSync(join(tmpdir(), "thoth-file-cwd-"));
    const fileDir = mkdtempSync(join(tmpdir(), "thoth-file-dir-"));
    writeFileSync(join(cwdDir, "includeme.md"), "FROM_CWD", "utf8");
    writeFileSync(join(fileDir, "includeme.md"), "FROM_FILE_DIR", "utf8");
    const inputPath = join(fileDir, "template.md");
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(cwdDir);
    try {
      const harness = makeHarness();
      harness.readFile.mockImplementation(async (p: string) => {
        expect(p).toBe(inputPath);
        return "@include includeme.md";
      });

      const code = await run([inputPath], harness);

      expect(code).toBe(0);
      expect(harness.stdout.text).toBe("FROM_FILE_DIR");
    } finally {
      cwdSpy.mockRestore();
      rmSync(cwdDir, { recursive: true, force: true });
      rmSync(fileDir, { recursive: true, force: true });
    }
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
      loadConfigFn: async () => stubConfig,
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

  it("rejects with EISTTY when the real process.stdin is a terminal", async () => {
    if (!process.stdin.isTTY) return;
    const stdout = new StringWritable();
    const stderr = new StringWritable();

    const code = await run([], {
      stdout: stdout as unknown as NodeJS.WritableStream,
      stderr: stderr as unknown as NodeJS.WritableStream,
    });

    expect(code).toBe(2);
    expect(stderr.text).toContain("error:");
    expect(stderr.text).toContain("Usage: thoth");
    expect(stdout.text).toBe("");
  });
});
