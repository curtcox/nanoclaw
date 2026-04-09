/**
 * NanoClaw Direct-Mode Agent Runner
 *
 * Alternative to index.ts that uses the `claude` CLI directly
 * instead of the Claude Agent SDK's query() function.
 * Use this when running in direct mode (NANOCLAW_DIRECT_MODE=1)
 * where the SDK's internal IPC may not work (e.g., sandboxed environments).
 *
 * Input/output protocol is identical to the container-based runner:
 *   Stdin: Full ContainerInput JSON
 *   Stdout: OUTPUT_START_MARKER / OUTPUT_END_MARKER wrapped JSON
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';

interface ContainerInput {
  prompt: string;
  sessionId?: string;
  groupFolder: string;
  chatJid: string;
  isMain: boolean;
  isScheduledTask?: boolean;
  assistantName?: string;
  script?: string;
}

interface ContainerOutput {
  status: 'success' | 'error';
  result: string | null;
  newSessionId?: string;
  error?: string;
}

const OUTPUT_START_MARKER = '---NANOCLAW_OUTPUT_START---';
const OUTPUT_END_MARKER = '---NANOCLAW_OUTPUT_END---';

function writeOutput(output: ContainerOutput): void {
  console.log(OUTPUT_START_MARKER);
  console.log(JSON.stringify(output));
  console.log(OUTPUT_END_MARKER);
}

function log(message: string): void {
  console.error(`[agent-runner-direct] ${message}`);
}

async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

/**
 * Run claude CLI and return the result.
 * Uses --print mode with JSON output for structured responses.
 */
async function runClaude(
  prompt: string,
  cwd: string,
  sessionId?: string,
  systemPromptAppend?: string,
): Promise<{ result: string; sessionId: string }> {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--output-format', 'json',
      '--dangerously-skip-permissions',
    ];

    if (sessionId) {
      args.push('--resume', sessionId);
    }

    if (systemPromptAppend) {
      args.push('--append-system-prompt', systemPromptAppend);
    }

    log(`Spawning: claude ${args.slice(0, 4).join(' ')}... (cwd: ${cwd})`);

    const proc = spawn('claude', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: { ...process.env },
    });

    // Close stdin immediately so claude doesn't wait for piped input
    proc.stdin.end();

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    proc.stderr.on('data', (d: Buffer) => {
      const chunk = d.toString();
      stderr += chunk;
      // Log stderr lines for debugging
      for (const line of chunk.trim().split('\n')) {
        if (line) log(`[claude] ${line}`);
      }
    });

    proc.on('close', (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`claude exited with code ${code}: ${stderr.slice(-300)}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        resolve({
          result: parsed.result || '',
          sessionId: parsed.session_id || '',
        });
      } catch (err) {
        // If JSON parse fails, use raw stdout as the result
        if (stdout.trim()) {
          resolve({ result: stdout.trim(), sessionId: '' });
        } else {
          reject(new Error(`Failed to parse claude output: ${err}`));
        }
      }
    });

    proc.on('error', (err) => {
      reject(new Error(`Failed to spawn claude: ${err.message}`));
    });
  });
}

async function main(): Promise<void> {
  let containerInput: ContainerInput;

  try {
    const stdinData = await readStdin();
    containerInput = JSON.parse(stdinData);
    log(`Received input for group: ${containerInput.groupFolder}`);
  } catch (err) {
    writeOutput({
      status: 'error',
      result: null,
      error: `Failed to parse input: ${err instanceof Error ? err.message : String(err)}`,
    });
    process.exit(1);
  }

  // Resolve working directory
  const groupDir = process.env.NANOCLAW_GROUP_DIR || '/workspace/group';

  // Load global CLAUDE.md for system prompt append
  const globalDir = process.env.NANOCLAW_GLOBAL_DIR || '';
  let globalClaudeMd: string | undefined;
  if (!containerInput.isMain && globalDir) {
    const globalMdPath = path.join(globalDir, 'CLAUDE.md');
    if (fs.existsSync(globalMdPath)) {
      globalClaudeMd = fs.readFileSync(globalMdPath, 'utf-8');
    }
  }

  // Build prompt
  let prompt = containerInput.prompt;
  if (containerInput.isScheduledTask) {
    prompt = `[SCHEDULED TASK]\n\n${prompt}`;
  }

  try {
    log(`Running claude with prompt (${prompt.length} chars)...`);

    const result = await runClaude(
      prompt,
      groupDir,
      containerInput.sessionId,
      globalClaudeMd,
    );

    log(`Claude responded (${result.result.length} chars), session: ${result.sessionId}`);

    writeOutput({
      status: 'success',
      result: result.result || null,
      newSessionId: result.sessionId || undefined,
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log(`Error: ${errorMessage}`);
    writeOutput({
      status: 'error',
      result: null,
      error: errorMessage,
    });
    process.exit(1);
  }
}

main();
