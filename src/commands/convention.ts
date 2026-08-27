import { readFile } from "node:fs/promises";
import path from "node:path";

// Reads from the tool's own install location, never from MARROW_HOME.
export async function conventionCommand(toolRoot: string): Promise<number> {
  console.log(await readFile(path.join(toolRoot, "CONVENTION.md"), "utf8"));
  return 0;
}
