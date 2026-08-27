import { git, run, vaultDir } from "../git";
import { configureOriginFetch, originUrl, verifyOriginReachable, verifyPrivateVisibility } from "../remote";
import { branchesForPublish, ensureVaultLandingBranch } from "../vault";

export interface PublishOptions { dryRun?: boolean }
class PublishAbort extends Error {}

function validateSlug(slug: string): void {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(slug)) {
    throw new PublishAbort("expected GitHub repository slug <owner>/<repo>");
  }
}

function defaultOriginUrl(slug: string): string {
  return `git@github.com:${slug}.git`;
}

function printBranches(branches: string[]): void {
  console.log(`branches: ${branches.length}`);
  for (const branch of branches) console.log(`  ${branch}`);
}

function partialFailure(vault: string, slug: string, url: string | null, originConfigured: boolean, pushed: boolean, message: string): number {
  console.error(`marrow publish: ${message}`);
  console.error(`created repository: ${slug}`);
  console.error(`origin configured: ${originConfigured ? url : "no"}`);
  console.error(`push completed: ${pushed ? "yes" : "no"}`);
  if (originConfigured) {
    const pushPart = pushed ? "" : `git -C ${vault} push origin --all && `;
    console.error(`safe next command: ${pushPart}marrow doctor`);
  } else if (url) {
    console.error(`safe next command: git -C ${vault} remote add origin ${url} && git -C ${vault} push origin --all && marrow doctor`);
  } else {
    console.error("safe next command: gh repo view, then add origin manually and run marrow doctor");
  }
  return 1;
}

export async function publishCommand(slug: string, opts: PublishOptions, marrowHome: string): Promise<number> {
  const vault = vaultDir(marrowHome);
  let created = false;
  let url: string | null = null;
  let originConfigured = false;
  let pushed = false;
  try {
    validateSlug(slug);
    const existingOrigin = await originUrl(vault);
    if (existingOrigin) throw new PublishAbort(`vault already uses origin ${existingOrigin}`);
    const branches = await branchesForPublish(vault);

    if (opts.dryRun) {
      console.log(`dry run: would publish vault to private GitHub repository ${slug}`);
      console.log(`origin: ${defaultOriginUrl(slug)}`);
      printBranches(branches);
      return 0;
    }

    // PATH passed explicitly (rather than bare `Bun.which("gh")`) so this reads
    // the live environment on every call, not a value cached at process start.
    if (!Bun.which("gh", { PATH: process.env.PATH ?? "" })) throw new PublishAbort("gh is required for marrow publish");
    await ensureVaultLandingBranch(vault);
    console.log(`publishing vault to private GitHub repository ${slug}...`);
    const made = await run("gh", ["repo", "create", slug, "--private"], vault);
    if (made.code !== 0) throw new PublishAbort(`could not create GitHub repository: ${made.stderr || made.stdout}`);
    created = true;

    const viewed = await run("gh", ["repo", "view", slug, "--json", "sshUrl", "-q", ".sshUrl"], vault);
    if (viewed.code !== 0 || viewed.stdout === "") {
      return partialFailure(vault, slug, url, originConfigured, pushed, `could not read repository URL: ${viewed.stderr || viewed.stdout}`);
    }
    url = viewed.stdout;

    const added = await git(["remote", "add", "origin", url], vault);
    if (added.code !== 0) return partialFailure(vault, slug, url, originConfigured, pushed, `could not configure origin: ${added.stderr}`);
    originConfigured = true;
    await configureOriginFetch(vault);

    const push = await git(["push", "origin", "--all"], vault);
    if (push.code !== 0) return partialFailure(vault, slug, url, originConfigured, pushed, `push failed: ${push.stderr}`);
    pushed = true;

    const fetched = await git(["fetch", "--prune", "origin"], vault);
    if (fetched.code !== 0) return partialFailure(vault, slug, url, originConfigured, pushed, `fetch failed: ${fetched.stderr}`);
    try {
      await verifyOriginReachable(vault);
    } catch (err) {
      return partialFailure(vault, slug, url, originConfigured, pushed, err instanceof Error ? err.message : String(err));
    }
    const visibility = await verifyPrivateVisibility(vault, true);
    if (visibility.status !== "ok") return partialFailure(vault, slug, url, originConfigured, pushed, visibility.message);

    console.log(`published vault to: ${slug}`);
    console.log(`origin: ${url}`);
    console.log(`pushed branches: ${branches.length}`);
    console.log(visibility.message);
    return 0;
  } catch (err) {
    if (created) return partialFailure(vault, slug, url, originConfigured, pushed, err instanceof Error ? err.message : String(err));
    console.error(`marrow publish: ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }
}
