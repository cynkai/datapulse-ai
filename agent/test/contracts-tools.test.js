import assert from 'node:assert/strict';
import test from 'node:test';

import { createDependencyState } from '../contracts.js';
import { createPlanner } from '../tools/plan_research.js';
import { judgeEvidence } from '../tools/judge_evidence.js';
import { searchPlannedSubQuestions } from '../tools/liner_search.js';
import { renderChartSpec } from '../tools/render_visualization.js';

test('planner caps sub-questions and declares an assumption for ambiguous input', async () => {
  const planner = createPlanner(() => ({
    sub_questions: [1, 2, 3, 4].map((number) => ({
      id: `sq${number}`,
      query: `query ${number}`,
      mode: 'general',
      rationale: `reason ${number}`,
      claims: [`entity ${number} has value ${number}`],
    })),
    needs_visualization: true,
  }));

  const plan = await planner('Compare them');

  assert.equal(plan.sub_questions.length, 3);
  assert.match(plan.assumption, /해석/);
  assert.equal(plan.sub_questions.every(({ claims }) => claims.length > 0), true);
});

test('planner rejects synthesis or multi-fact claims', async () => {
  const planner = createPlanner(() => ({
    sub_questions: [{
      id: 'sq1', query: 'q', mode: 'general', rationale: 'r',
      claims: ['There are three approaches and the overall trend is rising.'],
    }],
    needs_visualization: false,
  }));

  await assert.rejects(planner('specific research question'), /single|단일|claim/i);
});

test('liner search rejects an sq_id that was not issued by the plan', async () => {
  const state = createDependencyState();
  state.recordPlan({
    sub_questions: [{ id: 'sq1', query: 'q', mode: 'scholar', rationale: 'r', claims: ['fact'] }],
    needs_visualization: false,
  });

  await assert.rejects(
    searchPlannedSubQuestions(
      [{ sq_id: 'sq2', query: 'q', mode: 'general' }],
      { state, search: async (input) => ({ ...input, references: [], chunks: [] }) },
    ),
    /plan_research/,
  );
});

test('parallel liner orchestration starts every planned request before resolving', async () => {
  const state = createDependencyState();
  state.recordPlan({
    sub_questions: [
      { id: 'sq1', query: 'q1', mode: 'general', rationale: 'r1', claims: ['fact 1'] },
      { id: 'sq2', query: 'q2', mode: 'scholar', rationale: 'r2', claims: ['fact 2'] },
    ],
    needs_visualization: false,
  });
  const started = [];
  const releases = [];
  const search = (input) => new Promise((resolve) => {
    started.push(input.sq_id);
    releases.push(() => resolve({ sq_id: input.sq_id, references: [], chunks: [] }));
  });

  const pending = searchPlannedSubQuestions([
    { sq_id: 'sq1', query: 'q1', mode: 'general' },
    { sq_id: 'sq2', query: 'q2', mode: 'scholar' },
  ], { state, search });
  await Promise.resolve();
  assert.deepEqual(started, ['sq1', 'sq2']);
  releases.forEach((release) => release());
  assert.equal((await pending).length, 2);
});

test('judge returns all v3 verdict classes without rewriting claims', () => {
  const evidence = {
    sq_id: 'sq1',
    references: [
      { id: 'a', title: 'A', url: 'https://a.test', source_group: 'g1' },
      { id: 'b', title: 'B', url: 'https://b.test', source_group: 'g2' },
      { id: 'c', title: 'C', url: 'https://c.test', source_group: 'g3' },
    ],
    chunks: [
      { id: 'ca', reference_id: 'a', content: 'Falco uses system call detection.', stance: 'supports', claim: 'Falco uses system call detection.' },
      { id: 'cb', reference_id: 'b', content: 'Falco uses system call detection.', stance: 'supports', claim: 'Falco uses system call detection.' },
      { id: 'cc', reference_id: 'c', content: 'Falco does not use system call detection.', stance: 'conflicts', claim: 'Falco uses no system call detection.' },
      { id: 'cd', reference_id: 'a', content: 'Falco was released in 2016.', stance: 'supports', claim: 'Falco was released in 2016.' },
    ],
  };
  const claims = [
    'Falco uses system call detection.',
    'Falco uses no system call detection.',
    'Falco was released in 2016.',
    'Falco detects orchids.',
    'Falco grew 10% in 2024 and leads competitors.',
  ];

  const verdicts = judgeEvidence({ sq_id: 'sq1', claims, evidence });

  assert.deepEqual(verdicts.map(({ claim }) => claim), claims);
  assert.deepEqual(verdicts.map(({ verdict }) => verdict), [
    'supported', 'conflicting', 'insufficient', 'unsupported', 'not_atomic',
  ]);
  assert.match(verdicts[4].reason, /수치.*시점.*관계/);
});

test('visualization is emitted only when every verdict is supported', () => {
  const supported = [{ claim: 'A is 10', verdict: 'supported', reason: 'ok', supporting_sources: ['a'], conflicting_sources: [] }];
  const blocked = [{ ...supported[0], verdict: 'insufficient' }];
  const input = { type: 'bar', title: 'Values', x_axis: 'entity', y_axis: 'value', series: [{ name: 'A', data: [{ x: 'A', y: 10 }] }] };

  assert.equal(renderChartSpec({ question: 'q', chart_spec_input: input, verdicts: supported }).type, 'bar');
  assert.equal(renderChartSpec({ question: 'q', chart_spec_input: input, verdicts: blocked }), null);
});
