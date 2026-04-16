import type { SocketClient } from './socket-client.js';

export class ChatPanel {
  private panelEl: HTMLElement;
  private messagesEl: HTMLElement;
  private inputEl: HTMLTextAreaElement;
  private sendBtn: HTMLElement;
  private socket: SocketClient;
  private runId = '';
  private history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  private currentAssistantEl: HTMLElement | null = null;

  onApplySuggestion?: (text: string, section: string) => void;

  constructor(panelEl: HTMLElement, socket: SocketClient) {
    this.panelEl = panelEl;
    this.messagesEl = panelEl.querySelector('#chat-messages')!;
    this.inputEl = panelEl.querySelector('#chat-input') as HTMLTextAreaElement;
    this.sendBtn = panelEl.querySelector('#chat-send-btn')!;

    this.socket = socket;
    this.setupEventListeners();
    this.registerSocketEvents();
  }

  open(runId: string): void {
    this.runId = runId;
    this.history = [];
    this.messagesEl.innerHTML = `
      <div class="chat-msg assistant">
        ⚖ Judge here. The review is complete. Ask me about the findings, or request specific improvements to your design document. I can suggest exact text to add.
      </div>
    `;
    this.panelEl.classList.add('visible');
    this.inputEl.focus();
  }

  close(): void {
    this.panelEl.classList.remove('visible');
  }

  private setupEventListeners(): void {
    this.sendBtn.addEventListener('click', () => this.send());
    this.inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.send();
      }
    });
  }

  private send(): void {
    const message = this.inputEl.value.trim();
    if (!message || !this.runId) return;

    this.inputEl.value = '';
    this.addMessage('user', message);
    this.history.push({ role: 'user', content: message });

    // Placeholder for streaming response
    this.currentAssistantEl = this.addMessage('assistant', '');
    const cursor = document.createElement('span');
    cursor.className = 'chat-cursor';
    this.currentAssistantEl.appendChild(cursor);

    this.socket.sendChatMessage({ runId: this.runId, message, history: this.history });
  }

  private registerSocketEvents(): void {
    this.socket.on('chat:token', ({ delta }) => {
      if (!this.currentAssistantEl) return;
      const cursor = this.currentAssistantEl.querySelector('.chat-cursor');
      if (cursor) {
        cursor.before(document.createTextNode(delta));
      } else {
        this.currentAssistantEl.appendChild(document.createTextNode(delta));
      }
      this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    });

    this.socket.on('chat:done', () => {
      if (!this.currentAssistantEl) return;

      const cursor = this.currentAssistantEl.querySelector('.chat-cursor');
      cursor?.remove();

      const fullText = this.currentAssistantEl.textContent ?? '';
      this.history.push({ role: 'assistant', content: fullText });

      // Check for JSON insert suggestion
      const jsonMatch = fullText.match(/\{"insert"\s*:\s*"([\s\S]*?)"\s*,\s*"section"\s*:\s*"([\s\S]*?)"\}/);
      if (jsonMatch) {
        const insertText = jsonMatch[1].replace(/\\n/g, '\n');
        const section = jsonMatch[2];
        const applyBtn = document.createElement('button');
        applyBtn.className = 'pixel-btn apply-btn';
        applyBtn.textContent = '↳ Apply to editor';
        applyBtn.addEventListener('click', () => {
          this.onApplySuggestion?.(insertText, section);
          applyBtn.textContent = '✓ Applied';
          applyBtn.disabled = true;
        });
        this.currentAssistantEl.appendChild(applyBtn);
      }

      this.currentAssistantEl = null;
    });

    this.socket.on('chat:error', ({ error }) => {
      const cursor = this.currentAssistantEl?.querySelector('.chat-cursor');
      cursor?.remove();
      if (this.currentAssistantEl) {
        this.currentAssistantEl.textContent = `Error: ${error}`;
        this.currentAssistantEl.style.color = '#f44336';
      }
      this.currentAssistantEl = null;
    });
  }

  private addMessage(role: 'user' | 'assistant', text: string): HTMLElement {
    const el = document.createElement('div');
    el.className = `chat-msg ${role}`;
    el.textContent = text;
    this.messagesEl.appendChild(el);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    return el;
  }
}
