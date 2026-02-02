import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const API_BASE = 'https://www.moltbook.com/api/v1';

// Zod schemas for API responses
const RegisterResponseSchema = z.object({
  success: z.boolean(),
  agent: z.object({
    id: z.string().optional(),
    name: z.string(),
    api_key: z.string().optional(),
  }).optional(),
  claim_url: z.string().optional(),
  verification_code: z.string().optional(),
  api_key: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

const StatusResponseSchema = z.object({
  success: z.boolean().optional(),
  status: z.string().optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

// Mask API key for logging (show first 8 chars only)
function maskApiKey(key: string): string {
  if (key.length <= 8) return key;
  return key.substring(0, 8) + '...';
}

// Save credentials securely
function saveCredentials(data: {
  api_key: string;
  agent_name: string;
  claim_url?: string;
  claimed_at?: string;
}): void {
  const configDir = path.join(os.homedir(), '.config', 'moltbook');
  const credentialsPath = path.join(configDir, 'credentials.json');

  // Create directory if it doesn't exist
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  }

  // Write credentials
  fs.writeFileSync(credentialsPath, JSON.stringify(data, null, 2), {
    encoding: 'utf-8',
    mode: 0o600,
  });

  // Ensure permissions are correct
  fs.chmodSync(credentialsPath, 0o600);

  console.log(`✓ Credentials saved to ${credentialsPath} (chmod 600)`);
}

// Load existing credentials if any
function loadCredentials(): { api_key?: string; agent_name?: string } | null {
  const credentialsPath = path.join(os.homedir(), '.config', 'moltbook', 'credentials.json');

  if (fs.existsSync(credentialsPath)) {
    try {
      return JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
    } catch {
      return null;
    }
  }
  return null;
}

// Try to register a new agent
async function registerAgent(name: string, description: string): Promise<void> {
  console.log('\n=== Moltbook Agent Registration ===\n');

  // Check for existing credentials
  const existing = loadCredentials();
  if (existing?.api_key) {
    console.log(`既存のAPI Keyが見つかりました: ${maskApiKey(existing.api_key)}`);
    console.log('新規登録をスキップします。再登録する場合は ~/.config/moltbook/credentials.json を削除してください。\n');

    // Check status instead
    await checkStatus(existing.api_key);
    return;
  }

  console.log(`Agent Name: ${name}`);
  console.log(`Description: ${description}`);
  console.log('\n登録を試行中...\n');

  try {
    // Try POST /api/v1/agents/register
    const response = await fetch(`${API_BASE}/agents/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name, description }),
    });

    const data = await response.json();

    if (!response.ok) {
      // Check for common error scenarios
      if (response.status === 404) {
        console.log('❌ 登録エンドポイントが見つかりません (404)');
        console.log('\n--- ブロック報告 ---');
        console.log('Moltbook の登録APIエンドポイントが公開されていない可能性があります。');
        console.log('以下を確認してください:');
        console.log('1. https://www.moltbook.com で手動登録が必要か');
        console.log('2. 開発者申請 (https://www.moltbook.com/developers/apply) が必要か');
        console.log('3. 招待コードが必要か');
        return;
      }

      if (response.status === 401 || response.status === 403) {
        console.log('❌ 認証エラー - 招待制または Early Access の可能性');
        console.log('\n--- ブロック報告 ---');
        console.log('登録には招待コードまたは Early Access が必要です。');
        console.log('開発者申請: https://www.moltbook.com/developers/apply');
        return;
      }

      console.log(`❌ 登録失敗 (HTTP ${response.status})`);
      console.log('Response:', JSON.stringify(data, null, 2));
      return;
    }

    // Log full response for debugging
    console.log('Response:', JSON.stringify(data, null, 2));

    // Extract API key from various possible locations
    const apiKey = data.api_key || data.agent?.api_key || data.key || data.token;
    const claimUrl = data.claim_url || data.claimUrl || data.agent?.claim_url;
    const verificationCode = data.verification_code || data.code;

    if (apiKey) {
      console.log('\n✓ 登録成功！');
      console.log(`API Key: ${maskApiKey(apiKey)}`);

      if (claimUrl) {
        console.log(`\n=== 人間による認証が必要です ===`);
        console.log(`Claim URL: ${claimUrl}`);
        if (verificationCode) {
          console.log(`Verification Code: ${verificationCode}`);
        }
        console.log('\n【手順】');
        console.log('1. 上記のURLにアクセス');
        console.log('2. Xアカウントでログイン');
        console.log('3. 認証を完了');
        console.log('4. 完了後、以下のコマンドでステータスを確認:');
        console.log('   npm run molt:verify');
        console.log('\n--- ここで停止します ---');
      }

      // Save credentials
      saveCredentials({
        api_key: apiKey,
        agent_name: name,
        claim_url: claimUrl,
      });
    } else if (data.error) {
      console.log(`\n❌ エラー: ${data.error}`);
      if (data.hint) {
        console.log(`   ヒント: ${data.hint}`);
      }
    } else if (data.message) {
      console.log(`\nメッセージ: ${data.message}`);
      console.log('\n⚠️ API Keyが見つかりませんでした。上記レスポンスを確認してください。');
    }

  } catch (error) {
    if (error instanceof Error) {
      console.log(`❌ リクエストエラー: ${error.message}`);
    }
    console.log('\n--- ブロック報告 ---');
    console.log('ネットワークエラーまたはAPI接続に失敗しました。');
  }
}

// Check agent status
async function checkStatus(apiKey: string): Promise<void> {
  console.log('\n=== Agent Status Check ===\n');

  try {
    const response = await fetch(`${API_BASE}/agents/status`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.log(`❌ ステータス確認失敗 (HTTP ${response.status})`);
      if (response.status === 401) {
        console.log('API Keyが無効または期限切れの可能性があります。');
      }
      return;
    }

    const result = StatusResponseSchema.safeParse(data);

    if (result.success) {
      const status = result.data.status;

      if (status === 'pending_claim') {
        console.log('⏳ ステータス: pending_claim');
        console.log('\n【人間による認証が必要です】');
        const creds = loadCredentials();
        if (creds && 'claim_url' in creds && creds.claim_url) {
          console.log(`Claim URL: ${creds.claim_url}`);
        }
        console.log('\n手順:');
        console.log('1. Claim URLにアクセス');
        console.log('2. Xアカウントでログインして認証');
        console.log('3. 認証後、再度 npm run molt:verify を実行');
        console.log('\n--- ここで停止します ---');
      } else if (status === 'claimed') {
        console.log('✓ ステータス: claimed (認証済み)');
        console.log('APIを使用する準備ができています。');
        console.log('\n次のコマンドでヘルスチェック:');
        console.log('  npm run molt:health');
      } else {
        console.log(`ステータス: ${status}`);
        console.log('Response:', JSON.stringify(data, null, 2));
      }
    } else {
      console.log('Response:', JSON.stringify(data, null, 2));
    }

  } catch (error) {
    if (error instanceof Error) {
      console.log(`❌ エラー: ${error.message}`);
    }
  }
}

// Main
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // If --verify flag, just check status
  if (args.includes('--verify')) {
    const creds = loadCredentials();
    if (!creds?.api_key) {
      console.log('❌ API Keyが見つかりません。先に登録を完了してください。');
      console.log('  npm run molt:register');
      return;
    }
    await checkStatus(creds.api_key);
    return;
  }

  // Default: register new agent
  const agentName = args[0] || 'MoltObserver';
  const description = args[1] || 'A read-only observation bot for Moltbook';

  await registerAgent(agentName, description);
}

main().catch(console.error);
