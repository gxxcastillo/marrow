import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureClaudeRedirect, needsClaudeRedirect } from "../src/claude-redirect";
import { makeFixture, type Fixture } from "./fixtures";
import { captureLogs } from "./helpers";

describe("claude-redirect", () => {
  let fx: Fixture;
  let projectDir: string;

  beforeEach(async () => {
    fx = await makeFixture();
    projectDir = path.join(fx.projectsRoot, "widget");
    await mkdir(projectDir, { recursive: true });
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  describe("needsClaudeRedirect", () => {
    test("false when AGENTS.md does not exist", async () => {
      expect(needsClaudeRedirect(projectDir)).toBe(false);
    });

    test("false when CLAUDE.md already exists, however it redirects", async () => {
      await writeFile(path.join(projectDir, "AGENTS.md"), "# widget\n");
      await writeFile(path.join(projectDir, "CLAUDE.md"), "Read AGENTS.md first.\n");
      expect(needsClaudeRedirect(projectDir)).toBe(false);
    });

    test("true when AGENTS.md exists and CLAUDE.md does not", async () => {
      await writeFile(path.join(projectDir, "AGENTS.md"), "# widget\n");
      expect(needsClaudeRedirect(projectDir)).toBe(true);
    });
  });

  describe("ensureClaudeRedirect", () => {
    test("no-op, silent, when not needed", async () => {
      let changed = true;
      const { outLines } = await captureLogs(async () => {
        changed = await ensureClaudeRedirect(fx.toolRoot, projectDir, false);
        return 0;
      });
      expect(changed).toBe(false);
      expect(outLines).toEqual([]);
      expect(existsSync(path.join(projectDir, "CLAUDE.md"))).toBe(false);
    });

    test("live: writes the redirect template and reports it", async () => {
      await writeFile(path.join(projectDir, "AGENTS.md"), "# widget\n");

      let changed = false;
      const { outLines } = await captureLogs(async () => {
        changed = await ensureClaudeRedirect(fx.toolRoot, projectDir, false);
        return 0;
      });

      expect(changed).toBe(true);
      expect(outLines.join("\n")).toContain("Claude Code compatibility:");
      expect(outLines.join("\n")).toContain("CLAUDE.md                 redirect to AGENTS.md added");
      expect(await readFile(path.join(projectDir, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
    });

    test("--dry-run: previews without writing", async () => {
      await writeFile(path.join(projectDir, "AGENTS.md"), "# widget\n");

      let changed = true;
      const { outLines } = await captureLogs(async () => {
        changed = await ensureClaudeRedirect(fx.toolRoot, projectDir, true);
        return 0;
      });

      expect(changed).toBe(false);
      expect(outLines.join("\n")).toContain("would add redirect to AGENTS.md");
      expect(existsSync(path.join(projectDir, "CLAUDE.md"))).toBe(false);
    });
  });
});
