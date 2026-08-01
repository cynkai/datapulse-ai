import { tool } from '@openai/agents';

import { planOutputSchema, questionNeedsVisualization } from '../contracts.js';

const ambiguousPattern = /\b(it|they|them|this|that|recent|best)\b|그것|이것|최근|최고/i;
const scholarPattern = /연구|논문|학술|study|research|paper|clinical/i;

export function deterministicPlan(question) {
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
    needs_visualization: questionNeedsVisualization(question),
    ...(ambiguous
      ? { assumption: '가능한 해석들을 고려하되 질문 표현의 통상적 해석을 선택했다고 선언하고 진행합니다.' }
      : {}),
  };
}

export function createPlanner(generatePlan = deterministicPlan) {
  return async (question) => {
    const generated = await generatePlan(question);
    const plan = planOutputSchema.parse({
      ...generated,
      sub_questions: generated.sub_questions.slice(0, 3),
      ...(generated.assumption || ambiguousPattern.test(question)
        ? { assumption: generated.assumption ?? '가능한 해석 중 통상적 해석을 선택했다고 선언하고 진행합니다.' }
        : {}),
    });
    return planOutputSchema.parse({
      ...plan,
      needs_visualization: plan.needs_visualization || questionNeedsVisualization(question),
    });
  };
}

export function createPlanResearchTool() {
  return tool({
    name: 'plan_research',
    description: 'sub_questions, 각 sub_question의 원자적 claims, needs_visualization을 직접 생성한다. 모호하면 가정을 선언하고 진행한다.',
    parameters: planOutputSchema,
    execute: async (planInput, runContext) => {
      const plan = planOutputSchema.parse(planInput);
      if (!runContext?.context?.dependencyState) {
        throw new Error('plan_research requires run dependency state');
      }
      return runContext.context.dependencyState.recordPlan(plan);
    },
  });
}

export const planResearchTool = createPlanResearchTool();
