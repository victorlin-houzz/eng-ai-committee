import './styles/main.css';
import './styles/room.css';
import './styles/agents.css';
import './styles/editor.css';
import './styles/archive.css';
import './styles/chat.css';
import './styles/convlog.css';
import './styles/help.css';
import './styles/findings-modal.css';
import type { Finding } from '../../src/types.js';

import { createSocketClient } from './socket-client.js';
import { createAgents, type AgentId } from './agents.js';
import { DebateVisualizer } from './debate-visualizer.js';
import { JudgeReveal } from './judge-reveal.js';
import { Editor, setupUploadZone, uploadFile } from './editor.js';
import { FileArchive } from './file-archive.js';
import { setupExportPanel } from './export-panel.js';
import { ConvLogDialog } from './conv-log.js';
import { LogTab } from './log-tab.js';
import { buildAuthorizedPath, getRunAccessToken, rememberRunAccess } from './run-access.js';
import type { PipelineEvent } from './socket-client.js';

// ── Current session state ─────────────────────────────────────────────
let currentRunId = '';
let currentFilename = '';
let currentDocText = ''; // raw fallback in case CodeMirror init fails

const RIGHT_PANEL_WIDTH_KEY = 'eng-committee-right-panel-width';

// ── Socket ────────────────────────────────────────────────────────────
const socket = createSocketClient();

// ── Room ──────────────────────────────────────────────────────────────
const roomEl = document.getElementById('room')!;
setupRightPanelResizer();

// Inject room decorations FIRST, then query the elements they create
roomEl.insertAdjacentHTML('afterbegin', `
  <div id="room-floor"></div>
  <div id="room-wall"></div>
  <div id="room-bookshelf"></div>
  <div id="room-window"></div>
  <div id="round-table"></div>
  <svg id="debate-overlay" style="position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:20;"></svg>
  <div id="stage-indicator">WAITING FOR REVIEW</div>
`);

// Query AFTER insertAdjacentHTML so these elements actually exist
const overlayEl = document.getElementById('debate-overlay')!;
const stageIndicatorEl = document.getElementById('stage-indicator')!;

const agents = createAgents(roomEl);
const debateViz = new DebateVisualizer(roomEl.querySelector('#debate-overlay')!);
const judgeReveal = new JudgeReveal(roomEl);

// Wire up agent click handlers
for (const [id, char] of agents) {
  setupAgentClick(id, char.el);
}

// ── Per-agent findings accumulator ────────────────────────────────────
const agentFindings = new Map<string, Finding[]>();       // agentId → findings
const findingsById  = new Map<string, Finding>();          // findingId → finding (for debate lookup)
let   lastAgentDetail: { agentId: string; label: string } | null = null;

// ── Debate & verdict state (for Skeptic/Judge/Report modals) ──────────
interface DebateRecord {
  findingId: string;
  challenge: string;
  rebuttal?: string;
  rebuttalAgent?: string;
  rating?: 'convincing' | 'unconvincing';
  ratingReasoning?: string;
}
const debateRecords = new Map<string, DebateRecord>();
let latestVerdict: any = null;


// ── HTML escape for untrusted LLM/user content ────────────────────────
// Any string sourced from LLM responses or user uploads MUST be escaped
// before being inserted via innerHTML — prompt-injected docs can try to
// emit <script>/onerror handlers in finding fields.
function esc(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Allow known severity values through as-is (used in CSS class names);
// anything unexpected is coerced to a safe default.
const VALID_SEV = new Set(['Low', 'Medium', 'High', 'Critical']);
function safeSev(s: unknown): string {
  const v = String(s ?? '');
  return VALID_SEV.has(v) ? v : 'Low';
}

// ── Findings modal helpers ─────────────────────────────────────────────
const SEV_COLOR: Record<string, string> = {
  Low: 'var(--color-low)', Medium: 'var(--color-medium)',
  High: 'var(--color-high)', Critical: 'var(--color-critical)',
};

function openFindingsModal(agentLabel: string, findings: Finding[]): void {
  const overlay  = document.getElementById('findings-overlay')!;
  const titleEl  = document.getElementById('findings-title')!;
  const bodyEl   = document.getElementById('findings-body')!;

  titleEl.textContent = `${agentLabel} — ${findings.length} finding${findings.length !== 1 ? 's' : ''}`;
  bodyEl.innerHTML = '';

  for (const f of findings) {
    const sev = safeSev(f.severity);
    const color = SEV_COLOR[sev] ?? 'var(--color-text)';
    const card = document.createElement('div');
    card.className = 'finding-card';
    card.innerHTML = `
      <div class="finding-card-header">
        <span class="finding-sev-badge sev-${sev}" style="color:${color};border-color:${color}">${esc(sev.toUpperCase())}</span>
        <span class="finding-title">${esc(f.title)}</span>
      </div>
      <div class="finding-detail">${esc(f.description)}</div>
      ${f.excerpt ? `<div class="finding-excerpt">"${esc(f.excerpt)}"</div>` : ''}
      <div class="finding-rec">${esc(f.recommendation)}</div>
    `;
    bodyEl.appendChild(card);
  }

  overlay.classList.add('open');
}

function setupRightPanelResizer(): void {
  const contentEl = document.getElementById('content');
  const resizerEl = document.getElementById('panel-resizer');
  if (!contentEl || !resizerEl) return;

  const applyWidth = (widthPx: number) => {
    document.documentElement.style.setProperty('--right-panel-width', `${widthPx}px`);
  };

  const clampWidth = (candidate: number): number => {
    const rect = contentEl.getBoundingClientRect();
    const min = 280;
    const max = Math.max(min, rect.width - 360);
    return Math.min(Math.max(candidate, min), max);
  };

  const saved = Number.parseInt(localStorage.getItem(RIGHT_PANEL_WIDTH_KEY) ?? '', 10);
  if (Number.isFinite(saved)) {
    applyWidth(clampWidth(saved));
  } else {
    const rect = contentEl.getBoundingClientRect();
    applyWidth(clampWidth(Math.round((rect.width - resizerEl.getBoundingClientRect().width) * 0.4)));
  }

  window.addEventListener('resize', () => {
    const current = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-panel-width'), 10);
    if (Number.isFinite(current)) applyWidth(clampWidth(current));
  });

  const onPointerDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    contentEl.classList.add('resizing');

    const onPointerMove = (moveEv: PointerEvent) => {
      const rect = contentEl.getBoundingClientRect();
      const raw = rect.right - moveEv.clientX;
      applyWidth(clampWidth(raw));
    };

    const onPointerUp = () => {
      contentEl.classList.remove('resizing');
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      const current = Number.parseInt(getComputedStyle(document.documentElement).getPropertyValue('--right-panel-width'), 10);
      if (Number.isFinite(current)) localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(current));
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  resizerEl.addEventListener('pointerdown', onPointerDown);
}

document.getElementById('findings-close')?.addEventListener('click', () => {
  document.getElementById('findings-overlay')!.classList.remove('open');
});
document.getElementById('findings-overlay')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('findings-overlay')) {
    document.getElementById('findings-overlay')!.classList.remove('open');
  }
});

