export type Severity = 'Low' | 'Medium' | 'High' | 'Critical';
export type AgentType =
  | 'security'
  | 'ux-product'
  | 'architecture'
  | 'compliance'
  | 'infra-scalability'
  | 'cost-efficiency'
  | 'cicd-operability';
export type Verdict = 'Pass' | 'Revise' | 'Reject';

export interface Finding {
  id: string;
  agent: AgentType;
  severity: Severity;
  title: string;
  description: string;
  /** Required verbatim quote from the document. Empty → discarded as hallucination. */
  excerpt: string;
  recommendation: string;
}

export interface SkepticChallenge {
  findingId: string;
  challenge: string;
}

export interface SpecialistRebuttal {
  findingId: string;
  agent: AgentType;
  defense: string;
}

export interface SkepticRating {
  findingId: string;
  rating: 'convincing' | 'unconvincing';
  /** 0-100 confidence in the rating */
  confidence: number;
  reasoning: string;
}

export interface DebateRound {
  round: number;
  challenges: SkepticChallenge[];
  rebuttals: SpecialistRebuttal[];
  ratings: SkepticRating[];
}

export interface DebateState {
  rounds: DebateRound[];
  /** Findings rated 'convincing' in the final debate round */
  survivingFindings: Finding[];
}

export interface StructuralCheckResult {
  pass: boolean;
  missingSections: string[];
}

export interface JudgeVerdict {
  verdict: Verdict;
  /** 0-100, calibrated from debate contentiousness */
  confidence: number;
  /** Top 5 surviving High/Critical findings */
  topBlockingIssues: Finding[];
  /** 1-page pre-read brief (Pass docs only) */
  committeeBrief?: string;
  /** Author-facing revision instructions (Revise/Reject docs) */
  revisionMemo?: string;
  /** Human-readable summary of the debate trace */
  agentDebateSummary: string;
}

export interface RunOptions {
  agents: string;
  depth: string;
  json: boolean;
}

export interface SignOffResult {
  agent: AgentType;
  addressed: boolean;
  /** Specific concerns still unaddressed, if any */
  unaddressedConcerns: string[];
}

export interface RevisionResult {
  revisedDoc: string;
  signOffs: SignOffResult[];
  iterations: number;
  outputPath: string;
}

export interface Config {
  specialistModel: string;
  judgeModel: string;
  skepticModel: string;
  dedupModel: string;
  maxDebateRounds: number;
  apiKey: string;
}

export interface Checkpoint {
  version: '1';
  docPath: string;
  /** sha256 hex of doc text — detects if the file changed between runs */
  docHash: string;
  createdAt: string;
  structuralCheck?: StructuralCheckResult;
  specialistFindings?: Finding[];
  dedupedFindings?: Finding[];
  debateState?: DebateState;
  verdict?: JudgeVerdict;
}
