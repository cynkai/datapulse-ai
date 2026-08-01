import { z } from 'zod';

export const searchModeSchema = z.enum(['scholar', 'general']);
export const verdictNameSchema = z.enum([
  'supported',
  'conflicting',
  'insufficient',
  'unsupported',
  'not_atomic',
]);

export function isAtomicClaimText(claim) {
  const synthesis = /(접근법\s*\d+개|종류\s*\d+개|분류할 수|전반적 경향|three approaches|categories|overall trend|can be classified)/i;
  const joinsClaims = /그리고|이며|하면서|\band\b|[;；]/iu;
  return !synthesis.test(claim) && !joinsClaims.test(claim);
}

const atomicClaimSchema = z.string().trim().min(1).refine(
  isAtomicClaimText,
  '각 claim은 종합·분류·경향이 아닌 단일 검증 가능한 사실이어야 합니다.',
);

export const subQuestionSchema = z.object({
  id: z.string().trim().min(1),
  query: z.string().trim().min(1),
  mode: searchModeSchema,
  rationale: z.string().trim().min(1),
  claims: z.array(atomicClaimSchema).min(1),
}).strict();

export const planOutputSchema = z.object({
  sub_questions: z.array(subQuestionSchema).min(1).max(3),
  needs_visualization: z.boolean(),
  assumption: z.string().trim().min(1).optional(),
}).strict();

export const referenceSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  url: z.string().url(),
  source_group: z.string().trim().min(1).optional(),
}).passthrough();

export const chunkSchema = z.object({
  id: z.string().trim().min(1),
  reference_id: z.string().trim().min(1),
  content: z.string().trim().min(1),
  claim: z.string().trim().min(1).optional(),
  stance: z.enum(['supports', 'conflicts', 'neutral']).optional(),
}).passthrough();

export const evidenceSchema = z.object({
  sq_id: z.string().trim().min(1),
  references: z.array(referenceSchema),
  chunks: z.array(chunkSchema),
}).strict();

export const verdictSchema = z.object({
  claim: z.string().trim().min(1),
  verdict: verdictNameSchema,
  reason: z.string().trim().min(1),
  supporting_sources: z.array(z.string()),
  conflicting_sources: z.array(z.string()),
}).strict();

const chartPointSchema = z.object({
  x: z.union([z.string(), z.number()]),
  y: z.number(),
}).strict();

export const chartSpecSchema = z.object({
  type: z.enum(['bar', 'line', 'scatter']),
  title: z.string().trim().min(1),
  x_axis: z.string().trim().min(1),
  y_axis: z.string().trim().min(1),
  series: z.array(z.object({
    name: z.string().trim().min(1),
    data: z.array(chartPointSchema).min(1),
  }).strict()).min(1),
}).strict();

export function createDependencyState() {
  let issuedSubQuestions = new Map();

  return Object.freeze({
    recordPlan(planInput) {
      const plan = planOutputSchema.parse(planInput);
      issuedSubQuestions = new Map(plan.sub_questions.map((sq) => [sq.id, sq]));
      return plan;
    },
    assertSearchIssued(searchInput) {
      const issued = issuedSubQuestions.get(searchInput.sq_id);
      if (!issued) {
        throw new Error(`liner_search requires an sq_id produced by plan_research: ${searchInput.sq_id}`);
      }
      if (issued.query !== searchInput.query || issued.mode !== searchInput.mode) {
        throw new Error(`liner_search input must match the plan_research output for ${searchInput.sq_id}`);
      }
      return issued;
    },
    issuedIds() {
      return [...issuedSubQuestions.keys()];
    },
  });
}

export function chartEligible(verdictsInput) {
  const verdicts = z.array(verdictSchema).min(1).parse(verdictsInput);
  return verdicts.every(({ verdict }) => verdict === 'supported');
}
