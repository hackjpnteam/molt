import { MoltClient } from '../src/molt_client.js';

function printHelp(): void {
  console.log(`
Usage: npm run molt:dm -- <command> [args]

Commands:
  check                         Check for DM activity
  list                          List active conversations
  requests                      View pending DM requests
  approve <conversation_id>     Approve a DM request
  reject <conversation_id>      Reject a DM request
  read <conversation_id>        Read a conversation
  send <conversation_id> <msg>  Send a message
  request <agent_name> <msg>    Send a DM request to an agent

Examples:
  npm run molt:dm -- check
  npm run molt:dm -- request "CoolBot" "Hi, want to chat?"
  npm run molt:dm -- send "abc-123" "Hello!"
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printHelp();
    process.exit(0);
  }

  const [command, ...params] = args;
  const client = new MoltClient();

  try {
    switch (command) {
      case 'check': {
        console.log('\n=== DM Activity Check ===\n');
        const result = await client.checkDM();
        if (result.has_activity) {
          console.log(`✓ ${result.summary}`);
          if (result.requests?.count) {
            console.log(`\nPending requests: ${result.requests.count}`);
            result.requests.items.forEach(r => {
              console.log(`  - ${r.from.name} (${r.conversation_id})`);
            });
          }
          if (result.messages?.total_unread) {
            console.log(`\nUnread messages: ${result.messages.total_unread}`);
          }
        } else {
          console.log('No DM activity.');
        }
        break;
      }

      case 'list': {
        console.log('\n=== DM Conversations ===\n');
        const result = await client.getDMConversations();
        if (result.conversations?.count) {
          result.conversations.items.forEach(c => {
            const unread = c.unread_count > 0 ? ` (${c.unread_count} unread)` : '';
            console.log(`- ${c.with_agent.name}${unread}`);
            console.log(`  ID: ${c.conversation_id}`);
          });
        } else {
          console.log('No active conversations.');
        }
        break;
      }

      case 'requests': {
        console.log('\n=== Pending DM Requests ===\n');
        const result = await client.getDMRequests();
        if (result.requests?.length) {
          result.requests.forEach(r => {
            console.log(`- From: ${r.from.name}`);
            console.log(`  ID: ${r.conversation_id}`);
            console.log(`  Preview: ${r.message_preview}`);
            console.log('');
          });
        } else {
          console.log('No pending requests.');
        }
        break;
      }

      case 'approve': {
        if (!params[0]) {
          console.log('Error: conversation_id required');
          process.exit(1);
        }
        const result = await client.approveDMRequest(params[0]);
        console.log(result.success ? '✓ Approved' : '❌ Failed');
        break;
      }

      case 'reject': {
        if (!params[0]) {
          console.log('Error: conversation_id required');
          process.exit(1);
        }
        const result = await client.rejectDMRequest(params[0]);
        console.log(result.success ? '✓ Rejected' : '❌ Failed');
        break;
      }

      case 'read': {
        if (!params[0]) {
          console.log('Error: conversation_id required');
          process.exit(1);
        }
        console.log('\n=== Conversation ===\n');
        const result = await client.readDMConversation(params[0]);
        if (result.messages?.length) {
          result.messages.forEach(m => {
            console.log(`[${m.from}] ${m.content}`);
          });
        } else {
          console.log('No messages.');
        }
        break;
      }

      case 'send': {
        if (!params[0] || !params[1]) {
          console.log('Error: conversation_id and message required');
          process.exit(1);
        }
        const msg = params.slice(1).join(' ');
        const result = await client.sendDM(params[0], msg);
        console.log(result.success ? '✓ Sent' : `❌ Failed: ${result.error}`);
        break;
      }

      case 'request': {
        if (!params[0] || !params[1]) {
          console.log('Error: agent_name and message required');
          process.exit(1);
        }
        const msg = params.slice(1).join(' ');
        console.log(`\nSending DM request to ${params[0]}...`);
        const result = await client.sendDMRequest(params[0], msg);
        if (result.success) {
          console.log('✓ Request sent!');
          if (result.conversation_id) {
            console.log(`Conversation ID: ${result.conversation_id}`);
          }
        } else {
          console.log(`❌ Failed: ${result.error}`);
        }
        break;
      }

      default:
        console.log(`Unknown command: ${command}`);
        printHelp();
        process.exit(1);
    }
  } catch (err) {
    console.log(`\n❌ Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

main();
