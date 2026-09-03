import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { git } from "../src/git";
import { writeMemoryFiles } from "../src/memory-files";
import { agentsBlock, findAgentsNote } from "../src/project";
import { makeFixture, setTestIdentity, type Fixture } from "./fixtures";

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
      expect(note).toBeDefined();
    });

    test("recognizes an old-format note carrying a trailing legacy version tag", () => {
      const legacy = [
        "> [!Note]",
        "> **Agent memory:** Read [`.agents/README.md`](.agents/README.md) before work.",
        "> Keep `.agents/` current.",
        '> <p align="right">v3</p>',
      ].join("\n");
      const note = findAgentsNote(legacy);
      expect(note).toBeDefined();
      expect(legacy.slice(note!.index, note!.index + note!.length)).toBe(legacy);
    });
  });

  describe("writeMemoryFiles", () => {
    async function readmeFixture(name: string): Promise<{ dir: string; readmePath: string }> {
      const dir = path.join(fx.root, "readme-fixtures", name);
      await mkdir(dir, { recursive: true });
      return { dir, readmePath: path.join(dir, "README.md") };
    }

    test("migrates a trailing ## Persistence section to the current heading, without stacking", async () => {
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
      expect(content).not.toContain("## Persistence\n");
      expect((content.match(/## Working memory via marrow/g) ?? []).length).toBe(1);
    });

    test("a second pass does not stack a duplicate block", async () => {
      const { dir, readmePath } = await readmeFixture("idempotent");

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const once = await readFile(readmePath, "utf8");
      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const twice = await readFile(readmePath, "utf8");

      expect(twice).toBe(once);
      expect((twice.match(/## Working memory via marrow/g) ?? []).length).toBe(1);
    });

    test("appends when no persistence section exists at all", async () => {
      const { dir, readmePath } = await readmeFixture("no-section");
      await Bun.write(readmePath, "# custom routing guide\n\nsome hand-written notes.\n");

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const content = await readFile(readmePath, "utf8");

      expect(content).toContain("some hand-written notes.");
      expect(content).toContain("## Working memory via marrow");
    });

    test("preserves a user-authored Persistence section and appends the managed block", async () => {
      const { dir, readmePath } = await readmeFixture("user-persistence");
      const original = "# custom routing guide\n\n## Persistence\n\nKeep this user-authored policy.\n";
      await Bun.write(readmePath, original);

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const content = await readFile(readmePath, "utf8");

      // The version ledger's frontmatter must be the literal first bytes of the file,
      // so it precedes the preserved user content rather than the other way around.
      expect(content).toStartWith("---\nmarrow-versions:");
      expect(content).toContain(original);
      expect(content).toContain("Keep this user-authored policy.");
      expect(content).toContain("## Working memory via marrow");
    });

    test("creates required current-state.md without overwriting an existing one", async () => {
      const { dir } = await readmeFixture("current-state");

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const statePath = path.join(dir, "current-state.md");
      const seeded = await readFile(statePath, "utf8");
      expect(seeded).toContain("# Current state — widget");
      expect(seeded).toContain("(@no-HEAD + no commits yet)");

      await Bun.write(statePath, "custom state\n");
      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      expect(await readFile(statePath, "utf8")).toBe("custom state\n");
    });

    test("summarizes the parent's latest commit subject, truncated when long", async () => {
      const { dir } = await readmeFixture("current-state-with-parent");
      const parent = path.dirname(dir);
      await git(["init", "-q", "-b", "main"], parent);
      await setTestIdentity(parent);
      await Bun.write(path.join(parent, "file.txt"), "content\n");
      await git(["add", "file.txt"], parent);
      const longSubject = "a very long commit subject line that should get truncated in the stamp because it runs on";
      await git(["commit", "-q", "-m", longSubject], parent);
      const head = (await git(["rev-parse", "--short", "HEAD"], parent)).stdout;

      await writeMemoryFiles(fx.toolRoot, dir, "widget", "widget");
      const seeded = await readFile(path.join(dir, "current-state.md"), "utf8");

      expect(longSubject.length).toBeGreaterThan(72);
      expect(seeded).toContain(`@${head} + ${longSubject.slice(0, 69)}...`);
      expect(seeded).not.toContain(longSubject);
    });
  });
});
