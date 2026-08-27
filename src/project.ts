import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ProjectRef {
  name: string;
  dir: string;
}

// <project> resolves against MARROW_DEV_ROOT, or as a path if it contains a slash.
export function resolveProject(projectArg: string, devRoot: string): ProjectRef {
  const dir = projectArg.includes("/") ? path.resolve(projectArg) : path.join(devRoot, projectArg);
  return { name: path.basename(dir), dir };
}

// Creates README.md from the seed template if absent, then appends the
// persistence block (both templates substituted with the project name).
export async function writeReadme(marrowHome: string, agentsPath: string, project: string): Promise<void> {
  const persistenceTemplate = await readFile(path.join(marrowHome, "templates", "persistence-block.md"), "utf8");
  const persistenceBlock = persistenceTemplate.replaceAll("{{project}}", project);
  const readmePath = path.join(agentsPath, "README.md");

  if (!existsSync(readmePath)) {
    const seedTemplate = await readFile(path.join(marrowHome, "templates", "readme-seed.md"), "utf8");
    const seed = seedTemplate.replaceAll("{{project}}", project);
    await writeFile(readmePath, `${seed}\n${persistenceBlock}`);
    return;
  }

  const existing = await readFile(readmePath, "utf8");
  const sep = existing.endsWith("\n\n") ? "" : existing.endsWith("\n") ? "\n" : "\n\n";
  await writeFile(readmePath, `${existing}${sep}${persistenceBlock}`);
}
