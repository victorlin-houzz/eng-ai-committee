import type { Finding, JudgeVerdict, SkepticChallenge, SkepticRating, SpecialistRebuttal } from '../types.js';
import type { PipelineResult } from './orchestrator.js';

export type AgentName =
  | 'security-compliance'
  | 'architecture-infra'
  | 'product-ops'
  | 'skeptic'
  | 'judge';

export type PipelineEvent =
  | { type: 'stage:start';         stage: string }
  | { type: 'agent:thinking';      agent: AgentName; message: string }
  | { type: 'agent:retry';         agent: AgentName; attempt: number; reason: string }
  | { type: 'agent:timeout';       agent: AgentName; retryingIn: number }
  | { type: 'agent:finding';       agent: AgentName; finding: Finding }
  | { type: 'agent:done';          agent: AgentName; findingCount: number }
  | { type: 'dedup:complete';      before: number; after: number }
  | { type: 'debate:round:start';  round: number }
  | { type: 'skeptic:challenge';   challenges: SkepticChallenge[] }
  | { type: 'specialist:rebuttal'; rebuttals: SpecialistRebuttal[] }
  | { type: 'skeptic:rating';      ratings: SkepticRating[]; survivingCount: number }
  | { type: 'debate:round:end';    round: number; survivingFindings: Finding[] }
  | { type: 'judge:thinking' }
  | { type: 'judge:verdict';       verdict: JudgeVerdict }
  | { type: 'pipeline:complete';   result: PipelineResult }
  | { type: 'pipeline:error';      message: string };

export type PipelineEventEmitter = (event: PipelineEvent) => void;
