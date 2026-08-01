import { tool } from '@openai/agents';
import { z } from 'zod';

import { chartEligible, chartSpecSchema, verdictSchema } from '../contracts.js';

const visualizationInputSchema = z.object({
  question: z.string().trim().min(1),
  chart_spec_input: chartSpecSchema,
  verdicts: z.array(verdictSchema).min(1),
}).strict();

export function renderChartSpec(input) {
  const parsed = visualizationInputSchema.parse(input);
  if (!chartEligible(parsed.verdicts)) return null;
  return chartSpecSchema.parse(parsed.chart_spec_input);
}

export const renderVisualizationTool = tool({
  name: 'render_visualization',
  description: '모든 필수 명제가 supported일 때만 프론트엔드용 chart-spec JSON을 반환한다.',
  parameters: visualizationInputSchema,
  execute: renderChartSpec,
});
