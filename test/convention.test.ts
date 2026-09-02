import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { conventionCommand } from "../src/commands/convention";
import { renderTemplate } from "../src/memory-files";
import { makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("convention", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("prints CONVENTION.md from the tool's own install location", async () => {
    await writeFile(path.join(fx.toolRoot, "CONVENTION.md"), "# The convention\nrule one\n");

    const { code, outLines } = await captureLogs(() => conventionCommand(fx.toolRoot));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("rule one");
  });

  test("prints the real CONVENTION.md's path-neutral ownership contract", async () => {
    const { code, outLines } = await captureLogs(() => conventionCommand(fx.toolRoot));
    const output = outLines.join("\n");
    expect(code).toBe(0);
    expect(output).toContain("Project instructions identify the authoritative sources");
    expect(output).toContain("the designated authority wins");
    expect(output).toContain("Every `.agents/` directory contains:");
    expect(output).toContain("`current-state.md` — shortest resumption context");
  });

  test("embeds the current agents-block and persistence-block templates verbatim", async () => {
    const convention = await readFile(path.join(fx.toolRoot, "CONVENTION.md"), "utf8");
    // `renderTemplate` (not a raw file read) so the tooling-only leading
    // `<!-- marrow:template-version N -->` line — never shown in a real project or in
    // CONVENTION.md — is stripped the same way it is before marrow writes either block.
    const agentsBlockTemplate = (await renderTemplate(fx.toolRoot, "agents-block.md", {})).trim();
    const persistenceBlockTemplate = (
      await renderTemplate(fx.toolRoot, "persistence-block.md", { branch: "<project>", project: "<project>" })
    ).trim();

    expect(convention).toContain(agentsBlockTemplate);
    expect(convention).toContain(persistenceBlockTemplate);
  });
});
