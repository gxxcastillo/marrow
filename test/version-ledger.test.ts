import { describe, expect, test } from "bun:test";
import { readLedgerEntry, stripLedger, upsertLedgerEntry } from "../src/version-ledger";

describe("version-ledger", () => {
  describe("readLedgerEntry", () => {
    test("returns undefined with no frontmatter, no ledger block, or no matching key", () => {
      expect(readLedgerEntry("# routing guide\n", "persistence-block")).toBeUndefined();
      expect(readLedgerEntry("---\ntitle: foo\n---\n# routing guide\n", "persistence-block")).toBeUndefined();
      expect(readLedgerEntry("---\nmarrow-versions:\n  agents-note: 4\n---\n", "persistence-block")).toBeUndefined();
    });

    test("reads a matching key out of an existing ledger block", () => {
      const content = "---\nmarrow-versions:\n  persistence-block: 3\n  agents-note: 4\n---\n# routing guide\n";
      expect(readLedgerEntry(content, "persistence-block")).toBe("3");
      expect(readLedgerEntry(content, "agents-note")).toBe("4");
    });
  });

  describe("upsertLedgerEntry", () => {
    test("prepends a fresh frontmatter block when none exists", () => {
      const result = upsertLedgerEntry("# routing guide\n\nbody text\n", "persistence-block", "3");
      expect(result).toBe("---\nmarrow-versions:\n  persistence-block: 3\n---\n\n# routing guide\n\nbody text\n");
      expect(readLedgerEntry(result, "persistence-block")).toBe("3");
    });

    test("handles empty readmeContent the same as the no-frontmatter case", () => {
      const result = upsertLedgerEntry("", "persistence-block", "3");
      expect(result).toBe("---\nmarrow-versions:\n  persistence-block: 3\n---\n");
    });

    test("inserts marrow-versions into existing foreign frontmatter, leaving other keys untouched", () => {
      const content = "---\ntitle: foo\ntags: bar\n---\n# routing guide\n";
      const result = upsertLedgerEntry(content, "persistence-block", "3");
      expect(result).toBe("---\ntitle: foo\ntags: bar\nmarrow-versions:\n  persistence-block: 3\n---\n\n# routing guide\n");
      expect(readLedgerEntry(result, "persistence-block")).toBe("3");
    });

    test("adds a new key to an existing marrow-versions block", () => {
      const content = "---\nmarrow-versions:\n  persistence-block: 3\n---\n# routing guide\n";
      const result = upsertLedgerEntry(content, "agents-note", "4");
      expect(result).toBe("---\nmarrow-versions:\n  persistence-block: 3\n  agents-note: 4\n---\n\n# routing guide\n");
    });

    test("replaces an existing key in place without disturbing other entries", () => {
      const content = "---\nmarrow-versions:\n  persistence-block: 3\n  agents-note: 4\n---\n# routing guide\n";
      const result = upsertLedgerEntry(content, "persistence-block", "5");
      expect(result).toBe("---\nmarrow-versions:\n  persistence-block: 5\n  agents-note: 4\n---\n\n# routing guide\n");
      expect(readLedgerEntry(result, "agents-note")).toBe("4");
    });

    test("leaves foreign frontmatter keys untouched alongside the ledger", () => {
      const content = "---\ntitle: foo\nmarrow-versions:\n  persistence-block: 3\n---\n# routing guide\n";
      const result = upsertLedgerEntry(content, "persistence-block", "5");
      expect(result).toBe("---\ntitle: foo\nmarrow-versions:\n  persistence-block: 5\n---\n\n# routing guide\n");
    });

    test("is idempotent: repeated upserts don't accumulate blank lines", () => {
      const once = upsertLedgerEntry("# routing guide\n", "persistence-block", "3");
      const twice = upsertLedgerEntry(once, "persistence-block", "3");
      expect(twice).toBe(once);
    });
  });

  describe("stripLedger", () => {
    test("removes the whole frontmatter when the ledger was its only content", () => {
      const content = "---\nmarrow-versions:\n  persistence-block: 3\n  agents-note: 4\n---\n# routing guide\n";
      expect(stripLedger(content)).toBe("# routing guide\n");
    });

    test("keeps foreign frontmatter keys and delimiters when they remain", () => {
      const content = "---\ntitle: foo\nmarrow-versions:\n  persistence-block: 3\n---\n# routing guide\n";
      expect(stripLedger(content)).toBe("---\ntitle: foo\n---\n\n# routing guide\n");
    });

    test("is a no-op with no frontmatter or no ledger block", () => {
      expect(stripLedger("# routing guide\n")).toBe("# routing guide\n");
      expect(stripLedger("---\ntitle: foo\n---\n# routing guide\n")).toBe("---\ntitle: foo\n---\n# routing guide\n");
    });
  });
});