// ── Skeptic modal ──────────────────────────────────────────────────────
function openSkepticModal(): void {
  const bodyEl = document.getElementById('skeptic-body')!;
  bodyEl.innerHTML = '';

  if (debateRecords.size === 0) {
    bodyEl.innerHTML = '<div style="font-size:9px;color:var(--color-text-dim);padding:12px">No debate data yet.</div>';
  } else {
    for (const rec of debateRecords.values()) {
      const finding = findingsById.get(rec.findingId);
      const title = finding?.title ?? rec.findingId;
      const safeRating = rec.rating === 'convincing' || rec.rating === 'unconvincing' ? rec.rating : '';
      const ratingCls = safeRating ? `verdict-${safeRating}` : '';
      const agentLabel = (rec.rebuttalAgent ?? 'SPECIALIST').replace(/_/g, '-').toUpperCase();
      const card = document.createElement('div');
      card.className = 'debate-card';
      card.innerHTML = `
        <div class="debate-card-title">${esc(title)}</div>
        <div class="debate-card-row">
          <div class="debate-card-who skeptic-who">SKEPTIC</div>
          <div class="debate-card-text">${esc(rec.challenge)}</div>
        </div>
        ${rec.rebuttal ? `
        <div class="debate-card-row">
          <div class="debate-card-who specialist-who">${esc(agentLabel)}</div>
          <div class="debate-card-text">${esc(rec.rebuttal)}</div>
        </div>` : ''}
        ${safeRating ? `
        <div class="debate-card-row">
          <div class="debate-card-who ${ratingCls}">${esc(safeRating.toUpperCase())}</div>
          <div class="debate-card-text dim">${esc(rec.ratingReasoning ?? '')}</div>
        </div>` : ''}
      `;
      bodyEl.appendChild(card);
    }
  }
  document.getElementById('skeptic-overlay')!.classList.add('open');
}

document.getElementById('skeptic-close')?.addEventListener('click', () => {
  document.getElementById('skeptic-overlay')!.classList.remove('open');
});
document.getElementById('skeptic-overlay')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('skeptic-overlay'))
    document.getElementById('skeptic-overlay')!.classList.remove('open');
});

// ── Judge modal ────────────────────────────────────────────────────────
function openJudgeModal(): void {
  const bodyEl = document.getElementById('judge-body')!;
  if (!latestVerdict) return;
  const v = latestVerdict;
  bodyEl.innerHTML = '';

  const safeVerdict = ['Pass', 'Revise', 'Reject'].includes(v.verdict) ? v.verdict : 'Revise';
  const safeConfidence = Number.isFinite(Number(v.confidence)) ? Math.max(0, Math.min(100, Number(v.confidence))) : 0;

  // Verdict hero
  const hero = document.createElement('div');
  hero.className = `judge-verdict-hero verdict-${safeVerdict}`;
  hero.innerHTML = `
    <span class="judge-verdict-word">${esc(safeVerdict.toUpperCase())}</span>
    <span class="judge-confidence">${safeConfidence}% confidence</span>
  `;
  bodyEl.appendChild(hero);

  // Top blocking issues
  if (v.topBlockingIssues?.length) {
    const sec = document.createElement('div');
    sec.className = 'judge-section';
    sec.innerHTML = `<div class="judge-section-title">TOP BLOCKING ISSUES</div>` +
      v.topBlockingIssues.map((f: any) => {
        const sev = safeSev(f.severity);
        const color = SEV_COLOR[sev] ?? 'var(--color-text)';
        return `<div class="judge-blocking-item">
          <span class="finding-sev-badge sev-${sev}" style="color:${color};border-color:${color}">${esc(sev.toUpperCase())}</span>
          <span>${esc(f.title)}</span>
        </div>`;
      }).join('');
    bodyEl.appendChild(sec);
  }

  // committeeBrief or revisionMemo
  const memo = v.committeeBrief || v.revisionMemo;
  if (memo) {
    const sec = document.createElement('div');
    sec.className = 'judge-section';
    sec.innerHTML = `<div class="judge-section-title">${v.committeeBrief ? 'COMMITTEE BRIEF' : 'REVISION MEMO'}</div>
      <div class="judge-section-text">${esc(memo)}</div>`;
    bodyEl.appendChild(sec);
  }

  // Debate summary
  if (v.agentDebateSummary) {
    const sec = document.createElement('div');
    sec.className = 'judge-section';
    sec.innerHTML = `<div class="judge-section-title">DEBATE SUMMARY</div>
      <div class="judge-section-text">${esc(v.agentDebateSummary)}</div>`;
    bodyEl.appendChild(sec);
  }

  document.getElementById('judge-overlay')!.classList.add('open');
}

