import type { JudgeVerdict } from '../../src/types.js';
import type { AgentCharacter } from './agents.js';

const CONFETTI_COLORS = ['#ffd700', '#4caf50', '#2196f3', '#e91e63', '#ff9800', '#9c27b0'];

export class JudgeReveal {
  private bannerEl: HTMLElement;
  private dimEl: HTMLElement;
  private roomEl: HTMLElement;
  private confettiContainer: HTMLElement;

  constructor(roomEl: HTMLElement) {
    this.roomEl = roomEl;

    this.dimEl = document.createElement('div');
    this.dimEl.id = 'room-dim';
    roomEl.appendChild(this.dimEl);

    this.bannerEl = document.createElement('div');
    this.bannerEl.id = 'verdict-banner';
    roomEl.appendChild(this.bannerEl);

    this.confettiContainer = document.createElement('div');
    this.confettiContainer.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:60;overflow:hidden;';
    roomEl.appendChild(this.confettiContainer);
  }

  async reveal(
    verdict: JudgeVerdict,
    judge: AgentCharacter,
    allAgents: AgentCharacter[],
  ): Promise<void> {
    // Dim the room
    this.dimEl.classList.add('dimmed');
    judge.setState('thinking');

    await sleep(1500);

    // Un-dim
    this.dimEl.classList.remove('dimmed');

    // Show verdict banner
    const verdictColor = verdict.verdict === 'Pass' ? '#4caf50' :
                         verdict.verdict === 'Revise' ? '#ff9800' : '#f44336';

    const blockingSummary = buildBlockingSummary(verdict.topBlockingIssues);

    this.bannerEl.innerHTML = `
      <span class="verdict-word verdict-${verdict.verdict}" style="color:${verdictColor}">
        ${verdict.verdict.toUpperCase()}
      </span>
      <div class="verdict-confidence">Judge certainty: ${verdict.confidence}%</div>
      ${blockingSummary
        ? `<div style="margin-top:6px;font-size:5px;color:#9090a0">${blockingSummary}</div>`
        : ''}
    `;
    this.bannerEl.classList.add('visible');

    // Animate agents based on verdict
    for (const agent of allAgents) {
      if (agent.id === 'judge') {
        agent.setState('celebrating', `Verdict: ${verdict.verdict}`);
      } else if (verdict.verdict === 'Pass') {
        agent.setState('celebrating', '✓ Approved!');
      } else if (verdict.verdict === 'Reject') {
        agent.setState('error', 'Rejected');
      } else {
        agent.setState('done', 'Needs revision');
      }
    }

    // Confetti for Pass
    if (verdict.verdict === 'Pass') {
      this.spawnConfetti();
    }

    // Shake for Reject
    if (verdict.verdict === 'Reject') {
      this.roomEl.style.animation = 'shake 0.4s ease-in-out';
      setTimeout(() => { this.roomEl.style.animation = ''; }, 500);
    }
  }

  reset(): void {
    this.bannerEl.classList.remove('visible');
    this.dimEl.classList.remove('dimmed');
    this.confettiContainer.innerHTML = '';
  }

  private spawnConfetti(): void {
    for (let i = 0; i < 40; i++) {
      const el = document.createElement('div');
      el.className = 'confetti';
      el.style.cssText = `
        left: ${Math.random() * 100}%;
        top: ${Math.random() * 30}%;
        background: ${CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)]};
        animation-delay: ${Math.random() * 0.6}s;
        animation-duration: ${0.8 + Math.random() * 0.8}s;
        width: ${4 + Math.floor(Math.random() * 8)}px;
        height: ${4 + Math.floor(Math.random() * 8)}px;
      `;
      this.confettiContainer.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  }
}

function buildBlockingSummary(issues: JudgeVerdict['topBlockingIssues']): string {
  if (!issues || issues.length === 0) return '';
  const critical = issues.filter((f) => f.severity === 'Critical').length;
  const high = issues.filter((f) => f.severity === 'High').length;
  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} Critical`);
  if (high > 0) parts.push(`${high} High`);
  const rest = issues.length - critical - high;
  if (rest > 0) parts.push(`${rest} other`);
  return `Blocking: ${parts.join(', ')}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
