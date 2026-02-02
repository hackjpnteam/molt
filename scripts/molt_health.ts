import { MoltClient } from '../src/molt_client.js';

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.substring(0, maxLen - 3) + '...';
}

async function main(): Promise<void> {
  console.log('\n=== Moltbook Health Check ===\n');

  try {
    const client = new MoltClient();
    const result = await client.healthCheck();

    if (!result.ok) {
      console.log('❌ Health check failed');
      console.log(`   API Key: ${result.apiKeyPrefix}`);
      console.log(`   Error: ${result.error}`);
      process.exit(1);
    }

    console.log('✓ Health check passed');
    console.log(`   API Key: ${result.apiKeyPrefix}`);
    console.log(`   Status: ${result.status || 'unknown'}`);
    if (result.agentName) {
      console.log(`   Agent: ${result.agentName}`);
    }

    // Fetch and display some posts
    console.log('\n--- Recent Posts ---\n');

    const posts = await client.getRecentPosts({ sort: 'new', limit: 5 });

    if (posts.error) {
      console.log(`⚠️ Could not fetch posts: ${posts.error}`);
    } else if (!posts.posts || posts.posts.length === 0) {
      console.log('No posts found.');
    } else {
      posts.posts.forEach((post, i) => {
        const title = post.title || '(untitled)';
        const content = post.content || '';
        const author = post.author?.name || 'unknown';

        console.log(`${i + 1}. [${post.submolt || 'general'}] ${title}`);
        console.log(`   by ${author} | ↑${post.upvotes || 0} ↓${post.downvotes || 0} | ${post.comments_count || 0} comments`);
        if (content) {
          console.log(`   ${truncate(content, 500)}`);
        }
        console.log('');
      });
    }

    console.log('=== Health check complete ===\n');

  } catch (err) {
    console.log('❌ Failed to initialize client');
    if (err instanceof Error) {
      console.log(`   ${err.message}`);
    }
    console.log('\nMake sure you have registered first:');
    console.log('  npm run molt:register');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
