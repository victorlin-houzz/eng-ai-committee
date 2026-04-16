import { buildAuthorizedPath } from './run-access.js';

/**
 * Inline Log Tab — shows live pipeline events and progress in the right panel.
 * Reuses the `.convlog-*` CSS entry classes from convlog.css for styling.
 */

export type LogKind = 'pipeline_event' | 'chat_user' | 'chat_assistant' | 'progress';

interface LogEntry {
  ts: number;
  kind: LogKind;
  payload: unknown;
}

type FilterKind = 'all' | LogKind;

export class LogTab {
  private bodyEl: HTMLElement;
  private footerEl: HTMLElement;
  private allEntries: LogEntry[] = [];
  private activeFilter: FilterKind = 'all';
  private autoScroll = true;

  constructor(private panelEl: HTMLElement) {
    this.bodyEl = panelEl.querySelector('#log-panel-body')!;
    this.footerEl = panelEl.querySelector('#log-panel-footer')!;

    panelEl.querySelectorAll('.log-filter-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        panelEl.querySelectorAll('.log-filter-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeFilter = (btn as HTMLElement).dataset.filter as FilterKind;
        this.renderAll();
      });
    });

    this.bodyEl.addEventListener('scroll', () => {
      const { scrollTop, scrollHeight, clientHeight } = this.bodyEl;
      this.autoScroll = scrollHeight - scrollTop - clientHeight < 60;
    });
  }

  /** Append a single live event (payload is already a parsed object). */
  append(kind: LogKind, payload: unknown): void {
    const entry: LogEntry = { ts: Date.now(), kind, payload };
    this.allEntries.push(entry);
    if (this.activeFilter === 'all' || this.activeFilter === kind) {
      this.bodyEl.appendChild(this.renderEntry(entry));
      if (this.autoScroll) this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    }
    this.updateFooter();
  }

  /** Clear all entries (call before starting a new run). */
  clear(): void {
    this.allEntries = [];
    this.bodyEl.innerHTML = '';
    this.footerEl.textContent = '';
    this.autoScroll = true;
    this.activeFilter = 'all';
    this.panelEl.querySelectorAll('.log-filter-btn').forEach((b, i) => {
      b.classList.toggle('active', i === 0);
    });
  }

  /** Load all entries from DB for a run (used on recovery/rejoin). */
  async loadFromDb(runId: string): Promise<void> {
    try {
      const res = await fetch(buildAuthorizedPath(`/api/history/${runId}/log`, runId));
      const rows: Array<{ ts: number; kind: LogKind; payload: string }> = await res.json();
      this.allEntries = rows.map((r) => ({
        ts: r.ts,
        kind: r.kind,
        payload: (() => { try { return JSON.parse(r.payload); } catch { return { raw: r.payload }; } })(),
      }));
      this.renderAll();
    } catch {
      this.bodyEl.innerHTML = '<div style="font-size:7px;color:#666;padding:12px">Failed to load log</div>';
    }
  }

  private renderAll(): void {
    const entries = this.activeFilter === 'all'
      ? this.allEntries
      : this.allEntries.filter((e) => e.kind === this.activeFilter);
    this.bodyEl.innerHTML = '';
    for (const entry of entries) {
      this.bodyEl.appendChild(this.renderEntry(entry));
    }
    this.bodyEl.scrollTop = this.bodyEl.scrollHeight;
    this.updateFooter();
  }

  private updateFooter(): void {
    this.footerEl.textContent = `${this.allEntries.length} entries`;
  }

  private renderEntry(entry: LogEntry): HTMLElement {
    const el = document.createElement('div');
    el.className = `convlog-entry kind-${entry.kind}`;
    const tsStr = new Date(entry.ts).toLocaleTimeString('en-US', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    el.innerHTML = `
      <span class="convlog-ts">${tsStr}</span>
      <span class="convlog-kind">${formatKind(entry.kind)}</span>
      <span class="convlog-content">${this.formatPayload(entry.kind, entry.payload)}</span>
    `;
    return el;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private formatPayload(kind: LogKind, payload: any): string {
    if (kind === 'progress') return escapeHtml(payload?.message ?? '');
    if (kind === 'chat_user') return `<strong>You:</strong> ${escapeHtml(payload?.message ?? '')}`;
    if (kind === 'chat_assistant') {
      const text = (payload?.message ?? '').slice(0, 300);
      return `<strong>Judge:</strong> ${escapeHtml(text)}${(payload?.message ?? '').length > 300 ? '…' : ''}`;
    }
    const type: string = payload?.type ?? 'unknown';
    const agent = escapeHtml(payload.agent ?? '');
    const stage = escapeHtml(payload.stage ?? '');
    const sev = escapeHtml(payload.finding?.severity ?? '');
    const verdict = escapeHtml(payload.verdict?.verdict ?? '?');
    const pipelineVerdict = escapeHtml(payload.result?.verdict?.verdict ?? '?');
    const conf = Number.isFinite(Number(payload.verdict?.confidence)) ? Number(payload.verdict.confidence) : '-';
    switch (type) {
      case 'stage:start':          return `▶ Stage started: <strong>${stage}</strong>`;
      case 'agent:thinking':       return `💭 <strong>${agent}</strong>: ${escapeHtml(payload.message ?? '')}`;
      case 'agent:finding':        return `🔍 <strong>${agent}</strong> [${sev}]: ${escapeHtml(payload.finding?.title ?? '')}`;
      case 'agent:done':           return `✅ <strong>${agent}</strong> done — ${Number(payload.findingCount) || 0} finding(s)`;
      case 'agent:retry':          return `↺ <strong>${agent}</strong> retry #${Number(payload.attempt) || 0}: ${escapeHtml(payload.reason ?? '')}`;
      case 'agent:timeout':        return `⏱ <strong>${agent}</strong> timed out`;
      case 'dedup:complete':       return `🔗 Dedup: ${Number(payload.before) || 0} → ${Number(payload.after) || 0} findings`;
      case 'debate:round:start':   return `⚔ Debate round ${Number(payload.round) || 0} started`;
      case 'skeptic:challenge':    return `❓ Skeptic challenged ${payload.challenges?.length ?? 0} finding(s)`;
      case 'specialist:rebuttal':  return `💬 ${payload.rebuttals?.length ?? 0} rebuttal(s) submitted`;
      case 'skeptic:rating':       return `👍 Skeptic rated — ${Number(payload.survivingCount) || 0} surviving`;
      case 'debate:round:end':     return `🏁 Round ${Number(payload.round) || 0} ended — ${payload.survivingFindings?.length ?? 0} surviving`;
      case 'judge:thinking':       return `⚖ Judge deliberating…`;
      case 'judge:verdict':        return `⚖ <strong>Verdict: ${verdict}</strong> (judge certainty: ${conf}%)`;
      case 'pipeline:complete':    return `🎉 Pipeline complete — ${pipelineVerdict}`;
      case 'pipeline:error':       return `❌ Error: ${escapeHtml(payload.message ?? '')}`;
      default:                     return escapeHtml(JSON.stringify(payload).slice(0, 120));
    }
  }
}

function formatKind(kind: LogKind): string {
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