document.getElementById('judge-close')?.addEventListener('click', () => {
  document.getElementById('judge-overlay')!.classList.remove('open');
});
document.getElementById('judge-overlay')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('judge-overlay'))
    document.getElementById('judge-overlay')!.classList.remove('open');
});

// ── Full report modal ─────────────────────────────────────────────────
let reportAgentFilter = 'all';
let reportSevFilter = 'all';

function renderReportFindings(bodyEl: HTMLElement): void {
  // Remove existing findings sections (keep debate + verdict sections)
  bodyEl.querySelectorAll('.report-section.findings-section').forEach((el) => el.remove());

  const agentOrder = ['security-compliance', 'architecture-infra', 'product-ops'];
  let anyVisible = false;

  for (const agentId of agentOrder) {
    if (reportAgentFilter !== 'all' && reportAgentFilter !== agentId) continue;
    const findings = agentFindings.get(agentId);
    if (!findings?.length) continue;

    const filtered = reportSevFilter === 'all'
      ? findings
      : findings.filter((f) => f.severity === reportSevFilter);
    if (!filtered.length) continue;
    anyVisible = true;

    const label = agentId.split('-').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    const section = document.createElement('div');
    section.className = 'report-section findings-section';
    section.innerHTML = `<div class="report-section-title">${label} — ${filtered.length} finding${filtered.length !== 1 ? 's' : ''}</div>`;
    for (const f of filtered) {
      const sev = safeSev(f.severity);
      const color = SEV_COLOR[sev] ?? 'var(--color-text)';
      const card = document.createElement('div');
      card.className = 'finding-card';
      card.innerHTML = `
        <div class="finding-card-header">
          <span class="finding-sev-badge sev-${sev}" style="color:${color};border-color:${color}">${esc(sev.toUpperCase())}</span>
          <span class="finding-title">${esc(f.title)}</span>
        </div>
        <div class="finding-detail">${esc(f.description)}</div>
        ${f.excerpt ? `<div class="finding-excerpt">"${esc(f.excerpt)}"</div>` : ''}
        <div class="finding-rec">${esc(f.recommendation)}</div>
      `;
      section.appendChild(card);
    }
    // Insert before debate/verdict sections
    const firstNonFindings = bodyEl.querySelector('.report-section:not(.findings-section)');
    if (firstNonFindings) {
      bodyEl.insertBefore(section, firstNonFindings);
    } else {
      bodyEl.appendChild(section);
    }
  }

  if (!anyVisible) {
    const empty = document.createElement('div');
    empty.className = 'report-section findings-section';
    empty.innerHTML = '<div style="font-size:8px;color:var(--color-text-dim);padding:8px 0">No findings match the selected filters.</div>';
    const firstNonFindings = bodyEl.querySelector('.report-section:not(.findings-section)');
    if (firstNonFindings) bodyEl.insertBefore(empty, firstNonFindings);
    else bodyEl.appendChild(empty);
  }
}

