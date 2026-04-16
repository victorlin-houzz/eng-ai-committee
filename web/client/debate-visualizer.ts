import type { AgentCharacter } from './agents.js';

/**
 * Draws animated SVG lines from the skeptic to challenged specialists.
 */
export class DebateVisualizer {
  private svg: SVGSVGElement;
  private lines: SVGLineElement[] = [];

  constructor(overlayEl: HTMLElement) {
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
    overlayEl.appendChild(this.svg);
  }

  /** Draw a challenge line from skeptic to each challenged agent */
  drawChallenges(skeptic: AgentCharacter, challenged: AgentCharacter[]): void {
    this.clear();
    const from = skeptic.getCenter();

    for (const agent of challenged) {
      const to = agent.getCenter();
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(from.x));
      line.setAttribute('y1', String(from.y));
      line.setAttribute('x2', String(to.x));
      line.setAttribute('y2', String(to.y));
      line.setAttribute('stroke', '#9c27b0');
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-dasharray', '6 4');
      line.setAttribute('stroke-dashoffset', '200');
      line.style.animation = 'draw-line 0.5s ease forwards';
      this.svg.appendChild(line);
      this.lines.push(line);
    }
  }

  /** Draw a rebuttal line (different color) back from specialist to skeptic */
  drawRebuttal(specialist: AgentCharacter, skeptic: AgentCharacter): void {
    const from = specialist.getCenter();
    const to = skeptic.getCenter();
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', String(from.x));
    line.setAttribute('y1', String(from.y));
    line.setAttribute('x2', String(to.x));
    line.setAttribute('y2', String(to.y));
    line.setAttribute('stroke', '#4caf50');
    line.setAttribute('stroke-width', '1.5');
    line.setAttribute('stroke-dasharray', '4 3');
    line.setAttribute('opacity', '0.7');
    this.svg.appendChild(line);
    this.lines.push(line);
  }

  clear(): void {
    for (const l of this.lines) l.remove();
    this.lines = [];
  }

  fadeOut(delay = 3000): void {
    setTimeout(() => {
      this.svg.style.transition = 'opacity 0.5s';
      this.svg.style.opacity = '0';
      setTimeout(() => {
        this.clear();
        this.svg.style.opacity = '1';
        this.svg.style.transition = '';
      }, 500);
    }, delay);
  }
}
