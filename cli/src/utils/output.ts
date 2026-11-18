/** The only places the CLI writes: results go to stdout, everything else to stderr. */
export function writeResult(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

export function writeInfo(text: string): void {
  process.stderr.write(text.endsWith('\n') ? text : `${text}\n`);
}
