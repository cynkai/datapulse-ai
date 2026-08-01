import { tool } from '@openai/agents';
import { z } from 'zod';

import { evidenceSchema, searchModeSchema } from '../contracts.js';

const searchInputSchema = z.object({
  sq_id: z.string().trim().min(1),
  query: z.string().trim().min(1),
  mode: searchModeSchema,
}).strict();

export function createLinerClient({
  baseUrl = process.env.LINER_BASE_URL ?? 'http://localhost:5001',
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
      throw new Error(`liner_search mock returned HTTP ${response.status}`);
    }
    return evidenceSchema.parse(await response.json());
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
    description: 'plan_research가 발급한 sq_id에 대해서만 학술 또는 일반 근거를 검색한다.',
    parameters: searchInputSchema,
    execute: async (input, runContext) => {
      const state = runContext?.context?.dependencyState;
      if (!state) throw new Error('liner_search requires run dependency state');
      const [evidence] = await searchPlannedSubQuestions([input], { state, search });
      return evidence;
    },
  });
}

export const linerSearchTool = createLinerSearchTool();
