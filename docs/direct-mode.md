# Direct Mode (No Docker)

Direct mode runs NanoClaw agents as host child processes instead of inside Docker containers. This removes the Docker/Apple Container dependency entirely while preserving all NanoClaw functionality: multi-channel messaging, scheduled tasks, IPC, session continuity, and per-group isolation.

## When to Use Direct Mode

- You don't have Docker or Apple Container installed and don't want to install them
- You're running in a sandboxed or CI environment where Docker isn't available
- You want simpler debugging with agents running directly on the host
- You're developing or testing NanoClaw itself

**Trade-off:** Direct mode gives up container-level filesystem isolation. Agents run as child processes on the host with access to whatever the host user can access. If you need strong sandboxing, use the standard container mode.

## Prerequisites

- **Node.js 20+** (with `npx` available)
- **Claude Code CLI** installed and authenticated. Get it at [claude.ai/download](https://claude.ai/download). Verify with:
  ```bash
  claude --version
  ```
- **tsx** installed globally (or available via npx):
  ```bash
  npm install -g tsx
  ```

## Installation

From a fresh clone:

```bash
git clone https://github.com/<your-fork>/nanoclaw.git
cd nanoclaw

# Install host dependencies
npm install

# Install agent-runner dependencies
cd container/agent-runner
npm install
cd ../..
```

## Running

```bash
NANOCLAW_DIRECT_MODE=1 npx tsx src/index.ts
```

That's it. NanoClaw starts with:
- The **CLI channel** auto-enabled (stdin/stdout interaction)
- A **main group** auto-registered as `cli:main`
- The default trigger word `@Andy`

Type `@Andy hello` and you'll get a response from Claude.

### With Other Channels

Direct mode works with all channels (WhatsApp, Telegram, Discord, Slack, Gmail). Set up channels the normal way (credentials in `.env`, run the appropriate `/add-*` skill), then start with:

```bash
NANOCLAW_DIRECT_MODE=1 npx tsx src/index.ts
```

The CLI channel activates automatically alongside whatever other channels you've configured.

### Disabling the CLI Channel

If you only want messaging channels (no stdin/stdout), set:

```bash
NANOCLAW_DIRECT_MODE=1 NANOCLAW_CLI_CHANNEL=0 npx tsx src/index.ts
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `NANOCLAW_DIRECT_MODE` | `0` | Set to `1` to enable direct mode (no Docker) |
| `NANOCLAW_CLI_CHANNEL` | `1` (when direct mode on) | Set to `0` to disable the CLI stdin/stdout channel |
| `TZ` | `America/Los_Angeles` | Timezone for scheduled tasks and cron expressions |

All other NanoClaw environment variables (API keys, channel credentials, etc.) work identically in direct mode.

## How It Works

In standard mode, NanoClaw spawns a Docker container for each agent invocation. The container runs the agent-runner (`container/agent-runner/src/index.ts`), which uses the Claude Agent SDK to execute prompts.

In direct mode, NanoClaw instead:

1. Spawns `tsx container/agent-runner/src/index-direct.ts` as a child process on the host
2. Passes the same `ContainerInput` JSON via stdin
3. The agent-runner calls `claude -p <prompt> --output-format json --dangerously-skip-permissions` (the Claude Code CLI)
4. Output flows back through the same `OUTPUT_START_MARKER`/`OUTPUT_END_MARKER` protocol
5. IPC (messages, tasks) uses the same filesystem-based mechanism, just with host paths instead of container-mounted paths

The key difference in the agent-runner: `index-direct.ts` uses the `claude` CLI binary instead of the Claude Agent SDK's `query()` function. The CLI approach is more robust across different environments because it doesn't depend on the SDK's internal IPC mechanisms.

### Path Mapping

In container mode, agents see fixed paths like `/workspace/group`, `/workspace/ipc`. In direct mode, the host passes real paths via environment variables:

| Container Path | Direct Mode Env Var | Typical Value |
|---|---|---|
| `/workspace/group` | `NANOCLAW_GROUP_DIR` | `<project>/groups/<folder>` |
| `/workspace/ipc` | `NANOCLAW_IPC_DIR` | `<project>/groups/<folder>/.ipc` |
| `/workspace/global` | `NANOCLAW_GLOBAL_DIR` | `<project>/groups/main` |
| `/workspace/sessions` | `NANOCLAW_SESSIONS_DIR` | `<project>/data/sessions/<folder>` |

## Architecture Diagram

```
Standard Mode:
  Channels --> SQLite --> Polling loop --> Docker Container --> Claude Agent SDK --> Response

Direct Mode:
  Channels --> SQLite --> Polling loop --> Child Process (tsx) --> Claude CLI --> Response
```

## CLI Channel Commands

When the CLI channel is active, you can type directly into stdin:

- `@Andy <message>` - Send a message to the agent
- `/quit` or `/exit` - Shut down NanoClaw

## Troubleshooting

### "claude: command not found"

Claude Code CLI is not installed or not in your PATH. Install it from [claude.ai/download](https://claude.ai/download), then verify:

```bash
which claude
claude --version
```

### "tsx: command not found"

Install tsx globally:

```bash
npm install -g tsx
```

Or ensure it's available via npx (it's a devDependency of the project).

### Agent returns empty responses

Make sure Claude Code is authenticated. Run `claude` interactively once to complete the OAuth flow, then try direct mode again.

### Session continuity not working

Sessions are stored in `data/sessions/<group-folder>/`. Make sure the data directory is writable. Session IDs are passed via `--resume` to the Claude CLI.

### Scheduled tasks not firing

Scheduled tasks work identically in direct mode. Check that your cron expressions use local time (not UTC). Use `list_tasks` via the MCP tools to inspect task state.
