import { callAgent } from './base.js';
import type { DebateState, Finding, JudgeVerdict, Severity, StructuralCheckResult, Verdict } from '../../types.js';

const SYSTEM_PROMPT = `You are the final judge synthesizing a multi-agent design document review.
You will receive:
1. The full debate history (specialist findings, skeptic challenges, specialist rebuttals, skeptic ratings)
2. The structural check result

WRITING RULES (must follow):
- Write for non-native English readers.
- Use plain English words.
- Avoid idioms and metaphors.
- Use active voice.
- Keep each sentence short (about 15-20 words max).
- Keep one idea per sentence.
- Avoid nested clauses and dense phrasing.
- Use the same term for the same concept across the full response.
- Avoid vague words like "concerns", "issues", "signal", "framing", and "gap" unless you explain them.
- For Revise/Reject text, every point must include: (a) what is missing or wrong, (b) impact, (c) fix.
- Avoid process commentary (for example, "signal-to-noise was high").
- Prefer bullet lists over dense paragraphs.

VERDICT RULES (enforced in code — do not deviate):
- Missing required sections → Reject
- 2+ Critical findings survived debate → Reject
- 1+ Critical OR 2+ High survived → Revise
- 1 High + 0 Critical survived → Revise
- 0 High/Critical, ≤2 Medium survived → Pass

CONFIDENCE CALIBRATION (be honest, not flattering):
- 85–100: All surviving findings rated "convincing" with high skeptic confidence; verdict is unambiguous under the rules
- 65–84: Most surviving findings convincing; one borderline call or a verdict close to a threshold
- 45–64: Mixed debate quality; several "unconvincing" ratings kept findings alive, or verdict was close to flipping
- 25–44: Significant uncertainty — many findings dropped via weak rebuttals, or inputs were incomplete

ANTI-BIAS RULES:
- Do not soften the verdict because the document is well-written or ambitious
- Do not inflate confidence because the debate process was clean
- The verdict is driven by surviving findings, not the quality of the writing
- A finding rated "unconvincing" survived because the challenge failed — do not treat it as a validated strong finding

OUTPUT FORMAT (JSON):
{
  "verdict": "Pass" | "Revise" | "Reject",
  "confidence": 0-100,
  "topBlockingIssues": [...up to 5 surviving High/Critical Finding objects...],
  "committeeBrief": "(Pass only) short plain-language explanation: what the system does, key choices, and why it passed",
  "revisionMemo": "(Revise/Reject only) plain-language bullet list grouped by severity. Each bullet must include Problem: <...>. Impact: <...>. Fix: <...>.",
  "agentDebateSummary": "Plain-language bullet list (max 8 bullets). Keep to concrete surviving findings and why they matter. No process commentary."
}

Return only the JSON object.`;

function enforceVerdictTable(
  survivingFindings: Finding[],
  structuralCheck: StructuralCheckResult,
): Verdict {
  if (!structuralCheck.pass) return 'Reject';
  const critical = survivingFindings.filter((f) => f.severity === 'Critical').length;
  const high = survivingFindings.filter((f) => f.severity === 'High').length;
  if (critical >= 2) return 'Reject';
  if (critical >= 1 || high >= 2) return 'Revise';
  if (high === 1) return 'Revise';
  return 'Pass';
}

function topByServerity(findings: Finding[]): Finding[] {
  const severityOrder: Record<Severity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };
  return [...findings]
    .filter((f) => f.severity === 'High' || f.severity === 'Critical')
    .sort((a, b) => severityOrder[b.severity] - severityOrder[a.severity])
    .slice(0, 5);
}

const JUDGE_TIMEOUT_MS = 600_000;
const JUDGE_MAX_ATTEMPTS = 2;

export async function runJudge(
  debateState: DebateState,
  structuralCheck: StructuralCheckResult,
  model: string,
): Promise<JudgeVerdict> {
  const userPrompt = `Structural check result:\n${JSON.stringify(structuralCheck, null, 2)}\n\nFull debate state:\n${JSON.stringify(debateState, null, 2)}\n\nProduce the final JudgeVerdict JSON.`;

  let lastError: unknown;
  for (let attempt = 1; attempt <= JUDGE_MAX_ATTEMPTS; attempt++) {
    try {
      const raw = await Promise.race([
        callAgent(SYSTEM_PROMPT, userPrompt, model, 'medium'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Judge timed out after ${JUDGE_TIMEOUT_MS}ms`)), JUDGE_TIMEOUT_MS),
        ),
      ]);

      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      let verdict: JudgeVerdict;
      if (jsonMatch) {
        try {
          verdict = JSON.parse(jsonMatch[0]) as JudgeVerdict;
        } catch {
          verdict = buildFallbackVerdict(debateState, structuralCheck);
        }
      } else {
        verdict = buildFallbackVerdict(debateState, structuralCheck);
      }

      verdict.verdict = enforceVerdictTable(debateState.survivingFindings, structuralCheck);
      verdict.topBlockingIssues = topByServerity(debateState.survivingFindings);
      return verdict;
    } catch (err) {
      lastError = err;
    }
  }

  // All attempts failed — return deterministic fallback so pipeline always completes
  console.warn(`[judge] all ${JUDGE_MAX_ATTEMPTS} attempts failed, using fallback verdict:`, lastError);
  return buildFallbackVerdict(debateState, structuralCheck);
}

function buildFallbackVerdict(
  debateState: DebateState,
  structuralCheck: StructuralCheckResult,
): JudgeVerdict {
  const verdict = enforceVerdictTable(debateState.survivingFindings, structuralCheck);
  return {
    verdict,
    confidence: 50,
    topBlockingIssues: topByServerity(debateState.survivingFindings),
    agentDebateSummary: `${debateState.survivingFindings.length} findings survived debate across ${debateState.rounds.length} round(s).`,
    revisionMemo: verdict !== 'Pass' ? 'See blocking issues above.' : undefined,
    committeeBrief: verdict === 'Pass' ? 'Document passed review. See findings for minor suggestions.' : undefined,
  };
}
