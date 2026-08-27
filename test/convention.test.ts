import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { conventionCommand } from "../src/commands/convention";
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
});
