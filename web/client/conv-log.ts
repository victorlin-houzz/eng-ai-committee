import { buildAuthorizedPath } from './run-access.js';

/**
 * Conversation Log Dialog
 * Shows full pipeline event timeline + chat transcript for a given run.
 * Accessible from the Archive detail panel.
 */

export interface LogEntry {
  id: number;
  runId: string;
  ts: number;
  kind: 'pipeline_event' | 'chat_user' | 'chat_assistant' | 'progress';
  payload: string;
}

type FilterKind = 'all' | LogEntry['kind'];

export class ConvLogDialog {
  private overlayEl: HTMLElement;
  private bodyEl: HTMLElement;
  private footerEl: HTMLElement;
  private titleEl: HTMLElement;
  private allEntries: LogEntry[] = [];
  private activeFilter: FilterKind = 'all';

  constructor() {
    this.overlayEl = document.getElementById('convlog-overlay')!;
    this.bodyEl = document.getElementById('convlog-body')!;
    this.footerEl = document.getElementById('convlog-footer')!;
    this.titleEl = document.getElementById('convlog-title')!;

    document.getElementById('convlog-close')?.addEventListener('click', () => this.close());
    this.overlayEl.addEventListener('click', (e) => {
      if (e.target === this.overlayEl) this.close();
    });

    // Filter buttons
    document.querySelectorAll('.convlog-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.convlog-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = (btn as HTMLElement).dataset.filter as FilterKind;
        this.renderEntries();
      });
    });
  }

  async open(runId: string, filename: string): Promise<void> {
    this.titleEl.textContent = `📋 CONVERSATION LOG — ${filename}`;
    this.bodyEl.innerHTML = '<div style="font-size:7px;color:#666;padding:12px">Loading...</div>';
    this.overlayEl.classList.add('open');
    this.activeFilter = 'all';
    document.querySelectorAll('.convlog-filter-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
    });

    try {
      const res = await fetch(buildAuthorizedPath(`/api/history/${runId}/log`, runId));
      this.allEntries = await res.json();
      this.footerEl.textContent = `${this.allEntries.length} log entries for run ${runId.slice(0, 8)}…`;
      this.renderEntries();
    } catch {
      this.bodyEl.innerHTML = '<div style="font-size:7px;color:#f44336;padding:12px">Failed to load log</div>';
    }
  }

  close(): void {
    this.overlayEl.classList.remove('open');
  }

  private renderEntries(): void {
    const entries = this.activeFilter === 'all'
      ? this.allEntries
      : this.allEntries.filter((e) => e.kind === this.activeFilter);

    if (entries.length === 0) {
      this.bodyEl.innerHTML = '<div style="font-size:7px;color:#666;padding:12px">No entries match this filter</div>';
      return;
    }

    this.bodyEl.innerHTML = '';
    for (const entry of entries) {
      this.bodyEl.appendChild(this.renderEntry(entry));
    }
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
  }

  private renderEntry(entry: LogEntry): HTMLElement {
    const el = document.createElement('div');
    el.className = `convlog-entry kind-${entry.kind}`;

    const ts = new Date(entry.ts);
    const tsStr = ts.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let payload: any;
    try { payload = JSON.parse(entry.payload); } catch { payload = { raw: entry.payload }; }

    const content = this.formatPayload(entry.kind, payload);

    el.innerHTML = `
      <span class="convlog-ts">${tsStr}</span>
      <span class="convlog-kind">${formatKind(entry.kind)}</span>
      <span class="convlog-content">${content}</span>
    `;
    return el;
  }

  private formatPayload(kind: LogEntry['kind'], payload: any): string {
    if (kind === 'progress') {
      return escapeHtml(payload.message ?? '');
    }
    if (kind === 'chat_user') {
      return `<strong>You:</strong> ${escapeHtml(payload.message ?? '')}`;
    }
    if (kind === 'chat_assistant') {
      const text = (payload.message ?? '').slice(0, 300);
      return `<strong>Judge:</strong> ${escapeHtml(text)}${(payload.message ?? '').length > 300 ? '…' : ''}`;
    }
    // pipeline_event — format by event type
    const type: string = payload.type ?? 'unknown';
    const agent = escapeHtml(payload.agent ?? '');
    const stage = escapeHtml(payload.stage ?? '');
    const sev = escapeHtml(payload.finding?.severity ?? '');
    const verdict = escapeHtml(payload.verdict?.verdict ?? '?');
    const pipelineVerdict = escapeHtml(payload.result?.verdict?.verdict ?? '?');
    const conf = Number.isFinite(Number(payload.verdict?.confidence)) ? Number(payload.verdict.confidence) : '-';
    switch (type) {
      case 'stage:start':
        return `▶ Stage started: <strong>${stage}</strong>`;
      case 'agent:thinking':
        return `💭 <strong>${agent}</strong>: ${escapeHtml(payload.message ?? '')}`;
      case 'agent:finding':
        return `🔍 <strong>${agent}</strong> [${sev}]: ${escapeHtml(payload.finding?.title ?? '')}`;
      case 'agent:done':
        return `✅ <strong>${agent}</strong> done — ${Number(payload.findingCount) || 0} finding(s)`;
      case 'agent:retry':
        return `↺ <strong>${agent}</strong> retry #${Number(payload.attempt) || 0}: ${escapeHtml(payload.reason ?? '')}`;
      case 'agent:timeout':
        return `⏱ <strong>${agent}</strong> timed out`;
      case 'dedup:complete':
        return `🔗 Dedup: ${Number(payload.before) || 0} → ${Number(payload.after) || 0} findings`;
      case 'debate:round:start':
        return `⚔ Debate round ${Number(payload.round) || 0} started`;
      case 'skeptic:challenge':
        return `❓ Skeptic challenged ${payload.challenges?.length ?? 0} finding(s)`;
      case 'specialist:rebuttal':
        return `💬 ${payload.rebuttals?.length ?? 0} rebuttal(s) submitted`;
      case 'skeptic:rating':
        return `👍 Skeptic rated — ${Number(payload.survivingCount) || 0} surviving`;
      case 'debate:round:end':
        return `🏁 Round ${Number(payload.round) || 0} ended — ${payload.survivingFindings?.length ?? 0} surviving`;
      case 'judge:thinking':
        return `⚖ Judge deliberating…`;
      case 'judge:verdict':
        return `⚖ <strong>Verdict: ${verdict}</strong> (${conf}% confidence)`;
      case 'pipeline:complete':
        return `🎉 Pipeline complete — ${pipelineVerdict}`;
      case 'pipeline:error':
        return `❌ Error: ${escapeHtml(payload.message ?? '')}`;
      default:
        return escapeHtml(JSON.stringify(payload).slice(0, 120));
    }
  }
}

function formatKind(kind: LogEntry['kind']): string {
  const map: Record<string, string> = {
    pipeline_event: 'Pipeline',
    progress:       'Progress',
    chat_user:      'You',
    chat_assistant: 'Judge',
  };
  return map[kind] ?? kind;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
