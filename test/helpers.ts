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

// Temporarily overrides one or more environment variables for the duration of
// fn, restoring the previous values (or deleting the key if it was unset)
// afterward — pass `undefined` to unset a key for the duration. For tests
// (marrow update, install/uninstall lifecycle) that read HOME/GIT_CONFIG_GLOBAL
// directly from the environment rather than through an explicit param.
export async function withEnv<T>(overrides: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) previous[key] = process.env[key];
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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
