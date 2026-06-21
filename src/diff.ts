// Minimal LCS-based unified diff for drift detection in --check mode.
// Produces a unified-diff-formatted string suitable for human review.

interface DiffOp {
  type: "ctx" | "del" | "add";
  line: string;
  aLine: number;
  bLine: number;
}

function computeOps(a: string[], b: string[]): DiffOp[] {
  const m = a.length;
  const n = b.length;

  // dp[i][j] = LCS length of a[0..i-1] and b[0..j-1]
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp.push(new Array<number>(n + 1).fill(0));
  }
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack from (m, n) to (0, 0), then reverse.
  const ops: DiffOp[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      ops.push({ type: "ctx", line: a[i - 1], aLine: i, bLine: j });
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      ops.push({ type: "del", line: a[i - 1], aLine: i, bLine: 0 });
      i--;
    } else {
      ops.push({ type: "add", line: b[j - 1], aLine: 0, bLine: j });
      j--;
    }
  }
  while (i > 0) {
    ops.push({ type: "del", line: a[i - 1], aLine: i, bLine: 0 });
    i--;
  }
  while (j > 0) {
    ops.push({ type: "add", line: b[j - 1], aLine: 0, bLine: j });
    j--;
  }

  ops.reverse();
  return ops;
}

interface HunkBounds {
  startIdx: number;
  endIdx: number;
}

function groupHunks(ops: DiffOp[], contextLines: number): HunkBounds[] {
  const changePositions: number[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type !== "ctx") changePositions.push(i);
  }
  if (changePositions.length === 0) return [];

  const groups: number[][] = [];
  let current: number[] = [changePositions[0]];
  for (let i = 1; i < changePositions.length; i++) {
    const pos = changePositions[i];
    const lastPos = current[current.length - 1];
    if (pos - lastPos <= contextLines * 2) {
      current.push(pos);
    } else {
      groups.push(current);
      current = [pos];
    }
  }
  groups.push(current);

  return groups.map((group) => {
    const firstChange = group[0];
    const lastChange = group[group.length - 1];
    return {
      startIdx: Math.max(0, firstChange - contextLines),
      endIdx: Math.min(ops.length - 1, lastChange + contextLines),
    };
  });
}

function formatHunkHeader(hunkOps: DiffOp[]): string {
  let aStart = -1;
  let aCount = 0;
  let bStart = -1;
  let bCount = 0;
  for (const op of hunkOps) {
    if (op.aLine > 0) {
      if (aStart === -1) aStart = op.aLine;
      aCount++;
    }
    if (op.bLine > 0) {
      if (bStart === -1) bStart = op.bLine;
      bCount++;
    }
  }
  const aHeader = aStart === -1 ? "0,0" : `${aStart},${aCount}`;
  const bHeader = bStart === -1 ? "0,0" : `${bStart},${bCount}`;
  return `@@ -${aHeader} +${bHeader} @@`;
}

// Produces a unified diff string (with no trailing newline) for the given
// inputs. Returns an empty string when the inputs are identical.
export function unifiedDiff(
  a: string,
  b: string,
  aLabel: string,
  bLabel: string,
  contextLines = 3,
): string {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const ops = computeOps(aLines, bLines);

  if (ops.every((op) => op.type === "ctx")) return "";

  const hunks = groupHunks(ops, contextLines);

  const out: string[] = [];
  out.push(`--- ${aLabel}`);
  out.push(`+++ ${bLabel}`);
  for (const hunk of hunks) {
    const hunkOps = ops.slice(hunk.startIdx, hunk.endIdx + 1);
    out.push(formatHunkHeader(hunkOps));
    for (const op of hunkOps) {
      const prefix = op.type === "ctx" ? " " : op.type === "del" ? "-" : "+";
      out.push(`${prefix}${op.line}`);
    }
  }
  return out.join("\n");
}