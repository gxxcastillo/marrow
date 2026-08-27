import { readFile } from "node:fs/promises";
import path from "node:path";

export async function conventionCommand(marrowHome: string): Promise<number> {
  console.log(await readFile(path.join(marrowHome, "CONVENTION.md"), "utf8"));
  return 0;
}
