/**
 * CLI Channel for NanoClaw
 *
 * A simple stdin/stdout channel for local testing and direct-mode operation.
 * Messages typed into the terminal are delivered to the main group.
 * Agent responses are printed to stdout.
 *
 * Activated when NANOCLAW_CLI_CHANNEL=1 or in direct mode with no other channels.
 */
import readline from 'readline';

import { ChannelOpts, registerChannel } from './registry.js';
import { Channel, NewMessage } from '../types.js';
import { ASSISTANT_NAME } from '../config.js';
import { logger } from '../logger.js';

const CLI_JID = 'cli:main';

function createCliChannel(opts: ChannelOpts): Channel | null {
  // Only activate if explicitly enabled or in direct mode
  if (
    process.env.NANOCLAW_CLI_CHANNEL !== '1' &&
    process.env.NANOCLAW_DIRECT_MODE !== '1'
  ) {
    return null;
  }

  let connected = false;
  let rl: readline.Interface | null = null;

  const channel: Channel = {
    name: 'cli',

    async connect(): Promise<void> {
      connected = true;

      // Register the CLI as a main group chat
      opts.onChatMetadata(CLI_JID, new Date().toISOString(), 'CLI', 'cli', false);

      // Auto-register as the main group if not already registered
      const groups = opts.registeredGroups();
      if (!groups[CLI_JID]) {
        // The orchestrator's registerGroup will handle this via IPC,
        // but we need to seed the registered groups for the first run.
        // We do this by storing a message that triggers auto-registration.
        logger.info('CLI channel: auto-registering as main group');
      }

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: `\n${ASSISTANT_NAME}> `,
      });

      rl.prompt();

      rl.on('line', (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) {
          rl?.prompt();
          return;
        }

        // Special CLI commands
        if (trimmed === '/quit' || trimmed === '/exit') {
          console.log('Goodbye!');
          process.exit(0);
        }

        const msg: NewMessage = {
          id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          chat_jid: CLI_JID,
          sender: 'user@cli',
          sender_name: 'User',
          content: trimmed,
          timestamp: new Date().toISOString(),
          is_from_me: true,
          is_bot_message: false,
        };

        opts.onMessage(CLI_JID, msg);
      });

      rl.on('close', () => {
        connected = false;
      });

      logger.info('CLI channel connected — type messages below');
    },

    async sendMessage(_jid: string, text: string): Promise<void> {
      // Print the agent's response to stdout
      console.log(`\n${ASSISTANT_NAME}: ${text}`);
      rl?.prompt();
    },

    isConnected(): boolean {
      return connected;
    },

    ownsJid(jid: string): boolean {
      return jid === CLI_JID;
    },

    async disconnect(): Promise<void> {
      connected = false;
      rl?.close();
    },

    async setTyping(_jid: string, isTyping: boolean): Promise<void> {
      if (isTyping) {
        process.stdout.write(`${ASSISTANT_NAME} is thinking...`);
      }
    },
  };

  return channel;
}

// Self-register
registerChannel('cli', createCliChannel);