function openFullReport(): void {
  const bodyEl = document.getElementById('report-body')!;
  bodyEl.innerHTML = '';

  // Reset filters
  reportAgentFilter = 'all';
  reportSevFilter = 'all';
  document.querySelectorAll('.report-filter-btn').forEach((btn) => {
    const isAll = (btn as HTMLElement).dataset.agent === 'all' || (btn as HTMLElement).dataset.sev === 'all';
    btn.classList.toggle('active', isAll);
  });

  // Wire up agent filter buttons
  document.querySelectorAll('.agent-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.agent-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      reportAgentFilter = (btn as HTMLElement).dataset.agent ?? 'all';
      renderReportFindings(bodyEl);
    });
  });

  // Wire up severity filter buttons
  document.querySelectorAll('.sev-filter').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.sev-filter').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      reportSevFilter = (btn as HTMLElement).dataset.sev ?? 'all';
      renderReportFindings(bodyEl);
    });
  });

  // Section 1: findings (filtered)
  renderReportFindings(bodyEl);

  // Section 2: debate record
  if (debateRecords.size > 0) {
    const section = document.createElement('div');
    section.className = 'report-section';
    section.innerHTML = `<div class="report-section-title">⚔ DEBATE RECORD</div>`;
    for (const rec of debateRecords.values()) {
      const finding = findingsById.get(rec.findingId);
      const title = finding?.title ?? rec.findingId;
      const safeRating = rec.rating === 'convincing' || rec.rating === 'unconvincing' ? rec.rating : '';
      const ratingCls = safeRating ? `verdict-${safeRating}` : '';
      const agentLabel = (rec.rebuttalAgent ?? 'SPECIALIST').replace(/_/g, '-').toUpperCase();
      const card = document.createElement('div');
      card.className = 'debate-card';
      card.innerHTML = `
        <div class="debate-card-title">${esc(title)}</div>
        <div class="debate-card-row">
          <div class="debate-card-who skeptic-who">SKEPTIC</div>
          <div class="debate-card-text">${esc(rec.challenge)}</div>
        </div>
        ${rec.rebuttal ? `
        <div class="debate-card-row">
          <div class="debate-card-who specialist-who">${esc(agentLabel)}</div>
          <div class="debate-card-text">${esc(rec.rebuttal)}</div>
        </div>` : ''}
        ${safeRating ? `
        <div class="debate-card-row">
          <div class="debate-card-who ${ratingCls}">${esc(safeRating.toUpperCase())}</div>
          <div class="debate-card-text dim">${esc(rec.ratingReasoning ?? '')}</div>
        </div>` : ''}
      `;
      section.appendChild(card);
    }
    bodyEl.appendChild(section);
  }

  // Section 3: judge verdict
  if (latestVerdict) {
    const v = latestVerdict;
    const section = document.createElement('div');
    section.className = 'report-section';
    const safeVerdict = ['Pass', 'Revise', 'Reject'].includes(v.verdict) ? v.verdict : 'Revise';
    const safeConfidence = Number.isFinite(Number(v.confidence)) ? Math.max(0, Math.min(100, Number(v.confidence))) : 0;
    section.innerHTML = `
      <div class="report-section-title">⚖ JUDGE VERDICT</div>
      <div class="judge-verdict-hero verdict-${safeVerdict}" style="margin-bottom:10px">
        <span class="judge-verdict-word">${esc(safeVerdict.toUpperCase())}</span>
        <span class="judge-confidence">${safeConfidence}% confidence</span>
      </div>
      ${(v.committeeBrief || v.revisionMemo) ? `
      <div class="judge-section" style="margin-bottom:8px">
        <div class="judge-section-title">${v.committeeBrief ? 'COMMITTEE BRIEF' : 'REVISION MEMO'}</div>
        <div class="judge-section-text">${esc(v.committeeBrief || v.revisionMemo)}</div>
      </div>` : ''}
      ${v.agentDebateSummary ? `
      <div class="judge-section">
        <div class="judge-section-title">DEBATE SUMMARY</div>
        <div class="judge-section-text">${esc(v.agentDebateSummary)}</div>
      </div>` : ''}
    `;
    bodyEl.appendChild(section);
  }

  document.getElementById('report-overlay')!.classList.add('open');
}

document.getElementById('report-close')?.addEventListener('click', () => {
  document.getElementById('report-overlay')!.classList.remove('open');
});
document.getElementById('report-overlay')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('report-overlay'))
    document.getElementById('report-overlay')!.classList.remove('open');
});
document.getElementById('toolbar-report-btn')?.addEventListener('click', openFullReport);

// ── Report export ──────────────────────────────────────────────────────
function buildReportMarkdown(): string {
  const lines: string[] = [];
  const v = latestVerdict;

  lines.push('# ENG AI COMMITTEE — REVIEW REPORT', '');

  if (v) {
    lines.push(`## VERDICT: ${v.verdict.toUpperCase()}`, `**Judge certainty:** ${v.confidence}%`, '');
    if (v.revisionMemo) {
      lines.push('### REVISION MEMO', v.revisionMemo, '');
    } else if (v.committeeBrief) {
      lines.push('### COMMITTEE BRIEF', v.committeeBrief, '');
    }
    lines.push('---', '');
  }

  const agentOrder: Array<{ id: string; label: string }> = [
    { id: 'security-compliance', label: 'SECURITY & COMPLIANCE' },
    { id: 'architecture-infra',  label: 'ARCHITECTURE & INFRA' },
    { id: 'product-ops',         label: 'PRODUCT & OPS' },
  ];

  lines.push('## FINDINGS', '');
  for (const { id, label } of agentOrder) {
    const findings = agentFindings.get(id);
    if (!findings?.length) continue;
    lines.push(`### ${label} — ${findings.length} finding${findings.length !== 1 ? 's' : ''}`, '');
    for (const f of findings) {
      lines.push(`#### [${f.severity}] ${f.title}`);
      lines.push(`**Risk:** ${f.description}`);
      if (f.excerpt) lines.push(`> "${f.excerpt}"`);
      lines.push(`**Recommendation:** ${f.recommendation}`, '');
    }
  }

  if (debateRecords.size > 0) {
    lines.push('---', '', '## DEBATE RECORD', '');
    for (const rec of debateRecords.values()) {
      const finding = findingsById.get(rec.findingId);
      lines.push(`### ${finding?.title ?? rec.findingId}`);
      lines.push(`**SKEPTIC:** ${rec.challenge}`);
      if (rec.rebuttal) {
        const who = (rec.rebuttalAgent ?? 'SPECIALIST').replace(/_/g, '-').toUpperCase();
        lines.push(`**${who}:** ${rec.rebuttal}`);
      }
      if (rec.rating) {
        lines.push(`**VERDICT:** ${rec.rating.toUpperCase()}${rec.ratingReasoning ? ` — ${rec.ratingReasoning}` : ''}`);
      }
      lines.push('');
    }
  }

  if (v?.agentDebateSummary) {
    lines.push('---', '', '## AGENT DEBATE SUMMARY', '', v.agentDebateSummary, '');
  }

  return lines.join('\n');
}

const exportReportBtn = document.getElementById('toolbar-export-report-btn') as HTMLButtonElement;
exportReportBtn?.addEventListener('click', async () => {
  const format = prompt('Export format? Type "docx" or "pdf"', 'pdf') as 'docx' | 'pdf' | null;
  if (!format || !['docx', 'pdf'].includes(format)) return;

  const originalText = exportReportBtn.textContent ?? '';
  try {
    exportReportBtn.textContent = 'Exporting...';
    exportReportBtn.disabled = true;

    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, docText: buildReportMarkdown() }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Export failed' }));
      throw new Error(err.error);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `review-report.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert(`Export error: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    exportReportBtn.textContent = originalText;
    exportReportBtn.disabled = false;
  }
});

