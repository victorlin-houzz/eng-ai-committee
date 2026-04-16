import { BubbleManager } from './speech-bubble.js';

export type AgentState = 'idle' | 'thinking' | 'speaking' | 'done' | 'celebrating' | 'error';

export type AgentId =
  | 'security-compliance'
  | 'architecture-infra'
  | 'product-ops'
  | 'skeptic'
  | 'judge';

const AGENT_META: Record<AgentId, { label: string; sprite: string }> = {
  'security-compliance': { label: 'SECURITY',     sprite: '/sprites/security.svg' },
  'architecture-infra':  { label: 'ARCHITECTURE', sprite: '/sprites/architecture.svg' },
  'product-ops':         { label: 'PRODUCT OPS',  sprite: '/sprites/product.svg' },
  'skeptic':             { label: 'SKEPTIC',       sprite: '/sprites/skeptic.svg' },
  'judge':               { label: 'JUDGE',         sprite: '/sprites/judge.svg' },
};

export class AgentCharacter {
  readonly id: AgentId;
  readonly el: HTMLElement;
  private spriteEl: HTMLImageElement;
  private nameEl: HTMLElement;
  private bubble: BubbleManager;
  private state: AgentState = 'idle';

  constructor(id: AgentId, roomEl: HTMLElement) {
    this.id = id;
    const meta = AGENT_META[id];

    this.el = document.createElement('div');
    this.el.className = 'agent state-idle';
    this.el.setAttribute('data-agent', id);

    this.spriteEl = document.createElement('img');
    this.spriteEl.className = 'agent-sprite';
    this.spriteEl.src = meta.sprite;
    this.spriteEl.alt = meta.label;

    this.nameEl = document.createElement('div');
    this.nameEl.className = 'agent-name';
    this.nameEl.textContent = meta.label;

    this.el.appendChild(this.spriteEl);
    this.el.appendChild(this.nameEl);
    roomEl.appendChild(this.el);

    this.bubble = new BubbleManager(this.el);
  }

  setState(state: AgentState, text?: string, severity?: string): void {
    this.state = state;
    this.el.className = `agent state-${state}`;
    this.el.setAttribute('data-agent', this.id);

    switch (state) {
      case 'thinking':
        this.bubble.showThinking();
        break;
      case 'speaking':
        if (text) this.bubble.showSpeech(text, severity);
        break;
      case 'done':
        if (text) this.bubble.showSpeech(text, undefined, 4000);
        break;
      case 'celebrating':
        this.bubble.showSpeech(text ?? '✓', undefined, 0);
        break;
      case 'error':
        this.bubble.showSpeech(text ?? 'Error', undefined, 8000);
        break;
      case 'idle':
        this.bubble.hide();
        break;
    }
  }

  getCenter(): { x: number; y: number } {
    const r = this.el.getBoundingClientRect();
    const parentR = this.el.offsetParent?.getBoundingClientRect() ?? { left: 0, top: 0 };
    return {
      x: r.left - parentR.left + r.width / 2,
      y: r.top - parentR.top + r.height / 2,
    };
  }
}

/** Create all 5 agents and mount them into the room element */
export function createAgents(roomEl: HTMLElement): Map<AgentId, AgentCharacter> {
  const agents = new Map<AgentId, AgentCharacter>();
  const ids: AgentId[] = ['judge', 'security-compliance', 'architecture-infra', 'product-ops', 'skeptic'];
  for (const id of ids) {
    agents.set(id, new AgentCharacter(id, roomEl));
  }
  return agents;
}
