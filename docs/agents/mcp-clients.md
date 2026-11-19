# Using `athena mcp` from MCP clients

`athena mcp` serves Athena's tools over stdio. It confines every path to the directory it starts in (override with `--root`), never calls an AI model, and returns compact, paginated JSON with secrets redacted. No API key is needed.

Tools: `athena_scan`, `athena_check_files`, `athena_review`, `athena_explain`, `athena_provenance`, `athena_dependencies`, `athena_api_exists`, `athena_codebase_map`, `athena_taint_paths`, `athena_find_symbol`, `athena_find_callers`, `athena_add_learned_rule` (the only write; needs `confirm: true`), `athena_skills`, `athena_skill_section`.

## Claude Code

Install the plugin from this repository (`claude plugin install ./plugins/athena`) or add the server alone: `claude mcp add athena -- npx -y @arsh342/athena mcp`.

## Cursor (`.cursor/mcp.json`)

```json
{ "mcpServers": { "athena": { "command": "npx", "args": ["-y", "@arsh342/athena", "mcp"] } } }
```

## Codex (`~/.codex/config.toml`)

```toml
[mcp_servers.athena]
command = "npx"
args = ["-y", "@arsh342/athena", "mcp"]
```

## Any other MCP client

Run `npx -y @arsh342/athena mcp` as a stdio server with the project as the working directory.
