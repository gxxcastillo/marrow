import { parseArgs } from "node:util";
import { adoptCommand } from "./commands/adopt";
import { conventionCommand } from "./commands/convention";
import { doctorCommand } from "./commands/doctor";
import { grepCommand } from "./commands/grep";
import { newCommand } from "./commands/new";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";

const USAGE = `usage: marrow <command> [args]

Commands:
  status                                   show project worktree status
  sync [project...] [-m <msg>] [--auto]    commit and push project worktrees
  adopt <project> [--dry-run]              bring an existing .agents/ under marrow
  new <project>                            create a fresh .agents/ worktree
  doctor                                   check vault + worktree health
  grep <pattern> [rg-args...]              search across all project worktrees
  convention                               print CONVENTION.md
`;

export async function main(argv: string[], marrowHome: string, devRoot: string): Promise<number> {
  const [command, ...rest] = argv;

  switch (command) {
    case "status":
      return statusCommand(marrowHome);

    case "sync": {
      const { values, positionals } = parseArgs({
        args: rest,
        options: {
          message: { type: "string", short: "m" },
          auto: { type: "boolean", default: false },
        },
        allowPositionals: true,
      });
      return syncCommand(positionals, { message: values.message, auto: values.auto }, marrowHome);
    }

    case "adopt": {
      const { values, positionals } = parseArgs({
        args: rest,
        options: { "dry-run": { type: "boolean", default: false } },
        allowPositionals: true,
      });
      const project = positionals[0];
      if (!project) {
        console.error("usage: marrow adopt <project> [--dry-run]");
        return 2;
      }
      return adoptCommand(project, { dryRun: values["dry-run"] }, marrowHome, devRoot);
    }

    case "new": {
      const project = rest[0];
      if (!project) {
        console.error("usage: marrow new <project>");
        return 2;
      }
      return newCommand(project, marrowHome, devRoot);
    }

    case "doctor":
      return doctorCommand(marrowHome, devRoot);

    case "grep": {
      const [pattern, ...extraArgs] = rest;
      if (!pattern) {
        console.error("usage: marrow grep <pattern> [rg-args...]");
        return 2;
      }
      return grepCommand(pattern, extraArgs, marrowHome);
    }

    case "convention":
      return conventionCommand(marrowHome);

    default:
      console.error(USAGE);
      return 2;
  }
}

export async function run(): Promise<number> {
  const marrowHome = process.env.MARROW_HOME ?? `${process.env.HOME}/dev/marrow`;
  const devRoot = process.env.MARROW_DEV_ROOT ?? `${process.env.HOME}/dev`;
  return main(process.argv.slice(2), marrowHome, devRoot);
}

if (import.meta.main) {
  process.exit(await run());
}
