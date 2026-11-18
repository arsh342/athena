/**
 * Clear the viewport. Only the interactive menu uses this, inside the alternate screen.
 */
export function clearScreen(): void {
  process.stdout.write('\x1b[3J\x1b[2J\x1b[H');
}
