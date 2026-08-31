import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { realpathSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { git } from "../src/git";
import { githubId, githubProjectId, resolveIdentity } from "../src/identity";
import { makeFixture, type Fixture } from "./fixtures";

describe("identity: GitHub origin parsing", () => {
  test.each([
    ["git@github.com:example-owner/alpha.git", "github.com/example-owner/alpha"],
    ["git@github.com:example-owner/alpha", "github.com/example-owner/alpha"],
    ["https://github.com/example-owner/alpha.git", "github.com/example-owner/alpha"],
    ["https://github.com/example-owner/alpha", "github.com/example-owner/alpha"],
    ["http://github.com/example-owner/alpha", "github.com/example-owner/alpha"],
    ["ssh://git@github.com/example-owner/alpha.git", "github.com/example-owner/alpha"],
    ["https://user@github.com/example-owner/alpha.git", "github.com/example-owner/alpha"],
    ["https://github.com/example-owner/alpha.git/", "github.com/example-owner/alpha"],
    ["  git@github.com:example-owner/alpha.git\n", "github.com/example-owner/alpha"],
    ["HTTPS://GitHub.com/Example-Owner/Alpha.GIT", "github.com/example-owner/alpha"],
    ["git@github.com:example-team/example-project.git", "github.com/example-team/example-project"],
    ["git@github.com:c8labs/c8_platform.v2.git", "github.com/c8labs/c8_platform.v2"],
  ])("githubId(%s) resolves owner/repo", (url, expected) => {
    expect(githubId(url)).toBe(expected);
  });

  test.each([
    [""],
    ["not a url"],
    ["git@gitlab.com:example-owner/alpha.git"],
    ["https://gitlab.com/example-owner/alpha.git"],
    // The host must be exactly github.com — a lookalike domain must not resolve.
    ["https://notgithub.com/example-owner/alpha"],
    ["git@notgithub.com:example-owner/alpha"],
    ["https://github.com.evil.test/example-owner/alpha"],
    // Wrong depth: owner alone, or a path below the repo.
    ["https://github.com/example-owner"],
    ["https://github.com/example-owner/alpha/tree/main"],
    ["https://github.com/example owner/alpha"],
    // A local path (what the test fixtures use as an origin) is not a GitHub URL.
    ["/var/folders/tmp/origin.git"],
  ])("githubId(%s) is null", (url) => {
    expect(githubId(url)).toBeNull();
  });

  test("userinfo before the host is honored, not treated as the host", () => {
    expect(githubId("https://evil.test@github.com/example-owner/alpha.git")).toBe("github.com/example-owner/alpha");
  });

  test.each([
    ["git@github.com:example-org/platform.git", "platform"],
    ["https://github.com/example-org/site.git", "site"],
    ["ssh://git@github.com/example-owner/legacy-app", "legacy-app"],
  ])("githubProjectId(%s) keeps only the repo name", (url, expected) => {
    expect(githubProjectId(url)).toBe(expected);
  });

  test("githubProjectId is null for anything githubId rejects", () => {
    expect(githubProjectId("https://gitlab.com/example-owner/alpha.git")).toBeNull();
  });

  test("the same repo name under different owners collapses to one id", () => {
    // Deliberate trade: readable branch names over collision-proof identity.
    // `attach` catches the collision rather than merging — see spec/cli.md -> attach.
    expect(githubProjectId("git@github.com:alice/notes.git")).toBe("notes");
    expect(githubProjectId("git@github.com:bob/notes.git")).toBe("notes");
  });

});

describe("identity: resolveIdentity", () => {
  let fx: Fixture;

  const makeRepo = async (name: string, origin?: string): Promise<string> => {
    const dir = path.join(fx.root, "identity", name);
    await mkdir(dir, { recursive: true });
    await git(["init", "-q", "-b", "main"], dir);
    if (origin) await git(["remote", "add", "origin", origin], dir);
    return dir;
  };

  beforeEach(async () => {
    fx = await makeFixture();
  });

  afterEach(async () => {
    await fx.cleanup();
  });

  test("derives the repo name from the parent repo's GitHub origin", async () => {
    const dir = await makeRepo("alpha", "git@github.com:example-owner/alpha.git");
    const identity = await resolveIdentity(dir);
    expect(identity).toEqual({
      id: "alpha",
      dir: realpathSync(dir),
      name: "alpha",
    });
  });

  test("resolves to the repo root when given a subdirectory", async () => {
    const dir = await makeRepo("gamma", "https://github.com/example-owner/gamma.git");
    const nested = path.join(dir, "src", "deep");
    await mkdir(nested, { recursive: true });

    const identity = await resolveIdentity(nested);
    expect(identity.dir).toBe(realpathSync(dir));
    expect(identity.id).toBe("gamma");
    expect(identity.name).toBe("gamma");
  });

  test("an explicit id tolerates a plain, existing non-repo directory", async () => {
    const dir = path.join(fx.root, "identity", "not-a-repo");
    await mkdir(dir, { recursive: true });

    const identity = await resolveIdentity(dir, "local-notes");
    expect(identity).toEqual({
      id: "local-notes",
      dir: path.resolve(dir),
      name: "not-a-repo",
    });
  });

  test("an explicit id on a path that doesn't exist yet keeps the literal path (fresh create)", async () => {
    const dir = path.join(fx.root, "identity", "brand-new", "nested");
    // Deliberately not created: this is the `marrow attach <new-path> --id <id>`
    // fresh-create case, where spawning git against a nonexistent cwd must
    // not crash.
    const identity = await resolveIdentity(dir, "local-fresh");
    expect(identity).toEqual({
      id: "local-fresh",
      dir: path.resolve(dir),
      name: "nested",
    });
  });

  test("an explicit id still resolves to the repo root from a subdirectory", async () => {
    const dir = await makeRepo("tracked-project", "git@github.com:example-owner/tracked-project.git");
    const nested = path.join(dir, "sub");
    await mkdir(nested, { recursive: true });

    const identity = await resolveIdentity(nested, "tracked-project-sub");
    expect(identity.dir).toBe(realpathSync(dir));
    expect(identity.name).toBe(path.basename(dir));
  });

  test("rejects a directory that is not a git repository", async () => {
    const dir = path.join(fx.root, "identity", "loose");
    await mkdir(dir, { recursive: true });
    await expect(resolveIdentity(dir)).rejects.toThrow(/is not a git repository/);
  });

  test("rejects a repo with no origin", async () => {
    const dir = await makeRepo("no-origin");
    await expect(resolveIdentity(dir)).rejects.toThrow(/no supported GitHub origin/);
  });

  test("rejects a repo whose origin is not GitHub", async () => {
    const dir = await makeRepo("file-origin", fx.bareOrigin);
    await expect(resolveIdentity(dir)).rejects.toThrow(/no supported GitHub origin/);
  });

  test("rejects an empty explicit id instead of silently deriving one", async () => {
    // `--id ""` is a bad value, not an absent flag: it must not fall through to
    // origin-derived identity, even in a repo where derivation would succeed.
    const dir = await makeRepo("empty-id", "git@github.com:gxxcastillo/ossa.git");
    await expect(resolveIdentity(dir, "")).rejects.toThrow(/invalid project id ''/);
  });

  test.each([
    ["Ossa"], // uppercase
    ["-alpha"], // must start alphanumeric
    [".hidden"],
    ["has space"],
    ["a/../b"], // path traversal into the ref namespace
    ["a//b"],
    ["trailing."],
    ["trailing/"],
  ])("rejects the invalid explicit id %s", async (id) => {
    const dir = path.join(fx.root, "identity", "explicit");
    await mkdir(dir, { recursive: true });
    await expect(resolveIdentity(dir, id)).rejects.toThrow(/invalid project id/);
  });

  test.each([["alpha"], ["platform"], ["github.com/example-owner/alpha"], ["x.y_z-1"], ["a/b"]])(
    "accepts the valid explicit id %s",
    async (id) => {
      const dir = path.join(fx.root, "identity", "explicit-ok");
      await mkdir(dir, { recursive: true });
      const identity = await resolveIdentity(dir, id);
      expect(identity.id).toBe(id);
    },
  );
});
