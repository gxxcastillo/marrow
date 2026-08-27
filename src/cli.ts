import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import path from "node:path";
import { addCommand } from "./commands/add";
import { conventionCommand } from "./commands/convention";
import { detachCommand } from "./commands/detach";
import { doctorCommand } from "./commands/doctor";
import { grepCommand } from "./commands/grep";
import { initCommand } from "./commands/init";
import { publishCommand } from "./commands/publish";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";
import { vaultDir } from "./git";

interface Context {
  marrowHome: string;
  toolRoot: string;
}

interface Parsed {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}
interface Command {
  args: string; // argument syntax after the command name; the only copy of it
  summary: string;
  options?: Record<string, { type: "string" | "boolean"; short?: string; default?: string | boolean; desc?: string }>;
  minArgs?: number; // required positionals; fewer prints usage and exits 2
  raw?: boolean; // skip parsing — args reach the command verbatim (grep -> rg)
  needsVault?: boolean; // fails with a clean message, not a stack trace, if <MARROW_HOME>/vault.git doesn't exist yet
  help?: string; // optional paragraph appended to `<command> --help`, beyond options and the one-line summary
  run: (parsed: Parsed, ctx: Context) => Promise<number>;
}

const COMMANDS: Record<string, Command> = {
  init: {
    args: "[--from <vault-url>] [--dry-run]",
    summary: "initialize the local vault",
    options: {
      from: { type: "string", desc: "attach to an existing private vault remote instead of creating a local one" },
      "dry-run": { type: "boolean", default: false, desc: "preview without writing anything" },
    },
    run: ({ values }, ctx) =>
      initCommand(ctx.marrowHome, { from: values.from as string | undefined, dryRun: values["dry-run"] as boolean }),
  },

  publish: {
    args: "<owner>/<repo> [--dry-run]",
    summary: "publish the vault to a new private GitHub remote",
    options: { "dry-run": { type: "boolean", default: false, desc: "preview without creating anything" } },
    minArgs: 1,
    needsVault: true,
    run: ({ values, positionals }, ctx) => publishCommand(positionals[0], { dryRun: values["dry-run"] as boolean }, ctx.marrowHome),
  },

  status: {
    args: "",
    summary: "show project worktree status",
    needsVault: true,
    run: (_parsed, ctx) => statusCommand(ctx.marrowHome),
  },

  sync: {
    args: "[project...] [-m <msg>]",
    summary: "commit and push project worktrees",
    options: {
      message: { type: "string", short: "m", desc: "commit message text; prefixed with '<project>: ' on each dirty project" },
    },
    needsVault: true,
    run: ({ values, positionals }, ctx) =>
      syncCommand(positionals, { message: values.message as string | undefined }, ctx.marrowHome),
  },

  add: {
    args: "<project-path> [--id <stable-id>] [--dry-run]",
    summary: "make a project's .agents/ available under marrow",
    options: {
      "dry-run": { type: "boolean", default: false, desc: "preview without writing anything" },
      id: { type: "string", desc: "stable identity for a project with no supported GitHub origin, or to override the default" },
    },
    minArgs: 1,
    needsVault: true,
    help:
      "Adopts <project-path>/.agents if it already has one, attaches its branch if one exists but the worktree\n" +
      "doesn't, or creates a fresh .agents otherwise. Run with --dry-run first — it previews every mode without\n" +
      "writing anything, and adopting an existing .agents is an attended-only operation.",
    run: ({ values, positionals }, ctx) =>
      addCommand(positionals[0], { dryRun: values["dry-run"] as boolean, id: values.id as string | undefined }, ctx.marrowHome, ctx.toolRoot),
  },

  detach: {
    args: "<project> [--dry-run]",
    summary: "remove a project's worktree, keeping its branch in the vault",
    options: { "dry-run": { type: "boolean", default: false, desc: "preview without touching the worktree" } },
    minArgs: 1,
    needsVault: true,
    run: ({ values, positionals }, ctx) =>
      detachCommand(positionals[0], { dryRun: values["dry-run"] as boolean }, ctx.marrowHome),
  },

  doctor: {
    args: "",
    summary: "check vault + worktree health",
    needsVault: true,
    run: (_parsed, ctx) => doctorCommand(ctx.marrowHome),
  },

  grep: {
    args: "<pattern> [rg-args...]",
    summary: "search across all project worktrees",
    minArgs: 1,
    raw: true,
    needsVault: true,
    run: ({ positionals }, ctx) => grepCommand(positionals[0], positionals.slice(1), ctx.marrowHome),
  },

  convention: {
    args: "",
    summary: "print CONVENTION.md",
    run: (_parsed, ctx) => conventionCommand(ctx.toolRoot),
  },
};

