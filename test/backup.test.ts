import { describe, expect, test } from "bun:test";
import { backupName } from "../src/backup";

describe("backupName", () => {
  test("two calls for the same project never collide, even back to back", () => {
    const names = new Set(Array.from({ length: 50 }, () => backupName("widget")));
    expect(names.size).toBe(50);
  });

  test("keeps the readable project basename as a prefix", () => {
    expect(backupName("widget")).toMatch(/^widget-.+\.tar\.gz$/);
  });

  test("never contains '/' — an explicit --id may contain it, the basename never does", () => {
    expect(backupName("widget")).not.toContain("/");
  });
});