function populateReviewStateFromResult(result: { verdict?: any; allFindings?: Finding[] }): void {
  agentFindings.clear();
  findingsById.clear();
  debateRecords.clear();

  for (const finding of result.allFindings ?? []) {
    findingsById.set(finding.id, finding);

    const agentId =
      finding.agent.includes('security') ? 'security-compliance'
        : finding.agent.includes('architecture') || finding.agent.includes('infra') ? 'architecture-infra'
          : 'product-ops';

    if (!agentFindings.has(agentId)) agentFindings.set(agentId, []);
    agentFindings.get(agentId)!.push(finding);
  }

  latestVerdict = result.verdict ?? null;
}

// ── Agent click → show findings, debate, or verdict ───────────────────
function setupAgentClick(agentId: string, agentEl: HTMLElement): void {
  agentEl.addEventListener('click', () => {
    if (agentId === 'skeptic') { if (debateRecords.size > 0) openSkepticModal(); return; }
    if (agentId === 'judge')   { if (latestVerdict) openJudgeModal(); return; }
    const findings = agentFindings.get(agentId);
    if (findings && findings.length > 0) {
      const label = agentId.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
      openFindingsModal(label, findings);
    }
  });
}

// ── Editor ────────────────────────────────────────────────────────────
const editorHostEl = document.getElementById('editor-host')!;
const imageStripEl = document.getElementById('image-strip')!;
const filenameEl = document.getElementById('editor-filename')!;
const uploadZoneEl = document.getElementById('upload-zone')!;
const editorPanelEl = document.getElementById('editor-panel')!;

const editor = new Editor(editorHostEl, imageStripEl, filenameEl);

setupUploadZone(uploadZoneEl, async (file) => {
  const uploadText = uploadZoneEl.querySelector('#upload-zone-text') as HTMLElement;
  uploadText.innerHTML = `<span style="color:var(--color-gold)">⏳ Uploading ${esc(file.name)}...</span>`;

  let result: Awaited<ReturnType<typeof uploadFile>> | null = null;
  try {
    result = await uploadFile(file);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    uploadText.innerHTML = `<span style="color:var(--color-reject)">✗ Upload failed: ${esc(msg)}</span><br><br>Try again or use the paste option below.`;
    console.error('[upload] failed:', msg);
    return;
  }

  // Store raw text as fallback in case CodeMirror init fails
  currentRunId = result.runId;
  currentFilename = result.filename;
  currentDocText = result.docText;

  // Enable button BEFORE any rendering that might throw
  (document.getElementById('start-review-btn') as HTMLButtonElement).disabled = false;

  // Transition UI from upload zone to editor
  uploadZoneEl.style.display = 'none';
  editorPanelEl.style.display = 'flex';
  document.getElementById('editor-host')!.style.display = 'block';

  try {
    editor.load(result);
  } catch (editorErr) {
    console.error('[editor] init failed:', editorErr);
    // Plain text fallback — user can still Start Review, currentDocText is the source of truth
    document.getElementById('editor-host')!.textContent = result.docText.slice(0, 5000);
  }
});

// ── Paste text fallback ───────────────────────────────────────────────
document.getElementById('paste-text-btn')?.addEventListener('click', (e) => {
  e.stopPropagation(); // don't trigger upload zone click
  uploadZoneEl.style.display = 'none';
  const pasteZone = document.getElementById('paste-zone')!;
  pasteZone.style.display = 'flex';
  editorPanelEl.style.display = 'flex';
});

document.getElementById('paste-confirm-btn')?.addEventListener('click', () => {
  const textarea = document.getElementById('paste-textarea') as HTMLTextAreaElement;
  const text = textarea.value.trim();
  if (!text) { alert('Please paste some text first'); return; }

  currentDocText = text;
  currentFilename = 'pasted-document.md';
  if (!currentRunId) currentRunId = crypto.randomUUID();

  document.getElementById('paste-zone')!.style.display = 'none';
  document.getElementById('editor-host')!.style.display = 'block';

  editor.load({ runId: currentRunId, filename: currentFilename, docText: text, images: [] });
  (document.getElementById('start-review-btn') as HTMLButtonElement).disabled = false;
});