function invocation(name: string): string {
  const { args } = COMMANDS[name];
  return args ? `${name} ${args}` : name;
}

function usageText(): string {
  const width = Math.max(...Object.keys(COMMANDS).map((name) => invocation(name).length));
  const commands = Object.entries(COMMANDS).map(
    ([name, cmd]) => `  ${invocation(name).padEnd(width)}  ${cmd.summary}`,
  );
  return [
    "usage: marrow <command> [args]",
    "",
    "Commands:",
    ...commands,
    "",
    "Flags:",
    `  ${"-h, --help".padEnd(width)}  print this message`,
    `  ${"-v, --version".padEnd(width)}  print the tool version`,
  ].join("\n");
}

// `<command> --help`: usage line, summary, every documented option, and the
// command's own help paragraph if it has one — all generated from the same
// table `--help` itself and `cli.md` are generated from.
function commandHelp(name: string): string {
  const cmd = COMMANDS[name];
  const lines = [`usage: marrow ${invocation(name)}`, cmd.summary];

  const documented = Object.entries(cmd.options ?? {}).filter(([, opt]) => opt.desc);
  if (documented.length > 0) {
    const flag = ([key, opt]: (typeof documented)[number]) => `--${key}${opt.short ? `, -${opt.short}` : ""}`;
    const width = Math.max(...documented.map((entry) => flag(entry).length));
    lines.push("", "Options:", ...documented.map((entry) => `  ${flag(entry).padEnd(width)}  ${entry[1].desc}`));
  }

  if (cmd.help) lines.push("", cmd.help);
  return lines.join("\n");
}

// The version comes from the tool's own package.json, resolved from the install
// location like templates/ and CONVENTION.md — never from MARROW_HOME.
async function toolVersion(toolRoot: string): Promise<string> {
  const pkg = (await Bun.file(path.join(toolRoot, "package.json")).json()) as { version?: string };
  return `marrow ${pkg.version ?? "unknown"}`;
}

export async function main(argv: string[], marrowHome: string, toolRoot: string): Promise<number> {
  const [name, ...rest] = argv;

  if (name === "-h" || name === "--help") {
    console.log(usageText());
    return 0;
  }
  if (name === "-v" || name === "--version") {
    console.log(await toolVersion(toolRoot));
    return 0;
  }

  const cmd = COMMANDS[name];
  if (!cmd) {
    console.error(usageText());
    return 2;
  }

  if (!cmd.raw && (rest.includes("-h") || rest.includes("--help"))) {
    console.log(commandHelp(name));
    return 0;
  }

  if (cmd.needsVault && !existsSync(vaultDir(marrowHome))) {
    console.error(`no vault at ${vaultDir(marrowHome)} — run \`marrow init\``);
    return 1;
  }

  let parsed: Parsed;
  if (cmd.raw) {
    parsed = { values: {}, positionals: rest };
  } else {
    try {
      parsed = parseArgs({ args: rest, options: cmd.options ?? {}, allowPositionals: true }) as Parsed;
    } catch (err) {
      console.error(`marrow ${name}: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`usage: marrow ${invocation(name)}`);
      return 2;
    }
  }

  if (parsed.positionals.length < (cmd.minArgs ?? 0)) {
    console.error(`usage: marrow ${invocation(name)}`);
    return 2;
  }

  return cmd.run(parsed, { marrowHome, toolRoot });
}

export async function run(): Promise<number> {
  const marrowHome = process.env.MARROW_HOME ?? path.join(process.env.HOME ?? "", ".marrow");
  // The tool's own install location — templates/, CONVENTION.md and package.json
  // live here, resolved independently of MARROW_HOME. import.meta.dir is this
  // module's real (symlink-resolved) directory, i.e. <tool checkout>/src.
  const toolRoot = path.join(import.meta.dir, "..");
  return main(process.argv.slice(2), marrowHome, toolRoot);
}

if (import.meta.main) {
  process.exit(await run());
}
