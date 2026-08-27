import { readdir } from "node:fs/promises";
import path from "node:path";

export interface CapturedLogs {
  code: number;
  outLines: string[];
  errLines: string[];
}

export async function captureLogs(fn: () => Promise<number>): Promise<CapturedLogs> {
  const originalLog = console.log;
  const originalError = console.error;
  const outLines: string[] = [];
  const errLines: string[] = [];
  console.log = (...args: unknown[]) => {
    outLines.push(args.join(" "));
  };
  console.error = (...args: unknown[]) => {
    errLines.push(args.join(" "));
  };
  try {
    const code = await fn();
    return { code, outLines, errLines };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

export async function listFilesRecursive(dir: string, exclude: string[] = [".git"]): Promise<string[]> {
  const results: string[] = [];
  async function walk(current: string, prefix: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (exclude.includes(entry.name)) continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(current, entry.name), rel);
      } else {
        results.push(rel);
      }
    }
  }
  await walk(dir, "");
  return results.sort();
}
