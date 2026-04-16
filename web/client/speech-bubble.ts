/**
 * Manages thinking + speech bubbles for agent characters.
 */
export class BubbleManager {
  private wrap: HTMLElement;
  private thinkEl: HTMLElement;
  private speechEl: HTMLElement;
  private dismissTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(agentEl: HTMLElement) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'bubble-wrap';

    this.thinkEl = document.createElement('div');
    this.thinkEl.className = 'bubble-think';
    this.thinkEl.innerHTML = `<div class="dots"><span></span><span></span><span></span></div>`;

    this.speechEl = document.createElement('div');
    this.speechEl.className = 'bubble-speech';

    this.wrap.appendChild(this.thinkEl);
    this.wrap.appendChild(this.speechEl);
    agentEl.appendChild(this.wrap);
  }

  showThinking(): void {
    this.clearTimer();
    this.thinkEl.style.display = 'block';
    this.speechEl.style.display = 'none';
    this.wrap.classList.add('visible');
  }

  showSpeech(text: string, severity?: string, autoDismiss = 5000): void {
    this.clearTimer();

    let content = '';
    if (severity) {
      const safeSev = ['Low', 'Medium', 'High', 'Critical'].includes(severity) ? severity : 'Low';
      content += `<span class="bubble-sev sev-${safeSev}">${escapeHtml(safeSev)}</span><br>`;
    }
    content += escapeHtml(text).slice(0, 120) + (text.length > 120 ? '…' : '');
    this.speechEl.innerHTML = content;

    this.thinkEl.style.display = 'none';
    this.speechEl.style.display = 'block';
    this.wrap.classList.add('visible');

    if (autoDismiss > 0) {
      this.dismissTimer = setTimeout(() => this.hide(), autoDismiss);
    }
  }

  hide(): void {
    this.clearTimer();
    this.wrap.classList.remove('visible');
  }

  private clearTimer(): void {
    if (this.dismissTimer !== null) {
      clearTimeout(this.dismissTimer);
      this.dismissTimer = null;
    }
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
