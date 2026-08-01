import { tool } from '@openai/agents';
import { z } from 'zod';

import { evidenceSchema, isAtomicClaimText, verdictSchema } from '../contracts.js';

const judgeInputSchema = z.object({
  sq_id: z.string().trim().min(1),
  claims: z.array(z.string().trim().min(1)).min(1),
  evidence: evidenceSchema,
}).strict();

function normalizedTokens(text) {
  return text.toLocaleLowerCase().match(/[\p{L}\p{N}%]+/gu) ?? [];
}

function sameClaim(left, right) {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

export function atomicityAxes(claim) {
  const axes = [];
  if (/\d|%|퍼센트|배|증가|감소/u.test(claim)) axes.push('수치');
  if (/\b(?:19|20)\d{2}\b|년|월|분기|시점|최근/u.test(claim)) axes.push('시점');
  if (/그리고|이며|하면서|하고(?=\s)|\band\b|대비|보다|관계|상관|영향/iu.test(claim)) axes.push('관계');
  return axes;
}

export function isAtomicClaim(claim) {
  return isAtomicClaimText(claim);
}

function directness(claim, chunk) {
  if (chunk.claim) return sameClaim(claim, chunk.claim) ? 1 : 0;
  const claimTokens = new Set(normalizedTokens(claim));
  const chunkTokens = new Set(normalizedTokens(chunk.content));
  const shared = [...claimTokens].filter((token) => chunkTokens.has(token)).length;
  return claimTokens.size === 0 ? 0 : shared / claimTokens.size;
}

function sourceKey(reference) {
  return reference.source_group ?? reference.url;
}

function judgeAtomicClaim(claim, evidence) {
  const references = new Map(evidence.references.map((reference) => [reference.id, reference]));
  const direct = evidence.chunks.filter((chunk) => directness(claim, chunk) >= 0.75);
  const supporting = direct.filter((chunk) => chunk.stance !== 'conflicts');
  const conflicting = direct.filter((chunk) => chunk.stance === 'conflicts');
  const supportingSources = [...new Set(supporting.map((chunk) => chunk.reference_id))];
  const conflictingSources = [...new Set(conflicting.map((chunk) => chunk.reference_id))];
  const independentSupport = new Set(
    supportingSources.map((id) => references.get(id)).filter(Boolean).map(sourceKey),
  ).size;

  if (conflictingSources.length > 0) {
    return {
      claim,
      verdict: 'conflicting',
      reason: '제공된 근거에 해당 명제와 모순되는 직접 진술이 있어 일관된 판정을 내릴 수 없습니다.',
      supporting_sources: supportingSources,
      conflicting_sources: conflictingSources,
    };
  }
  if (independentSupport >= 2) {
    return {
      claim,
      verdict: 'supported',
      reason: '서로 독립적인 출처 2개 이상이 명제를 직접 뒷받침합니다.',
      supporting_sources: supportingSources,
      conflicting_sources: [],
    };
  }
  if (supportingSources.length > 0 || evidence.chunks.some((chunk) => directness(claim, chunk) > 0)) {
    return {
      claim,
      verdict: 'insufficient',
      reason: '직접 근거가 1개 이하이거나 독립성이 부족해 판단 불가입니다.',
      supporting_sources: supportingSources,
      conflicting_sources: [],
    };
  }
  return {
    claim,
    verdict: 'unsupported',
    reason: '제공된 references와 chunks에서 이 명제와 관련된 근거를 찾지 못했습니다.',
    supporting_sources: [],
    conflicting_sources: [],
  };
}

export function judgeEvidence(input) {
  const { sq_id, claims, evidence } = judgeInputSchema.parse(input);
  if (sq_id !== evidence.sq_id) throw new Error('judge_evidence sq_id must match evidence.sq_id');

  return claims.map((claim) => {
    if (isAtomicClaim(claim)) return verdictSchema.parse(judgeAtomicClaim(claim, evidence));
    const axes = atomicityAxes(claim);
    const mixedAxes = ['수치', '시점', '관계'].filter((axis) => axes.includes(axis));
    return verdictSchema.parse({
      claim,
      verdict: 'not_atomic',
      reason: `명제를 분해하지 않았습니다. 섞인 축: ${mixedAxes.length > 0 ? mixedAxes.join('·') : '복수 관계'}. PLAN 단계에서 단일 사실로 나눠야 합니다.`,
      supporting_sources: [],
      conflicting_sources: [],
    });
  });
}

export const judgeEvidenceTool = tool({
  name: 'judge_evidence',
  description: '주어진 원자 명제를 재작성하거나 분해하지 않고 supplied evidence만으로 배치 판정한다.',
  parameters: judgeInputSchema,
  execute: judgeEvidence,
});
