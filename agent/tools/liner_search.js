import { tool } from '@openai/agents';
import { z } from 'zod';

import { evidenceSchema, searchModeSchema } from '../contracts.js';

const searchInputSchema = z.object({
  sq_id: z.string().trim().min(1),
  query: z.string().trim().min(1),
  mode: searchModeSchema,
}).strict();

let linerQueue = Promise.resolve();

export class LinerApiError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'LinerApiError';
    this.code = 'liner_api_failed';
  }
}

function parseSseEvents(text) {
  return text
    .split(/\r?\n\r?\n/)
    .map((block) => block.split(/\r?\n/).find((line) => line.startsWith('data:'))?.replace(/^data: ?/, ''))
    .filter(Boolean)
    .filter((data) => data !== '[DONE]')
    .map((data) => JSON.parse(data));
}

function referenceId(reference, index) {
  return reference.id ?? `ref-${index + 1}`;
}

export function normalizeLinerSearchSse(text, sqId) {
  const events = parseSseEvents(text);
  const referenceEvents = events.filter(({ type }) => type === 'data-search-references');
  const chunkEvents = events.filter(({ type }) => type === 'data-search-chunks');
  const rawReferences = referenceEvents.flatMap(({ data }) => data?.references ?? []);
  const rawChunks = chunkEvents.flatMap(({ data }) => data?.referenceChunks ?? []);
  const references = [];
  let skippedReferences = 0;
  rawReferences.forEach((reference, index) => {
    try {
      const url = new URL(reference.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('unsupported URL scheme');
      references.push({
        ...reference,
        id: referenceId(reference, index),
        title: reference.title,
        url: reference.url,
      });
    } catch {
      skippedReferences += 1;
    }
  });
  if (skippedReferences > 0) {
    console.error('[liner_search] skipped invalid references:', skippedReferences);
  }
  if (references.length === 0) throw new Error('Liner response contained no valid references');
  const referenceByUrl = new Map(references.map((reference) => [reference.url, reference.id]));
  const chunks = rawChunks.flatMap((chunk, index) => {
    try {
      const url = new URL(chunk.sourceUrl);
      if (!['http:', 'https:'].includes(url.protocol)) return [];
    } catch {
      return [];
    }
    let referenceIdForChunk = referenceByUrl.get(chunk.sourceUrl);
    if (!referenceIdForChunk) {
      referenceIdForChunk = `ref-${references.length + 1}`;
      references.push({
        id: referenceIdForChunk,
        title: chunk.sourceTitle,
        url: chunk.sourceUrl,
      });
      referenceByUrl.set(chunk.sourceUrl, referenceIdForChunk);
    }
    return [{
      id: `chunk-${chunk.num ?? index + 1}`,
      reference_id: referenceIdForChunk,
      content: chunk.content,
    }];
  });
  return evidenceSchema.parse({ sq_id: sqId, source: 'live', references, chunks });
}

export function createMockLinerClient({
  baseUrl = process.env.LINER_FALLBACK_BASE_URL ?? 'http://localhost:5001',
  request = fetch,
} = {}) {
  return async (input) => {
    const parsed = searchInputSchema.parse(input);
    const response = await request(new URL('/api/v1/agents/search', baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(parsed),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      throw new Error(`liner mock returned HTTP ${response.status}`);
    }
    return evidenceSchema.parse({ ...(await response.json()), source: 'mock' });
  };
}

export function createLinerClient({
  baseUrl = process.env.LINER_BASE_URL ?? 'https://platform.liner.com',
  apiKey = process.env.LINER_API_KEY ?? '',
  request = fetch,
  fallback = createMockLinerClient(),
} = {}) {
  const actual = async (input) => {
    const parsed = searchInputSchema.parse(input);
    try {
      if (!apiKey.trim()) throw new Error('LINER_API_KEY is not configured');
      for (let attempt = 1; attempt <= 6; attempt += 1) {
        const response = await request(new URL('/api/v1/agents/search', baseUrl), {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'content-type': 'application/json' },
          body: JSON.stringify({
            messages: [{ role: 'user', content: parsed.query }],
            mode: parsed.mode,
            request_id: parsed.sq_id,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        const body = await response.text();
        if (response.ok) return normalizeLinerSearchSse(body, parsed.sq_id);
        if (response.status !== 429 || attempt === 6) {
          const suffix = response.status === 429 ? ' after 6 attempts' : '';
          throw new Error(`Liner API returned HTTP ${response.status}${suffix}: ${body.slice(0, 200)}`);
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
      }
    } catch (error) {
      if (error instanceof LinerApiError) throw error;
      const message = error instanceof Error ? error.message : 'Unknown Liner API failure';
      throw new LinerApiError(message, { cause: error });
    }
  };

  return async (input) => {
    const queuedRequest = linerQueue.then(async () => {
      try {
        return await actual(input);
      } catch (error) {
        console.error('[liner_search]', input.sq_id, error.message);
        if (process.env.ALLOW_MOCK_FALLBACK !== 'true' || !fallback) throw error;
        return evidenceSchema.parse({ ...(await fallback(input)), source: 'mock' });
      }
    });
    linerQueue = queuedRequest.then(
      () => new Promise((resolve) => setTimeout(resolve, 5_000)),
      () => new Promise((resolve) => setTimeout(resolve, 5_000)),
    );
    return queuedRequest;
  };
}

export async function searchPlannedSubQuestions(inputs, { state, search }) {
  const parsedInputs = inputs.map((input) => searchInputSchema.parse(input));
  parsedInputs.forEach((input) => state.assertSearchIssued(input));
  return Promise.all(parsedInputs.map((input) => search(input)));
}

export function createLinerSearchTool({ search = createLinerClient() } = {}) {
  return tool({
    name: 'liner_search',
    description: 'plan_research가 발급한 sq_id에 대해서만 공식 Liner 검색 API로 근거를 검색한다.',
    parameters: searchInputSchema,
    outputSchema: evidenceSchema,
    execute: async (input, runContext) => {
      const state = runContext?.context?.dependencyState;
      if (!state) throw new Error('liner_search requires run dependency state');
      const [evidence] = await searchPlannedSubQuestions([input], { state, search });
      return evidence;
    },
  });
}

export const linerSearchTool = createLinerSearchTool();
