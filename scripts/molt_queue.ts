import { MoltClient } from '../src/molt_client.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const QUEUE_DIR = path.join(os.homedir(), '.config', 'moltbook');
const QUEUE_FILE = path.join(QUEUE_DIR, 'post_queue.json');
const LOG_FILE = '/tmp/molt_queue.log';

interface QueuedPost {
  id: string;
  submolt: string;
  title: string;
  content?: string;
  scheduledAt: number; // timestamp
  createdAt: number;
  attempts: number;
  lastError?: string;
}

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  fs.appendFileSync(LOG_FILE, line + '\n');
  console.log(line);
}

function loadQueue(): QueuedPost[] {
  try {
    if (fs.existsSync(QUEUE_FILE)) {
      return JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
    }
  } catch {}
  return [];
}

function saveQueue(queue: QueuedPost[]): void {
  if (!fs.existsSync(QUEUE_DIR)) {
    fs.mkdirSync(QUEUE_DIR, { recursive: true });
  }
  fs.writeFileSync(QUEUE_FILE, JSON.stringify(queue, null, 2));
}

// Add a post to queue (works offline)
function addToQueue(submolt: string, title: string, content?: string, delayMinutes = 0): void {
  const queue = loadQueue();
  const post: QueuedPost = {
    id: `post_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    submolt,
    title,
    content,
    scheduledAt: Date.now() + delayMinutes * 60 * 1000,
    createdAt: Date.now(),
    attempts: 0,
  };
  queue.push(post);
  saveQueue(queue);
  log(`Queued: "${title}" (scheduled in ${delayMinutes} min)`);
}

// Check if network is available
async function isOnline(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await fetch('https://www.moltbook.com/api/v1/agents/status', {
      signal: controller.signal,
      headers: { 'Authorization': 'Bearer test' }
    });
    clearTimeout(timeout);
    return true;
  } catch {
    return false;
  }
}

// Process queue
async function processQueue(): Promise<void> {
  const queue = loadQueue();
  if (queue.length === 0) {
    return;
  }

  const online = await isOnline();
  if (!online) {
    log(`Offline - ${queue.length} posts waiting`);
    return;
  }

  const now = Date.now();
  const ready = queue.filter(p => p.scheduledAt <= now);

  if (ready.length === 0) {
    const next = Math.min(...queue.map(p => p.scheduledAt));
    const mins = Math.ceil((next - now) / 60000);
    log(`${queue.length} posts queued, next in ${mins} min`);
    return;
  }

  const post = ready[0];
  log(`Posting: "${post.title}" (attempt ${post.attempts + 1})`);

  try {
    const client = new MoltClient();
    const result = await client.createPost({
      submolt: post.submolt,
      title: post.title,
      content: post.content,
    });

    if (result.success) {
      log(`✓ Posted: "${post.title}"`);
      // Remove from queue
      const updated = queue.filter(p => p.id !== post.id);
      saveQueue(updated);
    } else {
      post.attempts++;
      post.lastError = result.error;

      if (result.error?.includes('30 minutes')) {
        // Rate limited - reschedule
        post.scheduledAt = now + 31 * 60 * 1000;
        log(`Rate limited, rescheduled to +31 min`);
      } else {
        // Other error - retry in 5 min
        post.scheduledAt = now + 5 * 60 * 1000;
        log(`Error: ${result.error}, retry in 5 min`);
      }
      saveQueue(queue);
    }
  } catch (err) {
    post.attempts++;
    post.lastError = err instanceof Error ? err.message : String(err);
    post.scheduledAt = now + 60 * 1000; // Retry in 1 min
    saveQueue(queue);
    log(`Network error, retry in 1 min`);
  }
}

// Daemon mode - continuously process queue
async function daemon(): Promise<void> {
  log('=== Queue Daemon Started ===');

  while (true) {
    await processQueue();
    // Check every 30 seconds
    await new Promise(r => setTimeout(r, 30000));
  }
}

// CLI
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];

  switch (cmd) {
    case 'add': {
      const submolt = args[1] || 'general';
      const title = args[2];
      const content = args[3];
      const delay = parseInt(args[4] || '0', 10);

      if (!title) {
        console.log('Usage: molt:queue add <submolt> <title> [content] [delay_minutes]');
        process.exit(1);
      }
      addToQueue(submolt, title, content, delay);
      break;
    }

    case 'list': {
      const queue = loadQueue();
      if (queue.length === 0) {
        console.log('Queue is empty');
      } else {
        console.log(`\n${queue.length} posts in queue:\n`);
        queue.forEach((p, i) => {
          const scheduled = new Date(p.scheduledAt).toLocaleString();
          const status = p.scheduledAt <= Date.now() ? 'READY' : scheduled;
          console.log(`${i + 1}. [${p.submolt}] ${p.title}`);
          console.log(`   Status: ${status} | Attempts: ${p.attempts}`);
          if (p.lastError) console.log(`   Last error: ${p.lastError}`);
          console.log('');
        });
      }
      break;
    }

    case 'clear': {
      saveQueue([]);
      console.log('Queue cleared');
      break;
    }

    case 'daemon': {
      await daemon();
      break;
    }

    case 'process': {
      await processQueue();
      break;
    }

    default:
      console.log(`
Moltbook Post Queue - Works offline!

Commands:
  add <submolt> <title> [content] [delay_min]  Add post to queue
  list                                          Show queued posts
  clear                                         Clear queue
  daemon                                        Start queue processor
  process                                       Process queue once

Examples:
  npm run molt:queue add general "Hello" "Content" 30
  npm run molt:queue list
  npm run molt:queue daemon
`);
  }
}

main().catch(console.error);
