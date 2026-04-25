export interface BufferedConsoleMessage {
  level: 'log' | 'warn';
  text: string;
}

export async function withBufferedAthenaCoreConsole<T>(
  task: () => Promise<T>,
): Promise<{ result: T; messages: BufferedConsoleMessage[] }> {
  const messages: BufferedConsoleMessage[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;

  console.log = (...args: unknown[]) => {
    if (captureMessage('log', args, messages)) return;
    originalLog(...args);
  };

  console.warn = (...args: unknown[]) => {
    if (captureMessage('warn', args, messages)) return;
    originalWarn(...args);
  };

  try {
    return {
      result: await task(),
      messages,
    };
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
  }
}

function captureMessage(
  level: BufferedConsoleMessage['level'],
  args: unknown[],
  messages: BufferedConsoleMessage[],
): boolean {
  const text = args.map((arg) => String(arg)).join(' ');
  if (!text.startsWith('[athena-core]')) return false;

  messages.push({
    level,
    text: normalizeCoreMessage(text),
  });
  return true;
}

function normalizeCoreMessage(text: string): string {
  const firstLine = text
    .replace(/^\[athena-core\]\s*/, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)[0] ?? text;

  if (firstLine.includes('dockerDesktopLinuxEngine') || firstLine.includes('docker: error during connect')) {
    return 'nodejsscan skipped because Docker is not running or not reachable';
  }

  return firstLine;
}