// ── Archive ───────────────────────────────────────────────────────────
const archive = new FileArchive(
  document.getElementById('archive-list')!,
  document.getElementById('archive-detail')!,
);
archive.onLoad((detail) => {
  currentRunId = detail.runId;
  currentFilename = detail.filename;
  currentDocText = detail.editedDoc;
  populateReviewStateFromResult(detail.resultJson ?? {});

  // Restore visual agent states
  for (const [agentId, findings] of agentFindings) {
    const agent = agents.get(agentId as AgentId);
    if (!agent) continue;
    agent.setState('done', `${findings.length} finding${findings.length !== 1 ? 's' : ''}`);
    agent.el.setAttribute('data-clickable', 'true');
    if (!agent.el.querySelector('.agent-click-hint')) {
      const hint = document.createElement('div');
      hint.className = 'agent-click-hint';
      hint.textContent = '▲ click';
      agent.el.appendChild(hint);
    }
  }

  // Restore judge state and verdict banner
  if (latestVerdict) {
    stageIndicatorEl.textContent = `VERDICT: ${latestVerdict.verdict.toUpperCase()}`;
    const judge = agents.get('judge')!;
    judge.el.setAttribute('data-clickable', 'true');
    if (!judge.el.querySelector('.agent-click-hint')) {
      const hint = document.createElement('div');
      hint.className = 'agent-click-hint';
      hint.textContent = '▲ click';
      judge.el.appendChild(hint);
    }
    judgeReveal.reveal(latestVerdict, judge, [...agents.values()]);
  }

  toggleArchivePanel(false);
  uploadZoneEl.style.display = 'none';
  editorPanelEl.style.display = 'flex';
  document.getElementById('editor-host')!.style.display = 'block';
  editor.load({ runId: detail.runId, filename: detail.filename, docText: detail.editedDoc, images: [] });
  fetch(buildAuthorizedPath(`/api/history/${detail.runId}/images`, detail.runId))
    .then((r) => r.json())
    .then((imgs) => editor.load({ runId: detail.runId, filename: detail.filename, docText: detail.editedDoc, images: imgs }))
    .catch(() => {});
  (document.getElementById('toolbar-report-btn') as HTMLButtonElement).style.display = '';
  (document.getElementById('toolbar-export-report-btn') as HTMLButtonElement).style.display = '';
  (document.getElementById('start-review-btn') as HTMLButtonElement).disabled = false;
  switchRightTab('editor');
});
archive.refresh();

// ── Log tab ───────────────────────────────────────────────────────────
const logPanelEl = document.getElementById('log-panel')!;
const logTab = new LogTab(logPanelEl);

// ── Conversation Log ──────────────────────────────────────────────────
const convLog = new ConvLogDialog();

// Expose globally so archive detail can call it
(window as any).__openConvLog = (runId: string, filename: string) => convLog.open(runId, filename);

// ── Export ────────────────────────────────────────────────────────────
setupExportPanel(
  document.getElementById('toolbar-export-btn')!,
  () => currentRunId,
  () => editor.getText(),
);

// ── Right panel tabs ──────────────────────────────────────────────────
document.querySelectorAll('.right-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    switchRightTab((tab as HTMLElement).dataset.tab!);
  });
});

function switchRightTab(tab: string): void {
  document.querySelectorAll('.right-tab').forEach((t) => {
    (t as HTMLElement).classList.toggle('active', (t as HTMLElement).dataset.tab === tab);
  });
  editorPanelEl.style.display = tab === 'editor' ? 'flex' : 'none';
  logPanelEl.classList.toggle('visible', tab === 'log');
}

// ── Start Review button ───────────────────────────────────────────────
const startBtn = document.getElementById('start-review-btn') as HTMLButtonElement;
const progressBarWrap = document.getElementById('progress-bar-wrap')!;
const progressBar = document.getElementById('progress-bar')!;
const agentsSelect = document.getElementById('agents-select') as HTMLSelectElement;
const depthSelect = document.getElementById('depth-select') as HTMLSelectElement;

// ── Session persistence helpers ───────────────────────────────────────
const SESSION_KEY = 'eng-committee-session';

function saveSession(): void {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({
    runId: currentRunId,
    filename: currentFilename,
    accessToken: getRunAccessToken(currentRunId),
  }));
}

function clearSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

function loadSavedSession(): { runId: string; filename: string; accessToken: string } | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Called with a completed result to restore UI without live events
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyCompletedResult(result: any, runId: string, filename: string): void {
  progressBar.style.width = '100%';
  judgeReveal.reveal(result.verdict, agents.get('judge')!, [...agents.values()]);
  startBtn.disabled = false;
  startBtn.textContent = 'Start Review';
  progressBarWrap.classList.remove('visible');
  stageIndicatorEl.textContent = `VERDICT: ${result.verdict.verdict.toUpperCase()}`;
}

startBtn.addEventListener('click', () => {
  // Use editor text if CodeMirror is loaded, fall back to raw uploaded text
  const docText = editor.getText().trim() ? editor.getText() : currentDocText;
  if (!docText.trim()) { alert('Please upload a document first'); return; }

  // Reset room
  agents.forEach((a) => {
    a.setState('idle');
    a.el.removeAttribute('data-clickable');
    a.el.querySelector('.agent-click-hint')?.remove();
  });
  agentFindings.clear();
  findingsById.clear();
  debateRecords.clear();
  latestVerdict = null;
  (document.getElementById('toolbar-report-btn') as HTMLButtonElement).style.display = 'none';
  (document.getElementById('toolbar-export-report-btn') as HTMLButtonElement).style.display = 'none';
  judgeReveal.reset();
  debateViz.clear();
  stageIndicatorEl.textContent = 'INITIALIZING...';
  startBtn.disabled = true;
  startBtn.textContent = 'Review in Progress...';
  progressBarWrap.classList.add('visible');
  progressBar.style.width = '5%';

  // Persist so a page refresh can reconnect
  saveSession();

  // Clear and switch to log tab to show pipeline progress
  logTab.clear();
  switchRightTab('log');

  socket.startReview({
    runId: currentRunId,
    docText,
    filename: currentFilename,
    agents: agentsSelect?.value ?? 'all',
    depth: parseInt(depthSelect?.value ?? '1', 10),
  });
});

// ── Save to archive button ────────────────────────────────────────────
document.getElementById('toolbar-save-btn')?.addEventListener('click', () => {
  if (!currentRunId) { alert('No review to save'); return; }
  socket.saveToArchive({
    runId: currentRunId,
    editedDocText: editor.getText(),
    filename: currentFilename,
  });
});

socket.on('archive:saved', () => {
  archive.refresh();
  alert('Saved to archive!');
});

socket.on('pipeline:session', ({ runId, accessToken }) => {
  rememberRunAccess(runId, accessToken);
  if (currentRunId === runId) saveSession();
});

