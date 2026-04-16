import { EditorView, basicSetup } from 'codemirror';
import { markdown } from '@codemirror/lang-markdown';
import { EditorState } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';

export interface UploadResult {
  runId: string;
  filename: string;
  docText: string;
  images: Array<{ index: number; mimeType: string; dataUrl: string }>;
}

export class Editor {
  private view: EditorView | null = null;
  private hostEl: HTMLElement;
  private imageStripEl: HTMLElement;
  private filenameEl: HTMLElement;
  private images: UploadResult['images'] = [];

  onInsert?: (text: string, section: string) => void;

  constructor(hostEl: HTMLElement, imageStripEl: HTMLElement, filenameEl: HTMLElement) {
    this.hostEl = hostEl;
    this.imageStripEl = imageStripEl;
    this.filenameEl = filenameEl;
  }

  load(result: UploadResult): void {
    this.images = result.images;
    this.filenameEl.textContent = result.filename;
    this.initEditor(result.docText);
    this.renderImageStrip(result.images);
  }

  getText(): string {
    return this.view?.state.doc.toString() ?? '';
  }

  setText(text: string): void {
    if (!this.view) return;
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: text },
    });
  }

  /** Insert text at the end (or near a section heading if specified) */
  insertText(text: string, section?: string): void {
    if (!this.view) return;
    const doc = this.view.state.doc.toString();
    let insertPos = doc.length;

    if (section) {
      const sectionIdx = doc.toLowerCase().indexOf(section.toLowerCase());
      if (sectionIdx !== -1) {
        // Find the next heading after this section to insert before it
        const afterSection = doc.indexOf('\n#', sectionIdx + 1);
        insertPos = afterSection !== -1 ? afterSection : doc.length;
      }
    }

    this.view.dispatch({
      changes: { from: insertPos, insert: '\n\n' + text },
    });
    this.view.focus();
  }

  private initEditor(content: string): void {
    if (this.view) {
      this.view.destroy();
    }
    this.view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: [
          basicSetup,
          markdown(),
          oneDark,
          EditorView.lineWrapping,
        ],
      }),
      parent: this.hostEl,
    });
  }

  private renderImageStrip(images: UploadResult['images']): void {
    this.imageStripEl.innerHTML = '';
    for (const img of images) {
      const thumb = document.createElement('img');
      thumb.className = 'img-thumb';
      thumb.src = img.dataUrl;
      thumb.alt = `Image ${img.index + 1}`;
      thumb.title = `Click to insert Image ${img.index + 1}`;
      thumb.addEventListener('click', () => {
        this.insertText(`![Image ${img.index + 1}]`);
      });
      this.imageStripEl.appendChild(thumb);
    }
  }
}

/** Handle drag-and-drop + click-to-upload */
export function setupUploadZone(
  zoneEl: HTMLElement,
  onUpload: (file: File) => void,
): void {
  // Keep a persistent hidden file input in the DOM to avoid garbage-collection
  // issues that prevent the change event from firing in some browsers.
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.md,.txt,.pdf,.docx,.doc,.zip';
  input.style.cssText = 'position:fixed;left:-9999px;opacity:0;pointer-events:none;';
  document.body.appendChild(input);

  input.addEventListener('change', () => {
    if (input.files?.[0]) {
      onUpload(input.files[0]);
      // Reset so the same file can be re-uploaded
      input.value = '';
    }
  });

  zoneEl.addEventListener('click', (e) => {
    // Don't open file dialog if user clicked a button inside the zone (e.g. paste-text btn)
    if ((e.target as HTMLElement).tagName === 'BUTTON') return;
    input.click();
  });

  zoneEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    zoneEl.classList.add('drag-over');
  });
  zoneEl.addEventListener('dragleave', () => zoneEl.classList.remove('drag-over'));
  zoneEl.addEventListener('drop', (e) => {
    e.preventDefault();
    zoneEl.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file) onUpload(file);
  });
}

export async function uploadFile(file: File): Promise<UploadResult> {
  const form = new FormData();
  form.append('doc', file);
  const res = await fetch('/api/upload', { method: 'POST', body: form });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? 'Upload failed');
  }
  return res.json();
}
