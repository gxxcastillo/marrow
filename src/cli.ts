import { parseArgs } from "node:util";
import { statusCommand } from "./commands/status";
import { syncCommand } from "./commands/sync";

const USAGE = `usage: marrow <command> [args]

Commands:
  status                                   show project worktree status
  sync [project...] [-m <msg>] [--auto]    commit and push project worktrees
  adopt, new, doctor, grep, convention     not yet implemented (Phase 2)
`;

const FUTURE_COMMANDS = new Set(["adopt", "new", "doctor", "grep", "convention"]);

export async function main(argv: string[], marrowHome: string): Promise<number> {
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

    default:
      if (command && FUTURE_COMMANDS.has(command)) {
        console.error(`marrow ${command}: not yet implemented (Phase 2)`);
        return 1;
      }
      console.error(USAGE);
      return 2;
  }
}

export async function run(): Promise<number> {
  const marrowHome = process.env.MARROW_HOME ?? `${process.env.HOME}/dev/marrow`;
  return main(process.argv.slice(2), marrowHome);
}

if (import.meta.main) {
  process.exit(await run());
}