// ── Pipeline event handler ────────────────────────────────────────────
const STAGE_PROGRESS: Record<string, number> = {
  'structural-check': 10,
  'specialists':      30,
  'deduplication':    60,
  'debate':           75,
  'judge':            90,
};

function handlePipelineEvent(event: PipelineEvent): void {
  switch (event.type) {
    case 'stage:start':
      stageIndicatorEl.textContent = `STAGE: ${event.stage.toUpperCase()}`;
      if (STAGE_PROGRESS[event.stage]) {
        progressBar.style.width = `${STAGE_PROGRESS[event.stage]}%`;
      }
      break;

    case 'agent:thinking': {
      const agent = agents.get(event.agent as AgentId);
      agent?.setState('thinking');
      break;
    }

    case 'agent:retry': {
      const agent = agents.get(event.agent as AgentId);
      agent?.setState('speaking', `Retrying... (attempt ${event.attempt})`, undefined);
      break;
    }

    case 'agent:timeout': {
      const agent = agents.get(event.agent as AgentId);
      agent?.setState('speaking', 'Timed out, retrying...', undefined);
      break;
    }

    case 'agent:finding': {
      const agent = agents.get(event.agent as AgentId);
      agent?.setState('speaking', event.finding.title, event.finding.severity);
      // Accumulate for findings modal
      if (!agentFindings.has(event.agent)) agentFindings.set(event.agent, []);
      agentFindings.get(event.agent)!.push(event.finding);
      findingsById.set(event.finding.id, event.finding);
      break;
    }

    case 'agent:done': {
      const agent = agents.get(event.agent as AgentId);
      const count = event.findingCount;
      agent?.setState('done', `${count} finding${count !== 1 ? 's' : ''} — click to view`);
      // Mark agent as clickable
      agent?.el.setAttribute('data-clickable', 'true');
      // Add a hint label
      const existing = agent?.el.querySelector('.agent-click-hint');
      if (!existing && agent) {
        const hint = document.createElement('div');
        hint.className = 'agent-click-hint';
        hint.textContent = '▲ click';
        agent.el.appendChild(hint);
      }
      break;
    }

    case 'dedup:complete':
      stageIndicatorEl.textContent = `DEDUP: ${event.before} → ${event.after} findings`;
      break;

    case 'debate:round:start':
      stageIndicatorEl.textContent = `DEBATE ROUND ${event.round}`;
      agents.get('skeptic')?.setState('thinking');
      break;

    case 'skeptic:challenge': {
      // Track for Skeptic modal
      for (const c of event.challenges) {
        debateRecords.set(c.findingId, { findingId: c.findingId, challenge: c.challenge });
      }
      const skeptic = agents.get('skeptic')!;
      const challengedAgentIds = new Set<AgentId>();
      for (const id of ['security-compliance', 'architecture-infra', 'product-ops'] as AgentId[]) {
        if (agents.has(id)) challengedAgentIds.add(id);
      }
      const challenged = [...challengedAgentIds].map((id) => agents.get(id)!).filter(Boolean);
      debateViz.drawChallenges(skeptic, challenged);
      skeptic.setState('speaking', `Challenging ${event.challenges.length} finding(s)...`);
      break;
    }

    case 'specialist:rebuttal': {
      // Track for Skeptic modal
      for (const r of event.rebuttals) {
        const rec = debateRecords.get(r.findingId);
        if (rec) { rec.rebuttal = r.defense; rec.rebuttalAgent = r.agent; }
      }
      const skeptic = agents.get('skeptic')!;
      event.rebuttals.forEach((rebuttal, i) => {
        setTimeout(() => {
          const agentName = rebuttal.agent.replace(/_/g, '-') as AgentId;
          const agent = agents.get(agentName) ?? findAgentByPartialName(rebuttal.agent);
          if (agent) {
            debateViz.drawRebuttal(agent, skeptic);
            agent.setState('speaking', rebuttal.defense.slice(0, 80) + (rebuttal.defense.length > 80 ? '…' : ''));
          }
        }, i * 300);
      });
      debateViz.fadeOut(4000);
      break;
    }

    case 'skeptic:rating': {
      // Track for Skeptic modal
      for (const r of event.ratings) {
        const rec = debateRecords.get(r.findingId);
        if (rec) { rec.rating = r.rating as any; rec.ratingReasoning = r.reasoning; }
      }
      const convincing = event.ratings.filter((r) => r.rating === 'convincing').length;
      const skeptic = agents.get('skeptic')!;
      skeptic.setState('done', `${convincing}/${event.ratings.length} convincing → ${event.survivingCount} survive`);
      // Make skeptic clickable
      skeptic.el.setAttribute('data-clickable', 'true');
      if (!skeptic.el.querySelector('.agent-click-hint')) {
        const hint = document.createElement('div');
        hint.className = 'agent-click-hint';
        hint.textContent = '▲ click';
        skeptic.el.appendChild(hint);
      }
      debateViz.clear();
      break;
    }

    case 'debate:round:end':
      stageIndicatorEl.textContent = `ROUND ${event.round} DONE — ${event.survivingFindings.length} surviving`;
      break;

    case 'judge:thinking':
      agents.get('judge')?.setState('thinking');
      stageIndicatorEl.textContent = 'JUDGE DELIBERATING...';
      progressBar.style.width = '93%';
      break;

    case 'judge:verdict':
      latestVerdict = event.verdict;
      stageIndicatorEl.textContent = `VERDICT: ${event.verdict.verdict.toUpperCase()}`;
      // Make judge clickable
      {
        const judge = agents.get('judge')!;
        judge.el.setAttribute('data-clickable', 'true');
        if (!judge.el.querySelector('.agent-click-hint')) {
          const hint = document.createElement('div');
          hint.className = 'agent-click-hint';
          hint.textContent = '▲ click';
          judge.el.appendChild(hint);
        }
      }
      break;

    case 'pipeline:complete':
      clearSession();
      progressBar.style.width = '100%';
      judgeReveal.reveal(event.result.verdict, agents.get('judge')!, [...agents.values()]);
      startBtn.disabled = false;
      startBtn.textContent = 'Start Review';
      progressBarWrap.classList.remove('visible');
      // Show report buttons
      (document.getElementById('toolbar-report-btn') as HTMLButtonElement).style.display = '';
      (document.getElementById('toolbar-export-report-btn') as HTMLButtonElement).style.display = '';
      break;

    case 'pipeline:error':
      clearSession();
      stageIndicatorEl.textContent = `ERROR: ${event.message.slice(0, 40)}`;
      agents.forEach((a) => a.setState('error', 'Pipeline error'));
      startBtn.disabled = false;
      startBtn.textContent = 'Start Review';
      progressBarWrap.classList.remove('visible');
      break;
  }
}

