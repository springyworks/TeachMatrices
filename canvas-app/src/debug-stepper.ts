// ═══════════════════════════════════════════════════════════════════════════════
//  DebugStepper — Step-by-step execution visualizer
//  Walks through TypeScript snippet blocks in topological (dependency) order,
//  highlighting the "active" block and animating its connected edges with
//  directional flow to show data / type / call relationships.
// ═══════════════════════════════════════════════════════════════════════════════

import { topoSort } from './reactive';
import type { SourceModel, SemanticEdge } from './source-model';

export interface DebugStep {
  /** Index (0-based) in the execution sequence */
  index: number;
  /** The snippet being "executed" */
  snippetId: string;
  /** Human-readable label (e.g. "Circle (class)") */
  label: string;
  /** Edges whose SOURCE is this snippet (outgoing references) */
  outgoing: SemanticEdge[];
  /** Edges whose TARGET is this snippet (incoming dependencies) */
  incoming: SemanticEdge[];
}

export type StepperState = 'idle' | 'stepping' | 'playing' | 'finished';

export interface StepperCallbacks {
  /** Called when a step activates (highlight block + animate edges) */
  onStep(step: DebugStep, total: number): void;
  /** Called when stepping resets */
  onReset(): void;
  /** Called when the play/pause state changes */
  onStateChange(state: StepperState): void;
}

export class DebugStepper {
  private steps: DebugStep[] = [];
  private currentIndex = -1;
  private state: StepperState = 'idle';
  private playTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: StepperCallbacks;
  private playIntervalMs = 1200;

  constructor(callbacks: StepperCallbacks) {
    this.callbacks = callbacks;
  }

  /** Rebuild the step sequence from the current source model */
  buildSteps(model: SourceModel): void {
    this.reset();

    const snippets = model.getSnippets();
    const edges = model.computeEdges();

    // Build a topological order based on references
    const nodeIds = snippets.map((s) => s.id);
    const graphEdges = edges.map((e) => ({
      source: e.sourceSnippetId,
      target: e.targetSnippetId,
    }));

    // topoSort returns dependency order: targets/declarations first, dependents later
    // We want to "execute" declarations first, then things that use them
    // So we reverse source→target to get declaration-first order
    const reversed = graphEdges.map((e) => ({
      source: e.target,
      target: e.source,
    }));
    const order = topoSort(nodeIds, reversed);
    const orderedIds = order ?? nodeIds; // fallback to natural order on cycles

    // Build DebugStep for each snippet in execution order
    this.steps = orderedIds.map((id, index) => {
      const snippet = snippets.find((s) => s.id === id);
      const label = snippet
        ? `${snippet.name} (${snippet.kind})`
        : id;

      const outgoing = edges.filter((e) => e.sourceSnippetId === id);
      const incoming = edges.filter((e) => e.targetSnippetId === id);

      return { index, snippetId: id, label, outgoing, incoming };
    });
  }

  /** Advance to the next step. Returns the step or null if finished. */
  step(): DebugStep | null {
    if (this.steps.length === 0) return null;

    this.currentIndex++;
    if (this.currentIndex >= this.steps.length) {
      this.currentIndex = this.steps.length; // clamp
      this.setState('finished');
      return null;
    }

    const s = this.steps[this.currentIndex];
    this.setState('stepping');
    this.callbacks.onStep(s, this.steps.length);
    return s;
  }

  /** Go back one step */
  stepBack(): DebugStep | null {
    if (this.steps.length === 0 || this.currentIndex <= 0) return null;

    this.currentIndex--;
    const s = this.steps[this.currentIndex];
    this.setState('stepping');
    this.callbacks.onStep(s, this.steps.length);
    return s;
  }

  /** Reset to the beginning */
  reset(): void {
    this.pause();
    this.currentIndex = -1;
    this.setState('idle');
    this.callbacks.onReset();
  }

  /** Start auto-stepping at the configured interval */
  play(): void {
    if (this.state === 'playing') return;
    if (this.currentIndex >= this.steps.length) {
      // restart from beginning if finished
      this.currentIndex = -1;
    }
    this.setState('playing');
    this.playTimer = setInterval(() => {
      const s = this.step();
      if (!s) {
        this.pause();
      }
    }, this.playIntervalMs);
  }

  /** Pause auto-stepping */
  pause(): void {
    if (this.playTimer !== null) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    if (this.state === 'playing') {
      this.setState(this.currentIndex >= this.steps.length ? 'finished' : 'stepping');
    }
  }

  /** Toggle play/pause */
  togglePlay(): void {
    if (this.state === 'playing') {
      this.pause();
    } else {
      this.play();
    }
  }

  /** Set the auto-play speed in milliseconds per step */
  setSpeed(ms: number): void {
    this.playIntervalMs = Math.max(200, ms);
    // If currently playing, restart the timer with new speed
    if (this.state === 'playing') {
      this.pause();
      this.play();
    }
  }

  getState(): StepperState {
    return this.state;
  }

  getCurrentStep(): DebugStep | null {
    if (this.currentIndex < 0 || this.currentIndex >= this.steps.length) return null;
    return this.steps[this.currentIndex];
  }

  getTotalSteps(): number {
    return this.steps.length;
  }

  private setState(s: StepperState): void {
    this.state = s;
    this.callbacks.onStateChange(s);
  }
}
