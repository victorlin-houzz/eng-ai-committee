import { challengeFindings, rateRebuttals } from './agents/skeptic.js';
import { callAgent, withTimeout } from './agents/base.js';
import type {
  AgentType,
  Config,
  DebateRound,
  DebateState,
  Finding,
  SkepticChallenge,
  SpecialistRebuttal,
} from '../types.js';
import type { PipelineEventEmitter } from './events.js';

const REBUTTAL_SYSTEM = `You are a specialist defending your design document finding against a skeptic's challenge.

Identify which attack vector the skeptic used and respond directly to it:
- EXCERPT VALIDITY attack: Quote more context or explain why the partial quote represents a broader pattern in the document.
- SEVERITY INFLATION attack: State the concrete failure path, realistic probability (not worst-case), and blast radius that justify the severity. If you cannot, acknowledge that and tighten the scope.
- SPECIFICITY attack: Identify the specific paragraph, design choice, or gap in this document that makes this finding non-generic. If it applies equally to any design, say so and narrow the finding scope.
- ALREADY ADDRESSED attack: Explain what the referenced section leaves unresolved, or why the standard practice does not cover the risk in this specific context.
- STRAW MAN attack: Clarify what the document actually proposes and explain why it leads to the identified risk.

Rules:
- 3-6 sentences, tight and direct — no fluff
- If the challenge raises a fair point, acknowledge it briefly, then explain why the core risk remains
- Do not restate the finding verbatim
- Do not claim "best practices require X" without connecting it to a concrete risk in this design

Return a JSON array: [{ "findingId": "...", "agent": "...", "defense": "..." }]`;

const DEBATE_CALL_TIMEOUT_MS = 90_000;

async function getRebuttal(
  finding: Finding,
  challenge: SkepticChallenge,
  model: string,
  signal?: AbortSignal,
): Promise<SpecialistRebuttal> {
  const userPrompt = `Your finding:\n${JSON.stringify(finding, null, 2)}\n\nSkeptic challenge:\n"${challenge.challenge}"\n\nWrite your rebuttal. Return JSON array with one element.`;

  const raw = await withTimeout(
    callAgent(REBUTTAL_SYSTEM, userPrompt, model, 'medium', signal),
    DEBATE_CALL_TIMEOUT_MS,
    `rebuttal(${finding.id})`,
  );
  const jsonMatch = raw.match(/\[[\s\S]*\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]) as SpecialistRebuttal[];
      if (arr.length > 0) return arr[0];
    } catch { /* fall through */ }
  }
  return { findingId: finding.id, agent: finding.agent as AgentType, defense: 'Unable to produce rebuttal.' };
}

async function runDebateRound(
  findings: Finding[],
  roundNumber: number,
  config: Config,
  onEvent: PipelineEventEmitter,
): Promise<DebateRound> {
  const challengeable = findings.filter(
    (f) => f.severity === 'Medium' || f.severity === 'High' || f.severity === 'Critical',
  );

  onEvent({ type: 'agent:thinking', agent: 'skeptic', message: 'Challenging findings...' });
  const challenges = await withTimeout(
    challengeFindings(challengeable, config.skepticModel),
    DEBATE_CALL_TIMEOUT_MS,
    'skeptic:challenge',
  );
  onEvent({ type: 'skeptic:challenge', challenges });

  const rebuttals = await Promise.all(
    challenges.map(async (challenge) => {
      const finding = findings.find((f) => f.id === challenge.findingId);
      if (!finding) return null;
      try {
        return await getRebuttal(finding, challenge, config.specialistModel);
      } catch {
        // If a single rebuttal times out, skip it rather than failing the whole round
        return { findingId: finding.id, agent: finding.agent as AgentType, defense: '[Rebuttal timed out]' };
      }
    }),
  );

  const validRebuttals = rebuttals.filter((r): r is SpecialistRebuttal => r !== null);
  onEvent({ type: 'specialist:rebuttal', rebuttals: validRebuttals });

  onEvent({ type: 'agent:thinking', agent: 'skeptic', message: 'Rating rebuttals...' });
  const ratings = await withTimeout(
    rateRebuttals(challenges, validRebuttals, config.skepticModel),
    DEBATE_CALL_TIMEOUT_MS,
    'skeptic:rating',
  );

  const convincingIds = new Set(
    ratings.filter((r) => r.rating === 'convincing').map((r) => r.findingId),
  );
  const challengedIds = new Set(challenges.map((c) => c.findingId));
  const survivingAfterRound = findings.filter(
    (f) => !challengedIds.has(f.id) || convincingIds.has(f.id),
  );

  onEvent({ type: 'skeptic:rating', ratings, survivingCount: survivingAfterRound.length });

  return { round: roundNumber, challenges, rebuttals: validRebuttals, ratings };
}

export async function runDebate(
  findings: Finding[],
  config: Config,
  onEvent: PipelineEventEmitter = () => {},
): Promise<DebateState> {
  const rounds: DebateRound[] = [];
  let currentFindings = findings;

  for (let i = 1; i <= config.maxDebateRounds; i++) {
    onEvent({ type: 'debate:round:start', round: i });
    const round = await runDebateRound(currentFindings, i, config, onEvent);
    rounds.push(round);

    const convincingIds = new Set(
      round.ratings
        .filter((r) => r.rating === 'convincing')
        .map((r) => r.findingId),
    );
    const challengedIds = new Set(round.challenges.map((c) => c.findingId));

    currentFindings = currentFindings.filter(
      (f) => !challengedIds.has(f.id) || convincingIds.has(f.id),
    );

    onEvent({ type: 'debate:round:end', round: i, survivingFindings: currentFindings });
  }

  return { rounds, survivingFindings: currentFindings };
}
