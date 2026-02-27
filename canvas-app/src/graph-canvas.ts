// ═══════════════════════════════════════════════════════════════════════════════
//  GraphCanvas — Orchestrates maxGraph + Monaco CodeBlocks on a 2D canvas
//  Uses the "Hybrid Layer" approach: the graph stays in SVG for edges/routing,
//  while each CodeBlock lives in a standard HTML div positioned absolutely on
//  top of the graph, synchronized to the cell's screen coordinates.
//  This avoids the foreignObject rendering issues that prevent Monaco from
//  displaying inside SVG.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  Graph,
  Cell,
  InternalEvent,
  RubberBandHandler,
  type CellStyle,
} from '@maxgraph/core';
import { CodeBlock, type CellKind } from './code-block';
import { bus, topoSort } from './reactive';

/** SysML-inspired relationship types */
export type EdgeKind = 'dataflow' | 'inheritance' | 'containment' | 'dependency';

interface CellRecord {
  block: CodeBlock;
  cell: Cell;
  overlay: HTMLDivElement; // absolutely-positioned div over the graph
}

interface EdgeRecord {
  sourceId: string;
  targetId: string;
  kind: EdgeKind;
  cell: Cell;
}

const EDGE_STYLES: Record<EdgeKind, Partial<CellStyle>> = {
  dataflow: {
    strokeColor: '#64ffb4',
    strokeWidth: 2,
    endArrow: 'classic',
    endSize: 8,
    rounded: true,
  },
  inheritance: {
    strokeColor: '#c0a0ff',
    strokeWidth: 2,
    endArrow: 'block',
    endFill: false,
    endSize: 12,
    dashed: true,
  },
  containment: {
    strokeColor: '#80d0ff',
    strokeWidth: 2,
    endArrow: 'diamond',
    endFill: true,
    endSize: 10,
  },
  dependency: {
    strokeColor: '#888',
    strokeWidth: 1,
    endArrow: 'open',
    endSize: 6,
    dashed: true,
  },
};

let cellCounter = 0;

export class GraphCanvas {
  readonly graph: Graph;
  private container: HTMLElement;
  private overlayLayer: HTMLDivElement;
  private cells = new Map<string, CellRecord>();
  private edges: EdgeRecord[] = [];
  private statusBar: HTMLElement | null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.statusBar = document.getElementById('status-bar');

    // ── Overlay Layer ───────────────────────────────────────────────────
    // A sibling div that sits on top of the SVG canvas. Each CodeBlock
    // is appended here as an absolutely-positioned child.
    container.style.position = 'relative';

