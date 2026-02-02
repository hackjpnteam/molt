import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const API_BASE = 'https://www.moltbook.com/api/v1';

// Rate limiter (simple token bucket)
class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per ms

  constructor(maxRequests: number, periodMs: number) {
    this.maxTokens = maxRequests;
    this.tokens = maxRequests;
    this.lastRefill = Date.now();
    this.refillRate = maxRequests / periodMs;
  }

  async acquire(): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastRefill;

    // Refill tokens
    this.tokens = Math.min(this.maxTokens, this.tokens + elapsed * this.refillRate);
    this.lastRefill = now;

    if (this.tokens < 1) {
      const waitTime = Math.ceil((1 - this.tokens) / this.refillRate);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      this.tokens = 1;
    }

    this.tokens -= 1;
  }
}

// Zod schemas
const PostSchema = z.object({
  id: z.string(),
  title: z.string().optional(),
  content: z.string().optional(),
  author: z.object({
    name: z.string(),
    karma: z.number().optional(),
  }).optional(),
  submolt: z.string().optional(),
  upvotes: z.number().optional(),
  downvotes: z.number().optional(),
  comments_count: z.number().optional(),
  created_at: z.string().optional(),
});

const FeedResponseSchema = z.object({
  success: z.boolean().optional(),
  posts: z.array(PostSchema).optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

const StatusResponseSchema = z.object({
  success: z.boolean().optional(),
  status: z.string().optional(),
  agent: z.object({
    name: z.string().optional(),
    karma: z.number().optional(),
    post_count: z.number().optional(),
    comment_count: z.number().optional(),
  }).optional(),
  error: z.string().optional(),
  message: z.string().optional(),
});

const SubmoltsResponseSchema = z.object({
  success: z.boolean().optional(),
  submolts: z.array(z.object({
    name: z.string(),
    description: z.string().optional(),
    member_count: z.number().optional(),
  })).optional(),
  error: z.string().optional(),
});

export type Post = z.infer<typeof PostSchema>;
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

export class MoltClient {
  private apiKey: string;
  private rateLimiter: RateLimiter;

  constructor(apiKey?: string) {
    this.apiKey = apiKey || this.loadApiKey();
    // Conservative rate limit: 10 requests per minute for read operations
    this.rateLimiter = new RateLimiter(10, 60 * 1000);
  }

  private loadApiKey(): string {
    const credentialsPath = path.join(os.homedir(), '.config', 'moltbook', 'credentials.json');

    if (!fs.existsSync(credentialsPath)) {
      throw new Error(
        'API Key not found. Please run "npm run molt:register" first.\n' +
        `Expected location: ${credentialsPath}`
      );
    }

    try {
      const data = JSON.parse(fs.readFileSync(credentialsPath, 'utf-8'));
      if (!data.api_key) {
        throw new Error('credentials.json does not contain api_key');
      }
      return data.api_key;
    } catch (err) {
      throw new Error(`Failed to load credentials: ${err}`);
    }
  }

  private maskApiKey(): string {
    if (this.apiKey.length <= 8) return this.apiKey;
    return this.apiKey.substring(0, 8) + '...';
  }

  private async request<T>(endpoint: string, schema: z.ZodType<T>): Promise<T> {
    await this.rateLimiter.acquire();

    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unknown error');
      throw new Error(`HTTP ${response.status}: ${errorBody}`);
    }

    const data = await response.json();
    const result = schema.safeParse(data);

    if (!result.success) {
      // Return raw data if schema validation fails but response was OK
      return data as T;
    }

    return result.data;
  }

  private async postRequest<T>(endpoint: string, body: Record<string, unknown>): Promise<T> {
    await this.rateLimiter.acquire();

    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }

    return data as T;
  }

  private async deleteRequest<T>(endpoint: string): Promise<T> {
    await this.rateLimiter.acquire();

    const url = `${API_BASE}${endpoint}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || data.message || `HTTP ${response.status}`);
    }

    return data as T;
  }

  // Get agent status
  async getStatus(): Promise<{
    success: boolean;
    status?: string;
    agent?: { name?: string; karma?: number };
    error?: string;
  }> {
    return this.request('/agents/status', StatusResponseSchema);
  }

  // Get personal feed (posts from followed agents and subscribed submolts)
  async getFeed(options: { sort?: 'new' | 'hot'; limit?: number } = {}): Promise<FeedResponse> {
    const { sort = 'new', limit = 15 } = options;
    return this.request(`/feed?sort=${sort}&limit=${limit}`, FeedResponseSchema);
  }

  // Get recent public posts
  async getRecentPosts(options: { sort?: 'new' | 'hot'; limit?: number } = {}): Promise<FeedResponse> {
    const { sort = 'new', limit = 15 } = options;
    return this.request(`/posts?sort=${sort}&limit=${limit}`, FeedResponseSchema);
  }

  // Get a specific post by ID
  async getPost(id: string): Promise<Post | null> {
    try {
      const data = await this.request(`/posts/${id}`, PostSchema);
      return data;
    } catch {
      return null;
    }
  }

  // Get list of submolts
  async getSubmolts(): Promise<{ submolts?: Array<{ name: string; description?: string }> }> {
    return this.request('/submolts', SubmoltsResponseSchema);
  }

  // ============ POSTS ============

  // Create a new post
  async createPost(options: {
    submolt: string;
    title: string;
    content?: string;
    url?: string;
  }): Promise<{ success: boolean; post?: { id: string }; error?: string }> {
    return this.postRequest('/posts', options);
  }

  // Delete a post
  async deletePost(postId: string): Promise<{ success: boolean }> {
    return this.deleteRequest(`/posts/${postId}`);
  }

  // ============ COMMENTS ============

  // Add a comment to a post
  async addComment(postId: string, content: string, parentId?: string): Promise<{
    success: boolean;
    comment?: { id: string };
    error?: string;
  }> {
    const body: Record<string, string> = { content };
    if (parentId) body.parent_id = parentId;
    return this.postRequest(`/posts/${postId}/comments`, body);
  }

  // ============ VOTING ============

  // Upvote a post
  async upvotePost(postId: string): Promise<{ success: boolean }> {
    return this.postRequest(`/posts/${postId}/upvote`, {});
  }

  // Downvote a post
  async downvotePost(postId: string): Promise<{ success: boolean }> {
    return this.postRequest(`/posts/${postId}/downvote`, {});
  }

  // Upvote a comment
  async upvoteComment(commentId: string): Promise<{ success: boolean }> {
    return this.postRequest(`/comments/${commentId}/upvote`, {});
  }

  // ============ DM (Direct Messages) ============

  // Check for DM activity
  async checkDM(): Promise<{
    success: boolean;
    has_activity: boolean;
    summary?: string;
    requests?: { count: number; items: Array<{ conversation_id: string; from: { name: string } }> };
    messages?: { total_unread: number };
  }> {
    return this.request('/agents/dm/check', z.any());
  }

  // Send a DM request to another agent
  async sendDMRequest(to: string, message: string): Promise<{
    success: boolean;
    conversation_id?: string;
    error?: string;
  }> {
    return this.postRequest('/agents/dm/request', { to, message });
  }

  // Send a DM request by owner's X handle
  async sendDMRequestByOwner(toOwner: string, message: string): Promise<{
    success: boolean;
    conversation_id?: string;
    error?: string;
  }> {
    return this.postRequest('/agents/dm/request', { to_owner: toOwner, message });
  }

  // Get pending DM requests
  async getDMRequests(): Promise<{
    success: boolean;
    requests?: Array<{
      conversation_id: string;
      from: { name: string; owner?: { x_handle: string } };
      message_preview: string;
    }>;
  }> {
    return this.request('/agents/dm/requests', z.any());
  }

  // Approve a DM request
  async approveDMRequest(conversationId: string): Promise<{ success: boolean }> {
    return this.postRequest(`/agents/dm/requests/${conversationId}/approve`, {});
  }

  // Reject a DM request
  async rejectDMRequest(conversationId: string, block = false): Promise<{ success: boolean }> {
    return this.postRequest(`/agents/dm/requests/${conversationId}/reject`, { block });
  }

  // List active DM conversations
  async getDMConversations(): Promise<{
    success: boolean;
    conversations?: {
      count: number;
      items: Array<{
        conversation_id: string;
        with_agent: { name: string };
        unread_count: number;
      }>;
    };
  }> {
    return this.request('/agents/dm/conversations', z.any());
  }

  // Read a DM conversation (marks as read)
  async readDMConversation(conversationId: string): Promise<{
    success: boolean;
    messages?: Array<{
      id: string;
      from: string;
      content: string;
      created_at: string;
    }>;
  }> {
    return this.request(`/agents/dm/conversations/${conversationId}`, z.any());
  }

  // Send a DM message
  async sendDM(conversationId: string, message: string, needsHumanInput = false): Promise<{
    success: boolean;
    error?: string;
  }> {
    return this.postRequest(`/agents/dm/conversations/${conversationId}/send`, {
      message,
      needs_human_input: needsHumanInput,
    });
  }

  // ============ HEALTH CHECK ============

  // Health check - returns summary
  async healthCheck(): Promise<{
    ok: boolean;
    apiKeyPrefix: string;
    status?: string;
    agentName?: string;
    postsCount?: number;
    error?: string;
  }> {
    try {
      // Check status first
      const statusResult = await this.getStatus();

      if (statusResult.error) {
        return {
          ok: false,
          apiKeyPrefix: this.maskApiKey(),
          error: statusResult.error,
        };
      }

      // Try to get recent posts
      const postsResult = await this.getRecentPosts({ limit: 5 });

      return {
        ok: true,
        apiKeyPrefix: this.maskApiKey(),
        status: statusResult.status,
        agentName: statusResult.agent?.name,
        postsCount: postsResult.posts?.length || 0,
      };

    } catch (err) {
      return {
        ok: false,
        apiKeyPrefix: this.maskApiKey(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}

// Export singleton for convenience
let clientInstance: MoltClient | null = null;

export function getClient(): MoltClient {
  if (!clientInstance) {
    clientInstance = new MoltClient();
  }
  return clientInstance;
}
