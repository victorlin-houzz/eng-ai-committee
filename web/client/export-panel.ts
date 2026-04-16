import { getRunAccessToken } from './run-access.js';

export function setupExportPanel(
  exportBtnEl: HTMLElement,
  getRunId: () => string,
  getDocText: () => string,
): void {
  exportBtnEl.addEventListener('click', async () => {
    const runId = getRunId();
    if (!runId) { alert('No review to export yet'); return; }

    const format = prompt('Export format? Type "docx" or "pdf"', 'docx') as 'docx' | 'pdf' | null;
    if (!format || !['docx', 'pdf'].includes(format)) return;

    try {
      exportBtnEl.textContent = 'Exporting...';
      const res = await fetch('/api/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, format, docText: getDocText(), accessToken: getRunAccessToken(runId) }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Export failed' }));
        throw new Error(err.error);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `design-doc.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(`Export error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      exportBtnEl.textContent = 'Export Doc';
    }
  });
}
