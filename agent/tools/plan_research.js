import { tool } from '@openai/agents';
import { z } from 'zod';

import { planOutputSchema } from '../contracts.js';

const inputSchema = z.object({ question: z.string().trim().min(1) }).strict();
const ambiguousPattern = /\b(it|they|them|this|that|recent|best)\b|그것|이것|최근|최고/i;
const scholarPattern = /연구|논문|학술|study|research|paper|clinical/i;

function deterministicPlan(question) {
  const candidates = question
    .replace(/[?？]+$/u, '')
    .split(/(?:[.;。]|\s+(?:and|versus|vs\.?|그리고|또한)\s+)/iu)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 3);
  const parts = candidates.length > 0 ? candidates : [question.trim()];
  const ambiguous = ambiguousPattern.test(question) || question.trim().split(/\s+/u).length < 3;

  return {
    sub_questions: parts.map((part, index) => ({
      id: `sq${index + 1}`,
      query: part,
      mode: scholarPattern.test(part) ? 'scholar' : 'general',
      rationale: ambiguous
        ? '여러 해석 중 질문에 명시된 표현의 통상적 의미를 선택해 검증합니다.'
        : '질문의 단일 사실 단위를 직접 검증합니다.',
      claims: [part],
    })),
    needs_visualization: /비교|추이|변화|점유율|매출|compare|trend|growth|share|revenue/i.test(question),
    ...(ambiguous
      ? { assumption: '가능한 해석들을 고려하되 질문 표현의 통상적 해석을 선택했다고 선언하고 진행합니다.' }
      : {}),
  };
}

export function createPlanner(generatePlan = deterministicPlan) {
  return async (question) => {
    const generated = await generatePlan(question);
    return planOutputSchema.parse({
      ...generated,
      sub_questions: generated.sub_questions.slice(0, 3),
      ...(generated.assumption || ambiguousPattern.test(question)
        ? { assumption: generated.assumption ?? '가능한 해석 중 통상적 해석을 선택했다고 선언하고 진행합니다.' }
        : {}),
    });
  };
}

export function createPlanResearchTool({ planner = createPlanner() } = {}) {
  return tool({
    name: 'plan_research',
    description: '질문을 최대 3개의 하위 질문과 원자적 사실 명제로 계획한다. 모호하면 가정을 선언하고 진행한다.',
    parameters: inputSchema,
    execute: async ({ question }, runContext) => {
      const plan = await planner(question);
      if (!runContext?.context?.dependencyState) {
        throw new Error('plan_research requires run dependency state');
      }
      return runContext.context.dependencyState.recordPlan(plan);
    },
  });
}

export const planResearchTool = createPlanResearchTool();
