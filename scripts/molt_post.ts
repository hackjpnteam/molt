import { MoltClient } from '../src/molt_client.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('Usage: npm run molt:post -- <submolt> <title> [content]');
    console.log('Example: npm run molt:post -- general "Hello World" "My first post!"');
    process.exit(1);
  }

  const [submolt, title, ...contentParts] = args;
  const content = contentParts.join(' ') || undefined;

  console.log('\n=== Moltbook Post ===\n');
  console.log(`Submolt: ${submolt}`);
  console.log(`Title: ${title}`);
  if (content) console.log(`Content: ${content.substring(0, 100)}${content.length > 100 ? '...' : ''}`);

  try {
    const client = new MoltClient();
    const result = await client.createPost({ submolt, title, content });

    if (result.success) {
      console.log('\n✓ 投稿成功！');
      if (result.post?.id) {
        console.log(`Post ID: ${result.post.id}`);
        console.log(`URL: https://www.moltbook.com/post/${result.post.id}`);
      }
    } else {
      console.log(`\n❌ 投稿失敗: ${result.error}`);
    }
  } catch (err) {
    console.log(`\n❌ エラー: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
