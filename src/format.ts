export function countLabel(count: number, noun: string, plural = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : plural}`;
}

// Shared by `doctor` and `status`: both walk every attached worktree with a handful
// of git shell-outs each, which is slow enough on a large vault to look hung without
// some feedback. TTY-only so piped/redirected output stays clean.
export function showProgress(message: string): boolean {
  if (!process.stdout.isTTY) return false;
  process.stdout.write(message);
  return true;
}

export function clearProgress(shown: boolean, message: string): void {
  if (!shown) return;
  process.stdout.write(`\r${" ".repeat(message.length)}\r`);
}
