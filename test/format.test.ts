import { describe, expect, test } from "bun:test";
import { displayPath } from "../src/format";

describe("displayPath", () => {
  test("compacts paths under home", () => {
    expect(displayPath("/Users/gabriel/dev/event-link", "/Users/gabriel")).toBe("~/dev/event-link");
  });

  test("compacts home itself", () => {
    expect(displayPath("/Users/gabriel", "/Users/gabriel")).toBe("~");
  });

  test("leaves sibling paths unchanged", () => {
    expect(displayPath("/Users/gabriels-project/dev/event-link", "/Users/gabriel")).toBe(
      "/Users/gabriels-project/dev/event-link",
    );
  });
});
