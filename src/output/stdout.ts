import chalk, { type ChalkInstance } from 'chalk';
import type { Finding, JudgeVerdict, RevisionResult, Verdict } from '../types.js';
import type { PipelineResult } from '../pipeline/orchestrator.js';

function verdictColor(verdict: Verdict): ChalkInstance {
  switch (verdict) {
    case 'Pass': return chalk.green;
    case 'Revise': return chalk.yellow;
    case 'Reject': return chalk.red;
  }
}

function severityColor(severity: string): ChalkInstance {
  switch (severity) {
    case 'Critical': return chalk.bgRed.white;
    case 'High': return chalk.red;
    case 'Medium': return chalk.yellow;
    default: return chalk.gray;
  }
}

function box(text: string, color: ChalkInstance): string {
  const width = text.length + 4;
  const bar = '═'.repeat(width);
  return [
    color(`╔${bar}╗`),
    color(`║  ${text}  ║`),
    color(`╚${bar}╝`),
  ].join('\n');
}

function formatFinding(f: Finding, label?: string): string {
  const lines: string[] = [];
  lines.push(`  ${severityColor(f.severity)(`[${f.severity}]`)} ${chalk.bold(f.title)}`);
  if (label) lines.push(`    ${chalk.dim(label)}`);
  lines.push(`    ${chalk.italic.dim(`"${f.excerpt.slice(0, 120)}${f.excerpt.length > 120 ? '...' : ''}"`)}`);
  lines.push(`    ${chalk.cyan('Fix:')} ${f.recommendation}`);
  return lines.join('\n');
}

export function printResult(result: PipelineResult): void {
  const { verdict } = result;
  const color = verdictColor(verdict.verdict);

  console.log('');
  console.log(box(`VERDICT: ${verdict.verdict}  (${verdict.confidence}% confidence)`, color));
  console.log('');

  // Blocking issues
  if (verdict.topBlockingIssues.length > 0) {
    console.log(chalk.bold(`BLOCKING ISSUES (${verdict.topBlockingIssues.length}):`));
    for (const f of verdict.topBlockingIssues) {
      console.log(formatFinding(f));
      console.log('');
    }
  }

  // Debate summary
  if (verdict.agentDebateSummary) {
    console.log(chalk.bold('DEBATE SUMMARY:'));
    console.log(chalk.dim(verdict.agentDebateSummary));
    console.log('');
  }

  // All-findings stats
  if (result.allFindings.length > 0) {
    const total = result.allFindings.length;
    const surviving = verdict.topBlockingIssues.length;
    console.log(chalk.dim(`Total findings: ${total} → ${surviving} survived debate`));
  }

  if (result.skippedAgents.length > 0) {
    console.log(chalk.yellow(`⚠  Agents that failed: ${result.skippedAgents.join(', ')}`));
  }

  console.log('');

  // Revision memo or committee brief
  if (verdict.revisionMemo) {
    console.log(chalk.bold('REVISION MEMO:'));
    console.log(verdict.revisionMemo);
    console.log('');
  }

  if (verdict.committeeBrief) {
    console.log(chalk.bold('COMMITTEE BRIEF:'));
    console.log(verdict.committeeBrief);
    console.log('');
  }
}

export function printJson(result: PipelineResult): void {
  console.log(JSON.stringify(result, null, 2));
}

export function printStructuralReject(missingSections: string[]): void {
  console.log('');
  console.log(box('VERDICT: REJECT  (structural pre-check failed)', chalk.red));
  console.log('');
  console.log(chalk.bold('Missing required sections:'));
  for (const s of missingSections) {
    console.log(`  ${chalk.red('✗')} ${s}`);
  }
  console.log('');
  console.log(chalk.dim('Add the missing sections and resubmit.'));
}

export function printFinding(f: Finding): void {
  console.log(formatFinding(f));
}

export function printRevisionResult(revision: RevisionResult): void {
  console.log('');
  console.log(chalk.bold('REVISION COMPLETE'));
  console.log('');

  // Sign-off summary table
  if (revision.signOffs.length > 0) {
    console.log(chalk.bold('SPECIALIST SIGN-OFF:'));
    for (const s of revision.signOffs) {
      const icon = s.addressed ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${icon} ${chalk.bold(s.agent)}`);
      if (!s.addressed && s.unaddressedConcerns.length > 0) {
        for (const c of s.unaddressedConcerns) {
          console.log(`      ${chalk.yellow('·')} ${c}`);
        }
      }
    }
    console.log('');
  }

  const allSigned = revision.signOffs.every((s) => s.addressed);
  if (allSigned) {
    console.log(chalk.green(`All specialists signed off after ${revision.iterations} iteration(s).`));
  } else {
    const unsigned = revision.signOffs.filter((s) => !s.addressed).length;
    console.log(chalk.yellow(`${unsigned} specialist(s) have remaining concerns after ${revision.iterations} iteration(s).`));
  }

  console.log('');
  console.log(chalk.bold('Revised document written to:'));
  console.log(`  ${chalk.cyan(revision.outputPath)}`);
}
