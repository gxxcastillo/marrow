import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { writeMemoryFiles } from "../src/memory-files";
import { agentsBlock, findAgentsNote } from "../src/project";
import { makeFixture, type Fixture } from "./fixtures";

describe("project", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  describe("findAgentsNote", () => {
    // Guards phase 2's headline-vs-template ordering hazard: if the template's
    // wording ever outruns the regex, this fails loudly instead of silently marking
    // every project's note "current" (see src/project.ts -> agentsBlockStatus).
    test("recognizes the tool's own current template", async () => {
      const block = await agentsBlock(fx.toolRoot, "project");
      const note = findAgentsNote(block);
      expect(note?.version).toBeDefined();
    });
  });

  describe("writeMemoryFiles", () => {
    async function readmeFixture(name: string): Promise<{ dir: string; readmePath: string }> {
      const dir = path.join(fx.root, "readme-fixtures", name);
      await mkdir(dir, { recursive: true });
      return { dir, readmePath: path.join(dir, "README.md") };
    }

    test("upgrades a fenced v1 persistence block in place, without stacking", async () => {
      const { dir, readmePath } = await readmeFixture("fenced-v1");
      await Bun.write(
        readmePath,
        [
          "# routing guide",
          "",
          "custom prose",
          "",
          "<!-- marrow:persistence-block v1 -->",
          "## Persistence",
          "",
          "old body text.",
          "<!-- /marrow:persistence-block -->",
          "",
        ].join("\n"),
      );

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const content = await readFile(readmePath, "utf8");

      expect(content).toContain("custom prose");
      expect(content).toContain("branch: `widget`");
      expect(content).not.toContain("old body text.");
      expect((content.match(/<!-- marrow:persistence-block/g) ?? []).length).toBe(1);
    });

    test("migrates an unfenced trailing ## Persistence section and plants fences", async () => {
      const { dir, readmePath } = await readmeFixture("unfenced");
      await Bun.write(
        readmePath,
        [
          "# routing guide",
          "",
          "## Start here",
          "",
          "- some file",
          "",
          "## Persistence",
          "",
          "This directory is a git worktree of the private marrow vault (branch: `widget`).",
          "Old unfenced body.",
          "",
        ].join("\n"),
      );

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const content = await readFile(readmePath, "utf8");

      expect(content).toContain("## Start here");
      expect(content).not.toContain("Old unfenced body.");
      expect(content).toContain("<!-- marrow:persistence-block");
      expect(content).toContain("<!-- /marrow:persistence-block -->");
    });

    test("a second pass does not stack a duplicate block", async () => {
      const { dir, readmePath } = await readmeFixture("idempotent");

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const once = await readFile(readmePath, "utf8");
      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const twice = await readFile(readmePath, "utf8");

      expect(twice).toBe(once);
      expect((twice.match(/<!-- marrow:persistence-block/g) ?? []).length).toBe(1);
    });

    test("appends when no persistence section exists at all", async () => {
      const { dir, readmePath } = await readmeFixture("no-section");
      await Bun.write(readmePath, "# custom routing guide\n\nsome hand-written notes.\n");

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const content = await readFile(readmePath, "utf8");

      expect(content).toContain("some hand-written notes.");
      expect(content).toContain("<!-- marrow:persistence-block");
    });

    test("creates required current-state.md without overwriting an existing one", async () => {
      const { dir } = await readmeFixture("current-state");

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const statePath = path.join(dir, "current-state.md");
      const seeded = await readFile(statePath, "utf8");
      expect(seeded).toContain("# Current state — widget");
      expect(seeded).toContain("(widget @no-HEAD)");

      await Bun.write(statePath, "custom state\n");
      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      expect(await readFile(statePath, "utf8")).toBe("custom state\n");
    });
  });
});
