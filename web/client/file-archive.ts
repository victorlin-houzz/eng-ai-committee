import { buildAuthorizedPath, getRunAccessToken } from './run-access.js';

export interface HistorySummary {
  runId: string;
  filename: string;
  verdict: string;
  confidence: number;
  createdAt: number;
}

export interface HistoryDetail extends HistorySummary {
  editedDoc: string;
  resultJson: any;
}

export class FileArchive {
  private listEl: HTMLElement;
  private detailEl: HTMLElement;
  private onLoadDoc?: (doc: HistoryDetail) => void;

  constructor(listEl: HTMLElement, detailEl: HTMLElement) {
    this.listEl = listEl;
    this.detailEl = detailEl;
    this.setupDetailClose();
  }

  onLoad(cb: (doc: HistoryDetail) => void): void {
    this.onLoadDoc = cb;
  }

  async refresh(): Promise<void> {
    try {
      const res = await fetch('/api/history');
      const items: HistorySummary[] = await res.json();
      this.render(items);
    } catch {
      this.listEl.innerHTML = '<div style="font-size:5px;color:#666;padding:8px">No history yet</div>';
    }
  }

  addEntry(summary: HistorySummary): void {
    this.renderItem(summary, true);
  }

  private render(items: HistorySummary[]): void {
    this.listEl.innerHTML = '';
    if (items.length === 0) {
      this.listEl.innerHTML = '<div style="font-size:5px;color:#666;padding:8px">No reviews yet</div>';
      return;
    }
    for (const item of items) this.renderItem(item, false);
  }

  private renderItem(item: HistorySummary, prepend: boolean): void {
    const el = document.createElement('div');
    el.className = 'archive-item';
    el.dataset.runId = item.runId;

    const date = new Date(item.createdAt).toLocaleDateString();
    const safeVerdict = ['Pass', 'Revise', 'Reject'].includes(item.verdict) ? item.verdict : 'Revise';
    el.innerHTML = `
      <div class="archive-item-name">${escapeHtml(item.filename)}</div>
      <div class="archive-item-meta">
        <span class="archive-item-date">${escapeHtml(date)}</span>
        <span class="verdict-badge ${safeVerdict}">${escapeHtml(safeVerdict)}</span>
      </div>
    `;
    el.addEventListener('click', () => this.openDetail(item.runId, el));

    if (prepend && this.listEl.firstChild) {
      this.listEl.insertBefore(el, this.listEl.firstChild);
    } else {
      this.listEl.appendChild(el);
    }
  }

  private async openDetail(runId: string, clickedEl: HTMLElement): Promise<void> {
    this.listEl.querySelectorAll('.archive-item').forEach((e) => e.classList.remove('active'));
    clickedEl.classList.add('active');
    clickedEl.style.opacity = '0.6';

    try {
      const [detail, images]: [HistoryDetail, Array<{ index: number; dataUrl: string }>] =
        await Promise.all([
          fetch(buildAuthorizedPath(`/api/history/${runId}`, runId)).then((r) => r.json()),
          fetch(buildAuthorizedPath(`/api/history/${runId}/images`, runId)).then((r) => r.json()),
        ]);

      // Immediately restore the full review state — no extra button click needed
      this.onLoadDoc?.(detail);

      // Show a slim action drawer for secondary actions (log / export)
      this.renderActions(detail, images);
      this.detailEl.classList.add('open');
    } catch {
      alert('Failed to load review');
    } finally {
      clickedEl.style.opacity = '';
    }
  }

  private renderActions(detail: HistoryDetail, images: Array<{ index: number; dataUrl: string }>): void {
    const verdict = detail.resultJson?.verdict ?? {};

    this.detailEl.querySelector('#archive-detail-title')!.textContent = detail.filename;
    const safeVerdict = ['Pass', 'Revise', 'Reject'].includes(verdict.verdict) ? verdict.verdict : 'Revise';
    const safeConf = Number.isFinite(Number(verdict.confidence)) ? Math.max(0, Math.min(100, Number(verdict.confidence))) : null;
    this.detailEl.querySelector('#archive-detail-body')!.innerHTML = `
      <div class="detail-section">
        <div class="verdict-${safeVerdict}" style="font-size:12px;margin-bottom:4px">${escapeHtml(verdict.verdict ?? '-')}</div>
        <div style="font-size:5px;color:#888">Judge certainty: ${safeConf ?? '-'}%  ·  ${images.length} image${images.length !== 1 ? 's' : ''}</div>
      </div>
    `;

    const actions = this.detailEl.querySelector('#archive-detail-actions')!;
    actions.innerHTML = `
      <button class="pixel-btn" id="detail-view-log">📋 Pipeline Log</button>
      <button class="pixel-btn" id="detail-export-docx">Export DOCX</button>
      <button class="pixel-btn" id="detail-export-pdf">Export PDF</button>
    `;

    actions.querySelector('#detail-view-log')!.addEventListener('click', () => {
      (window as any).__openConvLog?.(detail.runId, detail.filename);
    });
    actions.querySelector('#detail-export-docx')!.addEventListener('click', () => triggerExport(detail.runId, 'docx'));
    actions.querySelector('#detail-export-pdf')!.addEventListener('click', () => triggerExport(detail.runId, 'pdf'));
  }

  private setupDetailClose(): void {
    const closeBtn = this.detailEl.querySelector('#archive-detail-close');
    closeBtn?.addEventListener('click', () => this.detailEl.classList.remove('open'));
  }
}

async function triggerExport(runId: string, format: 'docx' | 'pdf'): Promise<void> {
  const res = await fetch('/api/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ runId, format, fromArchive: true, accessToken: getRunAccessToken(runId) }),
  });
  if (!res.ok) { alert('Export failed'); return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `design-doc.${format}`;
  a.click();
  URL.revokeObjectURL(url);
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
