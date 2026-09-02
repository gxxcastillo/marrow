import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  blockedOnYouLines,
  parentFreshness,
  parseCurrentStateStamp,
  persistenceBlockStatus,
  templateVersion,
  withoutPersistenceSection,
  writeReadme,
} from "../src/memory-files";
import { git } from "../src/git";
import { makeFixture, setTestIdentity, type Fixture } from "./fixtures";

describe("memory files", () => {
  let fx: Fixture;

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("parses canonical stamps and tolerates trailing annotations", () => {
    expect(parseCurrentStateStamp("As of 2026-08-31 (marrow @a108f6a)\n"))
      .toEqual({ date: "2026-08-31", revision: "a108f6a" });
    expect(parseCurrentStateStamp("As of 2026-08-31 (marrow @f3ed774, tag `v0.1.0`; released)\n"))
      .toEqual({ date: "2026-08-31", revision: "f3ed774" });
    expect(parseCurrentStateStamp("As of 2026-08-31 (new-project @no-HEAD)\n"))
      .toEqual({ date: "2026-08-31", revision: "no-HEAD" });
    expect(parseCurrentStateStamp("# Current state — marrow\n\nAs of 2026-08-31 (marrow @a108f6a)\n"))
      .toEqual({ date: "2026-08-31", revision: "a108f6a" });
  });

  test("rejects stamps that do not begin a well-formed physical line", () => {
    expect(parseCurrentStateStamp("State as of 2026-08-31 (marrow @a108f6a)\n")).toBeNull();
    expect(parseCurrentStateStamp("  As of 2026-08-31 (marrow @a108f6a)\n")).toBeNull();
    expect(parseCurrentStateStamp("As of 2026-02-31 (marrow @a108f6a)\n")).toBeNull();
    expect(parseCurrentStateStamp("As of 2026-08-31 (marrow @not-a-sha)\n")).toBeNull();
  });

  test("removes fenced and legacy persistence sections without disturbing adjacent prose", () => {
    const fenced = "# Notes\n\n<!-- marrow:persistence-block -->\n## Working memory via marrow\nmanaged\n<!-- /marrow:persistence-block -->\n\n## Work\nkeep\n";
    expect(withoutPersistenceSection(fenced)).toBe("# Notes\n\n## Work\nkeep\n");
    const legacy = "# Notes\n\n## Persistence\n\nThis directory is a git worktree of the private `marrow` repo (branch: `notes`).\nold block\n\n## Work\nkeep\n";
    expect(withoutPersistenceSection(legacy)).toBe("# Notes\n\n## Work\nkeep\n");
    const userAuthored = "# Notes\n\n## Persistence\n\nKeep these notes after leaving this tool.\n\n## Work\nkeep\n";
    expect(withoutPersistenceSection(userAuthored)).toBeNull();
    expect(withoutPersistenceSection("# Notes\n")).toBeNull();
  });

  test("compares a stamp with parent history and reports unmeasurable divergence", async () => {
    const parent = path.join(fx.root, "parent");
    await mkdir(parent);
    await git(["init", "-q", "-b", "main"], parent);
    await setTestIdentity(parent);
    await Bun.write(path.join(parent, "one.txt"), "one\n");
    await git(["add", "one.txt"], parent);
    await git(["commit", "-q", "-m", "one"], parent);
    const first = (await git(["rev-parse", "--short", "HEAD"], parent)).stdout;
    const stamp = { date: "2026-08-31", revision: first };

    expect(await parentFreshness(parent, stamp)).toEqual({ kind: "current" });

    await Bun.write(path.join(parent, "two.txt"), "two\n");
    await git(["add", "two.txt"], parent);
    await git(["commit", "-q", "-m", "two"], parent);
    expect(await parentFreshness(parent, stamp)).toEqual({ kind: "stale", commitsPast: 1 });
    expect(await parentFreshness(parent, { ...stamp, revision: "deadbee" }))
      .toEqual({ kind: "stale", commitsPast: null });
  });

  test("keeps no-HEAD neutral and skips a parent that is not a git repo", async () => {
    const plain = path.join(fx.root, "plain");
    await mkdir(plain);
    expect(await parentFreshness(plain, { date: "2026-08-31", revision: "no-HEAD" }))
      .toEqual({ kind: "current" });
    expect(await parentFreshness(plain, { date: "2026-08-31", revision: "abc1234" }))
      .toEqual({ kind: "unavailable" });
  });

  test("templateVersion reads the leading tag and throws when one is absent", async () => {
    expect(await templateVersion(fx.toolRoot, "persistence-block.md")).toMatch(/^\d+(\.\d+)*$/);
    await expect(templateVersion(fx.toolRoot, "readme-seed.md")).rejects.toThrow(/no recognizable template-version tag/);
  });

  test("blockedOnYouLines reads only a direct plans/*.md child, not the worktree root", async () => {
    const dir = path.join(fx.root, "blocked-on-you");
    await mkdir(path.join(dir, "plans"), { recursive: true });
    await Bun.write(path.join(dir, "rogue-plan.md"), "# Rogue\n\nBlocked on you: this must not surface (2026-09-02)\n");
    await Bun.write(path.join(dir, "plans", "real-plan.md"), "# Real\n\nBlocked on you: this must surface (2026-09-02)\n");

    expect(await blockedOnYouLines(dir)).toEqual(["Blocked on you: this must surface (2026-09-02)"]);
  });

  // Pins the exact pho failure: 48 root-level plan files with no `plans/` directory made
  // this scan a structural no-op regardless of content, and `doctor` still reported OK.
  test("blockedOnYouLines returns nothing when there is no plans/ directory at all", async () => {
    const dir = path.join(fx.root, "no-plans-dir");
    await mkdir(dir, { recursive: true });
    await Bun.write(path.join(dir, "orphan-plan.md"), "# Orphan\n\nBlocked on you: pins the exact pho failure (2026-09-02)\n");

    expect(await blockedOnYouLines(dir)).toEqual([]);
  });

  describe("persistenceBlockStatus", () => {
    test("is missing with no README, stale with unrecognized content, current once written", async () => {
      const dir = path.join(fx.root, "block-status");
      await mkdir(dir, { recursive: true });

      expect(await persistenceBlockStatus(fx.toolRoot, dir, "widget", "widget")).toEqual({ kind: "missing" });

      await Bun.write(path.join(dir, "README.md"), "# custom routing guide\n\nsome notes.\n");
      expect(await persistenceBlockStatus(fx.toolRoot, dir, "widget", "widget")).toEqual({ kind: "missing" });

      await writeReadme(fx.toolRoot, dir, "widget", "widget");
      const currentVersion = await templateVersion(fx.toolRoot, "persistence-block.md");
      expect(await persistenceBlockStatus(fx.toolRoot, dir, "widget", "widget")).toEqual({ kind: "current" });

      await Bun.write(
        path.join(dir, "README.md"),
        (await Bun.file(path.join(dir, "README.md")).text()).replace("Convention: `marrow convention`.", "Convention: unrecognized."),
      );
      expect(await persistenceBlockStatus(fx.toolRoot, dir, "widget", "widget")).toEqual({
        kind: "stale",
        currentVersion,
        installedVersion: currentVersion,
      });
    });
  });
});
