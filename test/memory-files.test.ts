import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parentFreshness, parseCurrentStateStamp } from "../src/memory-files";
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
});