    this.overlayLayer = document.createElement('div');
    this.overlayLayer.id = 'overlay-layer';
    Object.assign(this.overlayLayer.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none', // let clicks fall through to SVG by default
      zIndex: '10',
      overflow: 'hidden',
    });
    container.appendChild(this.overlayLayer);

    // ── maxGraph Instance ────────────────────────────────────────────────
    this.graph = new Graph(container);
    this.graph.setHtmlLabels(false); // no HTML labels — overlays handle rendering
    this.graph.setAllowDanglingEdges(false);
    this.graph.setCellsResizable(false); // overlay drag handles position
    this.graph.setCellsMovable(false); // we handle moves via overlay header drag
    this.graph.setConnectable(true);

    new RubberBandHandler(this.graph);

    // Hide labels on code-block vertices — overlays render everything
    this.graph.convertValueToString = (cell: Cell): string => {
      const v = cell.getValue();
      if (v && typeof v === 'object' && 'blockId' in v) return '';
      if (typeof v === 'string') return v;
      return '';
    };

    // ── Sync overlays when the view transforms (zoom / pan) ────────────
    const view = this.graph.getView();
    view.addListener(InternalEvent.SCALE_AND_TRANSLATE, () => this.syncAllOverlays());
    view.addListener(InternalEvent.SCALE, () => this.syncAllOverlays());
    view.addListener(InternalEvent.TRANSLATE, () => this.syncAllOverlays());

    // ── Default vertex style (semi-transparent placeholder for edge routing) ──
    const vs = this.graph.getStylesheet().getDefaultVertexStyle();
    vs.fillColor = '#1a1a2e';
    vs.strokeColor = '#2a2a4a';
    vs.strokeWidth = 2;
    vs.rounded = true;
    vs.arcSize = 8;
    vs.fontColor = '#e0e0e8';
    vs.fontSize = 0; // no visible label
    vs.opacity = 40; // ghost rectangle so edges connect visibly

    // ── Default edge style ───────────────────────────────────────────────
    const es = this.graph.getStylesheet().getDefaultEdgeStyle();
    es.strokeColor = '#64ffb4';
    es.strokeWidth = 2;
    es.rounded = true;
    es.fontColor = '#aaa';
    es.fontSize = 11;
    es.fontFamily = 'Fira Code, JetBrains Mono, monospace';
  }

  // ─── Cell Management ───────────────────────────────────────────────────────

  /** Add a new code cell to the canvas */
  addCodeCell(opts: {
    title?: string;
    kind?: CellKind;
    code?: string;
    x?: number;
    y?: number;
    width?: number;
    height?: number;
  }): string {
    cellCounter++;
    const id = `cell_${cellCounter}`;
    const block = new CodeBlock({
      id,
      title: opts.title ?? `Cell ${cellCounter}`,
      kind: opts.kind ?? 'function',
      initialCode: opts.code ?? '// TypeScript here\nreturn 42;',
    });

    const x = opts.x ?? 40 + (cellCounter - 1) * 30;
    const y = opts.y ?? 40 + (cellCounter - 1) * 30;
    const w = opts.width ?? 360;
    const h = opts.height ?? 240;

    // Insert a lightweight vertex into the graph for edge routing
    const parent = this.graph.getDefaultParent();
    let cell!: Cell;
    this.graph.batchUpdate(() => {
      cell = this.graph.insertVertex({
        parent,
        value: { blockId: id },
        x,
        y,
        width: w,
        height: h,
      });
    });

    // Create the overlay div (real HTML, not inside SVG)
    const overlay = document.createElement('div');
    overlay.className = 'cell-overlay';
    overlay.appendChild(block.getElement());
    this.overlayLayer.appendChild(overlay);

    this.cells.set(id, { block, cell, overlay });

    // Position overlay to match the cell's screen coords
    this.syncOverlay(id);

    // Enable drag-to-move via the cell header
    this.setupHeaderDrag(id);

    // Init Monaco once the overlay is in the DOM and has dimensions
    requestAnimationFrame(() => {
      block.initEditor();
    });

    this.setStatus(`Added cell: ${block.title}`);
    return id;
  }

  /** Add a matrix cell with pre-filled code */
  addMatrixCell(opts?: {
    title?: string;
    rows?: number;
    cols?: number;
    x?: number;
    y?: number;
  }): string {
    const rows = opts?.rows ?? 4;
    const cols = opts?.cols ?? 4;
    const code = [
      `// ${opts?.title ?? 'Matrix'} — ${rows}×${cols}`,
      `const m = Matrix.random(${rows}, ${cols}, 0, 10);`,
      `return m.map((v) => Math.round(v));`,
    ].join('\n');

    return this.addCodeCell({
      title: opts?.title ?? 'Matrix',
      kind: 'matrix',
      code,
      x: opts?.x,
      y: opts?.y,
      width: 380,
      height: 280,
    });
  }

  // ─── Edge Management ───────────────────────────────────────────────────────

  /** Connect two cells with a SysML-style edge */
  addEdge(
    sourceId: string,
    targetId: string,
    kind: EdgeKind = 'dataflow',
    label?: string
  ): void {
    const src = this.cells.get(sourceId);
    const tgt = this.cells.get(targetId);
    if (!src || !tgt) throw new Error(`Unknown cell ID: ${sourceId} or ${targetId}`);

    const style = EDGE_STYLES[kind];
    const parent = this.graph.getDefaultParent();
    let edgeCell!: Cell;

    this.graph.batchUpdate(() => {
      edgeCell = this.graph.insertEdge({
        parent,
        value: label ?? kind,
        source: src.cell,
        target: tgt.cell,
        style,
      });
    });

    this.edges.push({ sourceId, targetId, kind, cell: edgeCell });

    // For dataflow edges, wire up reactive re-execution
    if (kind === 'dataflow') {
      bus.on(`cell:result:${sourceId}`, () => {
        this.runCell(targetId);
      });
    }

    this.setStatus(`Connected: ${sourceId} → ${targetId} (${kind})`);
  }

  // ─── Execution ─────────────────────────────────────────────────────────────

  /** Run a single cell, injecting upstream results as context */
  runCell(id: string): void {
    const rec = this.cells.get(id);
    if (!rec) return;

    const context: Record<string, unknown> = {};
    for (const edge of this.edges) {
      if (edge.targetId === id && edge.kind === 'dataflow') {
        const upstream = this.cells.get(edge.sourceId);
        if (upstream) {
          context[edge.sourceId] = upstream.block.lastResult;
          const cleanName = upstream.block.title
            .replace(/[^a-zA-Z0-9_]/g, '_')
            .replace(/^(\d)/, '_$1');
          context[cleanName] = upstream.block.lastResult;
        }
      }
    }

    rec.block.run(context);
  }

  /** Run all cells in topological order */
  runAll(): void {
    const nodeIds = [...this.cells.keys()];
    const dfEdges = this.edges
      .filter((e) => e.kind === 'dataflow')
      .map((e) => ({ source: e.sourceId, target: e.targetId }));

    const order = topoSort(nodeIds, dfEdges);
    if (!order) {
      this.setStatus('Error: Circular dependency detected!');
      return;
    }

    this.setStatus('Running all cells...');
    for (const id of order) {
      this.runCell(id);
    }
    this.setStatus(`Executed ${order.length} cells`);
  }

  // ─── Layout ────────────────────────────────────────────────────────────────

  /** Auto-layout: simple grid arrangement */
  autoLayout(): void {
    const entries = [...this.cells.entries()];
    const cols = Math.ceil(Math.sqrt(entries.length));
    const padX = 420;
    const padY = 320;

    this.graph.batchUpdate(() => {
      entries.forEach(([, rec], i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const geo = rec.cell.getGeometry();
        if (geo) {
          geo.x = 40 + col * padX;
          geo.y = 40 + row * padY;
        }
      });
    });
    this.graph.refresh();
    this.syncAllOverlays();
    this.setStatus('Layout applied');
  }

  /** Fit the view to show all cells */
  fitToView(): void {
    if (this.cells.size === 0) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [, rec] of this.cells) {
      const geo = rec.cell.getGeometry();
      if (geo) {
        minX = Math.min(minX, geo.x);
        minY = Math.min(minY, geo.y);
        maxX = Math.max(maxX, geo.x + geo.width);
        maxY = Math.max(maxY, geo.y + geo.height);
      }
    }
    if (!isFinite(minX)) return;

    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const margin = 40;
    const gw = maxX - minX + margin * 2;
    const gh = maxY - minY + margin * 2;
    const scale = Math.min(1, cw / gw, ch / gh);
    const tx = (cw / scale - (maxX - minX)) / 2 - minX;
    const ty = (ch / scale - (maxY - minY)) / 2 - minY;

    this.graph.getView().scaleAndTranslate(scale, tx, ty);
    this.syncAllOverlays();
    this.setStatus('View fitted');
  }

  // ─── Overlay Sync ──────────────────────────────────────────────────────────

  /** Position a single overlay div to match the cell's screen coordinates */
  private syncOverlay(blockId: string): void {
    const rec = this.cells.get(blockId);
    if (!rec) return;
    const state = this.graph.getView().getState(rec.cell);
    if (state) {
      Object.assign(rec.overlay.style, {
        left: `${state.x}px`,
        top: `${state.y}px`,
        width: `${state.width}px`,
        height: `${state.height}px`,
      });
    } else {
      // Fallback: use raw geometry (before view is validated)
      const geo = rec.cell.getGeometry();
      if (geo) {
        const view = this.graph.getView();
        const s = view.getScale();
        const t = view.getTranslate();
        Object.assign(rec.overlay.style, {
          left: `${(geo.x + t.x) * s}px`,
          top: `${(geo.y + t.y) * s}px`,
          width: `${geo.width * s}px`,
          height: `${geo.height * s}px`,
        });
      }
    }
  }

  /** Re-sync all overlays (called on pan / zoom / layout changes) */
  private syncAllOverlays(): void {
    for (const [id] of this.cells) {
      this.syncOverlay(id);
    }
  }

  // ─── Header Drag ───────────────────────────────────────────────────────────

  /** Drag cell by its header — moves the graph vertex + overlay together */
  private setupHeaderDrag(blockId: string): void {
    const rec = this.cells.get(blockId);
    if (!rec) return;
    const header = rec.overlay.querySelector('.cell-header') as HTMLElement | null;
    if (!header) return;

    let dragging = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let origGeoX = 0;
    let origGeoY = 0;

    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      startMouseX = e.clientX;
      startMouseY = e.clientY;
      const geo = rec.cell.getGeometry();
      if (geo) {
        origGeoX = geo.x;
        origGeoY = geo.y;
      }
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const scale = this.graph.getView().getScale();
      const dx = (e.clientX - startMouseX) / scale;
      const dy = (e.clientY - startMouseY) / scale;
      const geo = rec.cell.getGeometry()?.clone();
      if (geo) {
        geo.x = origGeoX + dx;
        geo.y = origGeoY + dy;
        this.graph.getDataModel().setGeometry(rec.cell, geo);
      }
      this.syncOverlay(blockId);
    };

    const onMouseUp = () => {
      dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this.graph.refresh(); // re-route edges to new positions
      this.syncAllOverlays();
    };

    header.addEventListener('mousedown', onMouseDown);
  }

  // ─── Misc ──────────────────────────────────────────────────────────────────

  getBlock(id: string): CodeBlock | undefined {
    return this.cells.get(id)?.block;
  }

  getAllCellIds(): string[] {
    return [...this.cells.keys()];
  }

  /** Remove all cells and edges from the canvas */
  clearAll(): void {
    for (const [, rec] of this.cells) {
      rec.block.dispose();
      rec.overlay.remove();
    }
    this.cells.clear();
    this.edges = [];
    cellCounter = 0;
    bus.clear();

    this.graph.removeCells(
      this.graph.getChildCells(this.graph.getDefaultParent(), true, true)
    );
    this.setStatus('Canvas cleared');
  }

  private setStatus(msg: string): void {
    if (this.statusBar) this.statusBar.textContent = msg;
  }
}
