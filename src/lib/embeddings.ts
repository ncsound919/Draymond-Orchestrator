import { embed } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const QWEN_BASE_URL = 'https://qwen-turbo.shengyi.cc/v1';

function getQwenProvider() {
  const apiKey = process.env.QWEN_API_KEY;
  if (!apiKey) throw new Error('QWEN_API_KEY is required for embeddings');
  return createOpenAI({ baseURL: QWEN_BASE_URL, apiKey });
}

/**
 * Normalise an embedding vector to 1536 dimensions.
 * If the input is longer, truncate; if shorter, zero-pad.
 */
export function normalise1536(vec: number[]): number[] {
  if (vec.length >= 1536) return vec.slice(0, 1536);
  return [...vec, ...new Array(1536 - vec.length).fill(0)];
}

/**
 * Generate an embedding for a given text using the Qwen model.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const qwen = getQwenProvider();
  const { embedding } = await embed({
    model: qwen.embedding('text-embedding-v3'),
    value: text,
  });
  return normalise1536(embedding);
}

/**
 * Build embed-ready text for a network post.
 */
export function postEmbedText(post: {
  title: string;
  body: string;
  tags?: string[];
  type?: string;
  module?: string | null;
}): string {
  const parts = [post.title, post.body];
  if (post.tags?.length) parts.push(`Tags: ${post.tags.join(', ')}`);
  if (post.type) parts.push(`Type: ${post.type}`);
  if (post.module) parts.push(`Module: ${post.module}`);
  return parts.join('\n');
}

/**
 * Build embed-ready text for a registry listing.
 */
export function listingEmbedText(listing: {
  name: string;
  description: string;
  category?: string;
  location_city?: string | null;
  location_state?: string | null;
}): string {
  const parts = [listing.name, listing.description];
  if (listing.category) parts.push(`Category: ${listing.category}`);
  if (listing.location_city || listing.location_state) {
    parts.push(`Location: ${[listing.location_city, listing.location_state].filter(Boolean).join(', ')}`);
  }
  return parts.join('\n');
}

/**
 * Build embed-ready text for a news article.
 */
export function newsEmbedText(article: {
  title: string;
  description?: string | null;
  black_impact?: string | null;
}): string {
  const parts = [article.title];
  if (article.description) parts.push(article.description);
  if (article.black_impact) parts.push(article.black_impact);
  return parts.join('\n');
}
