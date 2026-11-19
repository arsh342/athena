import { resolve } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createAthenaMcpServer } from '../mcp/server.js';

/** `athena mcp`: serve Athena's tools over stdio. stdout is the protocol channel, so nothing else may write to it. */
export async function mcpCommand(opts: { root?: string }): Promise<void> {
  const server = createAthenaMcpServer({ root: resolve(opts.root ?? process.env.ATHENA_MCP_ROOT ?? process.cwd()) });
  await server.connect(new StdioServerTransport());
}