socket.on('pipeline:event', (event) => {
  handlePipelineEvent(event);
  logTab.append('pipeline_event', event);
});

socket.on('pipeline:progress', ({ message }) => {
  logTab.append('progress', { message });
});

// ── History sidebar toggle ────────────────────────────────────────────
function toggleArchivePanel(forceOpen?: boolean): void {
  const panel = document.getElementById('archive-panel')!;
  const isHidden = panel.style.display === 'none' || panel.style.display === '';
  const shouldShow = forceOpen ?? isHidden;
  panel.style.display = shouldShow ? 'flex' : 'none';
}
document.getElementById('toolbar-archive-btn')?.addEventListener('click', () => toggleArchivePanel());
document.getElementById('archive-close-btn')?.addEventListener('click', () => toggleArchivePanel(false));

// ── Help dialog ───────────────────────────────────────────────────────
document.getElementById('toolbar-help-btn')?.addEventListener('click', () => {
  document.getElementById('help-overlay')!.classList.add('open');
});
document.getElementById('help-close')?.addEventListener('click', () => {
  document.getElementById('help-overlay')!.classList.remove('open');
});
document.getElementById('help-overlay')?.addEventListener('click', (e) => {
  if (e.target === document.getElementById('help-overlay')) {
    document.getElementById('help-overlay')!.classList.remove('open');
  }
});

// ── Session recovery on page load ─────────────────────────────────────
(function recoverSession() {
  const saved = loadSavedSession();
  if (!saved) return;

  currentRunId = saved.runId;
  currentFilename = saved.filename;

  // Show a banner while we check
  stageIndicatorEl.textContent = 'RECONNECTING...';
  startBtn.disabled = true;
  startBtn.textContent = 'Review in Progress...';
  progressBarWrap.classList.add('visible');
  progressBar.style.width = '5%';
  switchRightTab('log');
  logTab.append('progress', { message: '🔄 Reconnecting to previous session...' });

  // Wait for socket to connect, then rejoin
  if (saved.accessToken) rememberRunAccess(saved.runId, saved.accessToken);
  const doRejoin = () => socket.rejoinRun(saved.runId, saved.accessToken);
  if (socket.socket.connected) {
    doRejoin();
  } else {
    socket.socket.once('connect', doRejoin);
  }
})();

socket.on('pipeline:rejoin:status', ({ status, result, pastEvents }) => {
  // Replay all past pipeline events to restore agent states
  if (pastEvents?.length) {
    let delay = 0;
    for (const event of pastEvents) {
      setTimeout(() => handlePipelineEvent(event as PipelineEvent), delay);
      delay += 30;
    }
  }

  if (status === 'running') {
    stageIndicatorEl.textContent = 'REVIEW IN PROGRESS...';
    // Load past log entries into the log tab for context
    logTab.loadFromDb(currentRunId);
  } else if (status === 'restarting') {
    // Server restarted mid-pipeline and is auto-resuming from the beginning
    stageIndicatorEl.textContent = 'RESUMING REVIEW...';
    logTab.clear();
    logTab.append('progress', { message: '🔄 Server restarted — resuming pipeline from beginning...' });
  } else if (status === 'complete' && result) {
    logTab.loadFromDb(currentRunId);
    setTimeout(() => {
      clearSession();
      applyCompletedResult(result, currentRunId, currentFilename);
    }, pastEvents?.length ? pastEvents.length * 30 + 100 : 0);
  } else if (status === 'unauthorized') {
    clearSession();
    stageIndicatorEl.textContent = 'SESSION ACCESS EXPIRED';
    startBtn.disabled = false;
    startBtn.textContent = 'Start Review';
    progressBarWrap.classList.remove('visible');
    logTab.clear();
  } else {
    // Unknown — pipeline was lost and no doc text to resume
    clearSession();
    stageIndicatorEl.textContent = 'PREVIOUS RUN UNAVAILABLE';
    startBtn.disabled = false;
    startBtn.textContent = 'Start Review';
    progressBarWrap.classList.remove('visible');
    if (pastEvents?.length) logTab.loadFromDb(currentRunId);
  }
});

// ── Helper ────────────────────────────────────────────────────────────
function findAgentByPartialName(name: string): ReturnType<typeof agents.get> {
  for (const [id, agent] of agents) {
    if (id.includes(name) || name.includes(id.split('-')[0])) return agent;
  }
  return undefined;
}
