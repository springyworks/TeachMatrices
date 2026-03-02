// ═══════════════════════════════════════════════════════════════════════════════
//  GraphCanvas — TypeScript Snippet Blocks on a 2D maxGraph Canvas
//  Uses the "Hybrid Layer" approach: maxGraph manages edges/routing in SVG,
//  while each SnippetBlock lives in a standard HTML div positioned absolutely
//  on top, synchronized to the vertex's screen coordinates.
//  Semantic edges are derived from TypeScript AST analysis.
// ═══════════════════════════════════════════════════════════════════════════════

import {
  Graph,
  Cell,
  InternalEvent,
  type CellStyle,
  EventObject,
} from '@maxgraph/core';
import { SnippetBlock } from './code-block';
import { bus, topoSort } from './reactive';
import type { SourceModel, SemanticEdge } from './source-model';
import type { TsSnippet, ReferenceKind, SnippetKind } from './ts-parser';
import { ForceLayout, type ForceNode, type ForceEdge } from './force-layout';

interface BlockRecord {
  block: SnippetBlock;
  cell: Cell;
  overlay: HTMLDivElement;
  snippetId: string;
}

interface EdgeRecord {
  sourceSnippetId: string;
  targetSnippetId: string;
  kind: ReferenceKind;
  cell: Cell;
}

/** Edge styles based on TypeScript relationship types */
const EDGE_STYLES: Record<ReferenceKind, Partial<CellStyle>> = {
  extends: {
    strokeColor: '#c0a0ff',
    strokeWidth: 2,
    endArrow: 'block',
    endFill: false,
    endSize: 12,
  },
  implements: {
    strokeColor: '#80d0ff',
    strokeWidth: 2,
    endArrow: 'block',
    endFill: false,
    endSize: 10,
    dashed: true,
  },
  'type-ref': {
    strokeColor: '#80d0ff',
    strokeWidth: 1,
    endArrow: 'open',
    endSize: 6,
    dashed: true,
  },
  calls: {
    strokeColor: '#64ffb4',
    strokeWidth: 2,
    endArrow: 'classic',
    endSize: 8,
    rounded: true,
  },
  instantiates: {
    strokeColor: '#ffa080',
    strokeWidth: 2,
    endArrow: 'classic',
    endSize: 8,
  },
  imports: {
    strokeColor: '#888',
    strokeWidth: 1,
    endArrow: 'open',
    endSize: 6,
    dashed: true,
  },
  'uses-variable': {
    strokeColor: '#ffdc28',
    strokeWidth: 1,
    endArrow: 'open',
    endSize: 6,
    rounded: true,
  },
  'uses-type': {
    strokeColor: '#80d0ff',
    strokeWidth: 1,
    endArrow: 'open',
    endSize: 6,
    dashed: true,
  },
};

/** Default block sizes by snippet kind */
const DEFAULT_SIZES: Record<SnippetKind, { w: number; h: number }> = {
  class: { w: 400, h: 320 },
  interface: { w: 360, h: 240 },
  'type-alias': { w: 320, h: 140 },
  enum: { w: 320, h: 200 },
  function: { w: 380, h: 220 },
  variable: { w: 340, h: 140 },
  import: { w: 360, h: 100 },
  export: { w: 300, h: 100 },
  namespace: { w: 400, h: 300 },
  'module-level': { w: 340, h: 160 },
};

export class GraphCanvas {
  readonly graph: Graph;
  private container: HTMLElement;
  private overlayLayer: HTMLDivElement;
  private blocks = new Map<string, BlockRecord>();
  private edges: EdgeRecord[] = [];
  private statusBar: HTMLElement | null;
  private sourceModel: SourceModel | null = null;
  private forceLayout: ForceLayout | null = null;
  private animatingPositions = false;
  private selectedIds = new Set<string>();
  private rubberBandEl: HTMLDivElement | null = null;
  private rubberBandStart: { x: number; y: number } | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.statusBar = document.getElementById('status-bar');

    // ── Overlay Layer ───────────────────────────────────────────────────
    container.style.position = 'relative';
    this.overlayLayer = document.createElement('div');
    this.overlayLayer.id = 'overlay-layer';
    Object.assign(this.overlayLayer.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '10',
      overflow: 'hidden',
    });
    container.appendChild(this.overlayLayer);

    // ── maxGraph Instance ────────────────────────────────────────────────
    this.graph = new Graph(container);
    this.graph.setHtmlLabels(false);
    this.graph.setAllowDanglingEdges(false);
    this.graph.setCellsResizable(true);  // enable resize handles
    this.graph.setCellsMovable(false);
    this.graph.setConnectable(false); // edges are auto-derived from TS semantics

    // We handle rubberband selection ourselves on the overlay layer
    // new RubberBandHandler(this.graph);

    // ── Sync overlays when cells are resized ────────────────────────────
    this.graph.addListener(InternalEvent.CELLS_RESIZED, () => {
      this.syncAllOverlays();
      // Also trigger Monaco relayout in all visible blocks
      for (const [, rec] of this.blocks) {
        const geo = rec.cell.getGeometry();
        if (geo && rec.block.editor) {
          rec.block.editor.layout();
        }
      }
    });

    // Hide labels on snippet vertices — overlays render everything
    this.graph.convertValueToString = (cell: Cell): string => {
      const v = cell.getValue();
      if (v && typeof v === 'object' && 'snippetId' in v) return '';
      if (typeof v === 'string') return v;
      return '';
    };

    // ── Sync overlays when the view transforms (zoom / pan) ────────────
    const view = this.graph.getView();
    view.addListener(InternalEvent.SCALE_AND_TRANSLATE, () => this.syncAllOverlays());
    view.addListener(InternalEvent.SCALE, () => this.syncAllOverlays());
    view.addListener(InternalEvent.TRANSLATE, () => this.syncAllOverlays());

    // ── Default vertex style ──
    const vs = this.graph.getStylesheet().getDefaultVertexStyle();
    vs.fillColor = '#1a1a2e';
    vs.strokeColor = '#2a2a4a';
    vs.strokeWidth = 2;
    vs.rounded = true;
    vs.arcSize = 8;
    vs.fontColor = '#e0e0e8';
    vs.fontSize = 0;
    vs.opacity = 40;

    // ── Default edge style ──
    const es = this.graph.getStylesheet().getDefaultEdgeStyle();
    es.strokeColor = '#64ffb4';
    es.strokeWidth = 2;
    es.rounded = true;
    es.fontColor = '#aaa';
    es.fontSize = 10;
    es.fontFamily = 'Fira Code, JetBrains Mono, monospace';

    // ── Selection: rubberband on overlay layer background ──
    this.setupOverlaySelection();

    // ── Listen for snippet code changes from blocks ──
    bus.on('snippet:code-changed', (data: { snippetId: string; code: string }) => {
      if (this.sourceModel) {
        this.sourceModel.updateSnippetCode(data.snippetId, data.code);
        // Debounced edge refresh
        this.scheduleEdgeRefresh();
      }
    });

    // ── Listen for extract requests ──
    bus.on('block:extract-request', (data: { snippetId: string }) => {
      this.handleExtractRequest(data.snippetId);
    });
  }

  // ─── Source Model Binding ──────────────────────────────────────────────────

  /** Bind to a source model — creates blocks for all snippets and auto-edges */
  bindSourceModel(model: SourceModel): void {
    this.sourceModel = model;
    this.clearAll();
    this.buildFromModel();
  }

  /** Rebuild the entire canvas from the current source model */
  private buildFromModel(): void {
    if (!this.sourceModel) return;

    const snippets = this.sourceModel.getSnippets();

    // Create blocks for each snippet with auto-layout positions
    const cols = Math.ceil(Math.sqrt(snippets.length));
    let i = 0;
    for (const snippet of snippets) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const size = DEFAULT_SIZES[snippet.kind] ?? { w: 360, h: 200 };
      this.addSnippetBlock(snippet, {
        x: 40 + col * (size.w + 60),
        y: 40 + row * (size.h + 40),
        width: size.w,
        height: size.h,
      });
      i++;
    }

    // Create semantic edges
    this.refreshEdges();

    this.setStatus(`Parsed ${snippets.length} TypeScript items`);
  }

  // ─── Block Management ──────────────────────────────────────────────────────

  /** Add a snippet block to the canvas */
  addSnippetBlock(
    snippet: TsSnippet,
    pos: { x: number; y: number; width: number; height: number }
  ): string {
    const id = snippet.id;

    // Don't add duplicate blocks
    if (this.blocks.has(id)) {
      const existing = this.blocks.get(id)!;
      existing.block.updateSnippet(snippet);
      return id;
    }

    const block = new SnippetBlock({
      snippet,
      sharedModelUri: {} as any, // TODO: shared model integration
    });

    const parent = this.graph.getDefaultParent();
    let cell!: Cell;
    this.graph.batchUpdate(() => {
      cell = this.graph.insertVertex({
        parent,
        value: { snippetId: id },
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
      });
    });

    const overlay = document.createElement('div');
    overlay.className = 'cell-overlay';
    overlay.appendChild(block.getElement());
    this.overlayLayer.appendChild(overlay);

    this.blocks.set(id, { block, cell, overlay, snippetId: id });

    this.syncOverlay(id);
    this.setupHeaderDrag(id);
    this.setupResizeHandles(id);
    this.setupOverlayClick(id);

    requestAnimationFrame(() => {
      block.initEditor();
    });

    return id;
  }

  // ─── Semantic Edge Management ──────────────────────────────────────────────

  /** Clear all edges and recompute from the source model */
  refreshEdges(): void {
    if (!this.sourceModel) return;

    // Remove existing edge cells
    this.graph.batchUpdate(() => {
      for (const edge of this.edges) {
        this.graph.removeCells([edge.cell]);
      }
    });
    this.edges = [];

    // Compute new edges from AST
    const semanticEdges = this.sourceModel.computeEdges();

    this.graph.batchUpdate(() => {
      for (const se of semanticEdges) {
        const src = this.blocks.get(se.sourceSnippetId);
        const tgt = this.blocks.get(se.targetSnippetId);
        if (!src || !tgt) continue;

        const style = EDGE_STYLES[se.kind] ?? EDGE_STYLES['uses-variable'];
        const edgeCell = this.graph.insertEdge({
          parent: this.graph.getDefaultParent(),
          value: se.label,
          source: src.cell,
          target: tgt.cell,
          style,
        });

        this.edges.push({
          sourceSnippetId: se.sourceSnippetId,
          targetSnippetId: se.targetSnippetId,
          kind: se.kind,
          cell: edgeCell,
        });
      }
    });

    this.setStatus(`${semanticEdges.length} semantic connections`);
  }

  private edgeRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Schedule a debounced edge refresh (avoid re-parsing on every keystroke) */
  private scheduleEdgeRefresh(): void {
    if (this.edgeRefreshTimer) clearTimeout(this.edgeRefreshTimer);
    this.edgeRefreshTimer = setTimeout(() => {
      this.refreshEdges();
      // Also update block metadata from refreshed snippets
      if (this.sourceModel) {
        for (const snippet of this.sourceModel.getSnippets()) {
          const rec = this.blocks.get(snippet.id);
          if (rec) {
            rec.block.updateSnippet(snippet);
          }
        }
      }
    }, 800);
  }

  // ─── Extract Request ───────────────────────────────────────────────────────

  private handleExtractRequest(snippetId: string): void {
    const rec = this.blocks.get(snippetId);
    if (!rec || !this.sourceModel) return;

    // Prompt user for which item to extract
    const snippet = this.sourceModel.getSnippet(snippetId);
    if (!snippet) return;

    // For classes, list methods; for multi-var statements, list vars
    const items: string[] = [];
    for (const d of snippet.declares) {
      if (d.includes('.')) {
        items.push(d.split('.').pop()!);
      }
    }

    if (items.length === 0) {
      this.setStatus('Nothing to extract from this block');
      return;
    }

    const itemName = prompt(
      `Extract which item from "${snippet.name}"?\n\nAvailable: ${items.join(', ')}`
    );
    if (!itemName) return;

    // For now, just add a new snippet with a placeholder
    const newCode = `// Extracted from ${snippet.name}\nfunction ${itemName}() {\n  // TODO: implement\n}`;
    const newSnippet = this.sourceModel.addSnippet(newCode);
    if (newSnippet) {
      const geo = rec.cell.getGeometry();
      this.addSnippetBlock(newSnippet, {
        x: (geo?.x ?? 100) + 450,
        y: (geo?.y ?? 100),
        width: 380,
        height: 200,
      });
      this.refreshEdges();
      this.setStatus(`Extracted "${itemName}" from "${snippet.name}"`);
    }
  }

  // ─── Layout ────────────────────────────────────────────────────────────────

  /** Auto-layout: arrange blocks by dependency layers */
  autoLayout(): void {
    const entries = [...this.blocks.entries()];
    if (entries.length === 0) return;

    // Group by snippet kind for nicer layout
    const groups = new Map<string, BlockRecord[]>();
    for (const [, rec] of entries) {
      const kind = rec.block.kind;
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind)!.push(rec);
    }

    // Layout order: imports → interfaces/types → classes → functions → variables → statements
    const kindOrder: SnippetKind[] = [
      'import',
      'interface',
      'type-alias',
      'enum',
      'class',
      'function',
      'variable',
      'namespace',
      'export',
      'module-level',
    ];

    // Compute target positions
    const targets = new Map<string, { x: number; y: number }>();
    let currentY = 40;
    for (const kind of kindOrder) {
      const group = groups.get(kind);
      if (!group || group.length === 0) continue;

      const cols = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(group.length))));
      const size = DEFAULT_SIZES[kind] ?? { w: 360, h: 200 };
      let maxH = 0;

      group.forEach((rec, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const x = 40 + col * (size.w + 60);
        const y = currentY + row * (size.h + 40);
        targets.set(rec.snippetId, { x, y });
        maxH = Math.max(maxH, y + size.h);
      });

      currentY = maxH + 60;
    }

    this.animateToPositions(targets, 500);
    this.setStatus('Layout applied');
  }

  // ─── Force-Directed Float Layout ───────────────────────────────────────────

  /**
   * Run a force-directed "float" layout with animated wobbly settling.
   * Connected nodes attract each other (shorter edges), all nodes repel.
   * The animation shows the nodes swimming to their final positions.
   */
  floatLayout(): void {
    if (this.blocks.size === 0) return;

    // Stop any previous simulation
    if (this.forceLayout) this.forceLayout.stop();

    // Build simulation nodes from current block positions
    const simNodes: Array<{ id: string; x: number; y: number; width: number; height: number }> = [];
    for (const [id, rec] of this.blocks) {
      const geo = rec.cell.getGeometry();
      simNodes.push({
        id,
        x: geo?.x ?? 0,
        y: geo?.y ?? 0,
        width: geo?.width ?? 360,
        height: geo?.height ?? 200,
      });
    }

    // Build simulation edges from current semantic edges
    const simEdges: ForceEdge[] = this.edges.map((e) => ({
      source: e.sourceSnippetId,
      target: e.targetSnippetId,
      kind: e.kind,
    }));

    this.forceLayout = new ForceLayout({
      repulsion: 12000,
      attraction: 0.008,
      idealLength: 280,
      damping: 0.82,       // wobbly
      gravity: 0.015,
      maxSpeed: 25,
      temperature: 1.0,
      cooling: 0.992,
      minTemperature: 0.008,
    });
    this.forceLayout.init(simNodes, simEdges);

    this.setStatus('⟳ Float layout running...');

    this.forceLayout.start((nodes, progress, settled) => {
      // Apply positions from simulation to graph cells
      this.graph.batchUpdate(() => {
        for (const n of nodes) {
          const rec = this.blocks.get(n.id);
          if (!rec) continue;
          const geo = rec.cell.getGeometry()?.clone();
          if (geo) {
            geo.x = n.x;
            geo.y = n.y;
            this.graph.getDataModel().setGeometry(rec.cell, geo);
          }
        }
      });

      this.graph.refresh();
      this.syncAllOverlays();

      if (settled) {
        this.setStatus(`Float layout settled (${Math.round(progress * 100)}%)`);
      }
    });
  }

  /** Stop any running force simulation */
  stopFloat(): void {
    if (this.forceLayout) {
      this.forceLayout.stop();
      this.forceLayout = null;
      this.setStatus('Float layout stopped');
    }
  }

  // ─── Animated Position Transition ──────────────────────────────────────────

  /**
   * Smoothly animate all blocks from current positions to target positions.
   * Creates a wobbly easing effect (spring-like overshoot).
   */
  animateToPositions(
    targets: Map<string, { x: number; y: number }>,
    durationMs: number = 600
  ): void {
    if (this.animatingPositions) return;
    this.animatingPositions = true;

    // Capture start positions
    const starts = new Map<string, { x: number; y: number }>();
    for (const [id, rec] of this.blocks) {
      const geo = rec.cell.getGeometry();
      if (geo) starts.set(id, { x: geo.x, y: geo.y });
    }

    const t0 = performance.now();

    const frame = (now: number) => {
      const elapsed = now - t0;
      const rawT = Math.min(1, elapsed / durationMs);
      // Elastic ease-out for wobbly effect
      const t = elasticEaseOut(rawT);

      this.graph.batchUpdate(() => {
        for (const [id, target] of targets) {
          const start = starts.get(id);
          const rec = this.blocks.get(id);
          if (!start || !rec) continue;

          const geo = rec.cell.getGeometry()?.clone();
          if (geo) {
            geo.x = start.x + (target.x - start.x) * t;
            geo.y = start.y + (target.y - start.y) * t;
            this.graph.getDataModel().setGeometry(rec.cell, geo);
          }
        }
      });

      this.graph.refresh();
      this.syncAllOverlays();

      if (rawT < 1) {
        requestAnimationFrame(frame);
      } else {
        this.animatingPositions = false;
      }
    };

    requestAnimationFrame(frame);
  }

  // ─── Resize Block ──────────────────────────────────────────────────────────

  /**
   * Resize a block to a new height (used by the height toggle).
   * Animates the transition smoothly.
   */
  resizeBlock(snippetId: string, newHeight: number): void {
    const rec = this.blocks.get(snippetId);
    if (!rec) return;

    const geo = rec.cell.getGeometry()?.clone();
    if (!geo) return;

    const oldH = geo.height;
    const durationMs = 300;
    const t0 = performance.now();

    const frame = (now: number) => {
      const elapsed = now - t0;
      const rawT = Math.min(1, elapsed / durationMs);
      const t = easeOutCubic(rawT);

      const currentGeo = rec.cell.getGeometry()?.clone();
      if (currentGeo) {
        currentGeo.height = oldH + (newHeight - oldH) * t;
        this.graph.getDataModel().setGeometry(rec.cell, currentGeo);
      }

      this.syncOverlay(snippetId);
      this.graph.refresh();
      if (rec.block.editor) rec.block.editor.layout();

      if (rawT < 1) {
        requestAnimationFrame(frame);
      }
    };

    requestAnimationFrame(frame);
  }

  /** Fit the view to show all blocks */
  fitToView(): void {
    if (this.blocks.size === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [, rec] of this.blocks) {
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

  // ─── Source File Panel ─────────────────────────────────────────────────────

  /** Get the full reconstructed source text */
  getSourceText(): string {
    return this.sourceModel?.getSourceText() ?? '';
  }

  // ─── Overlay Sync ──────────────────────────────────────────────────────────

  private syncOverlay(blockId: string): void {
    const rec = this.blocks.get(blockId);
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

  private syncAllOverlays(): void {
    for (const [id] of this.blocks) {
      this.syncOverlay(id);
    }
  }

  // ─── Header Drag ───────────────────────────────────────────────────────────

  private setupHeaderDrag(blockId: string): void {
    const rec = this.blocks.get(blockId);
    if (!rec) return;
    const header = rec.overlay.querySelector('.cell-header') as HTMLElement | null;
    if (!header) return;

    let dragging = false;
    let didMove = false;
    let startMouseX = 0;
    let startMouseY = 0;
    let origPositions = new Map<string, { x: number; y: number }>();

    const onMouseDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).tagName === 'BUTTON') return;
      e.preventDefault();
      e.stopPropagation();
      dragging = true;
      didMove = false;
      startMouseX = e.clientX;
      startMouseY = e.clientY;

      // Handle selection on mousedown
      if (e.ctrlKey || e.metaKey) {
        // Ctrl+click: toggle selection
        if (this.selectedIds.has(blockId)) {
          this.deselectBlock(blockId);
        } else {
          this.selectBlock(blockId);
        }
      } else if (e.shiftKey) {
        // Shift+click: add to selection
        this.selectBlock(blockId);
      } else if (!this.selectedIds.has(blockId)) {
        // Plain click on unselected: select only this
        this.clearSelection();
        this.selectBlock(blockId);
      }
      // Plain click on already-selected: keep selection (for multi-drag)

      // Capture original positions of all blocks we'll move
      origPositions.clear();
      const idsToMove = this.selectedIds.has(blockId)
        ? this.selectedIds
        : new Set([blockId]);
      for (const id of idsToMove) {
        const r = this.blocks.get(id);
        const geo = r?.cell.getGeometry();
        if (geo) origPositions.set(id, { x: geo.x, y: geo.y });
      }

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const scale = this.graph.getView().getScale();
      const dx = (e.clientX - startMouseX) / scale;
      const dy = (e.clientY - startMouseY) / scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didMove = true;
      if (!didMove) return;

      // If float is running, pin moved nodes and reheat so others adjust
      if (this.forceLayout?.isRunning()) {
        for (const [id, orig] of origPositions) {
          this.forceLayout.pinNode(id, orig.x + dx, orig.y + dy);
        }
        this.forceLayout.reheat(0.3);
      }

      for (const [id, orig] of origPositions) {
        const r = this.blocks.get(id);
        if (!r) continue;
        const geo = r.cell.getGeometry()?.clone();
        if (geo) {
          geo.x = orig.x + dx;
          geo.y = orig.y + dy;
          this.graph.getDataModel().setGeometry(r.cell, geo);
        }
        this.syncOverlay(id);
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      dragging = false;
      // If plain click (no drag, no modifier) on already-selected node,
      // select only this one now
      if (!didMove && !e.ctrlKey && !e.metaKey && !e.shiftKey && this.selectedIds.size > 1) {
        this.clearSelection();
        this.selectBlock(blockId);
      }
      origPositions.clear();
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      this.graph.refresh();
      this.syncAllOverlays();
    };

    header.addEventListener('mousedown', onMouseDown);
  }

  // ─── Resize Handles ────────────────────────────────────────────────────────

  private setupResizeHandles(blockId: string): void {
    const rec = this.blocks.get(blockId);
    if (!rec) return;

    const directions: Array<{
      cls: string;
      cursor: string;
      dx: number;   // -1=left, 0=none, 1=right
      dy: number;   // -1=top, 0=none, 1=bottom
    }> = [
      { cls: 'nw', cursor: 'nw-resize', dx: -1, dy: -1 },
      { cls: 'n',  cursor: 'n-resize',  dx: 0,  dy: -1 },
      { cls: 'ne', cursor: 'ne-resize', dx: 1,  dy: -1 },
      { cls: 'w',  cursor: 'w-resize',  dx: -1, dy: 0 },
      { cls: 'e',  cursor: 'e-resize',  dx: 1,  dy: 0 },
      { cls: 'sw', cursor: 'sw-resize', dx: -1, dy: 1 },
      { cls: 's',  cursor: 's-resize',  dx: 0,  dy: 1 },
      { cls: 'se', cursor: 'se-resize', dx: 1,  dy: 1 },
    ];

    for (const dir of directions) {
      const handle = document.createElement('div');
      handle.className = `resize-handle resize-${dir.cls}`;
      handle.style.cursor = dir.cursor;
      rec.overlay.appendChild(handle);

      let dragging = false;
      let startMouseX = 0;
      let startMouseY = 0;
      let origX = 0;
      let origY = 0;
      let origW = 0;
      let origH = 0;

      const onMouseDown = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dragging = true;
        startMouseX = e.clientX;
        startMouseY = e.clientY;
        const geo = rec.cell.getGeometry();
        if (geo) {
          origX = geo.x;
          origY = geo.y;
          origW = geo.width;
          origH = geo.height;
        }
        document.body.style.cursor = dir.cursor;
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };

      const onMouseMove = (e: MouseEvent) => {
        if (!dragging) return;
        const scale = this.graph.getView().getScale();
        const dxPx = (e.clientX - startMouseX) / scale;
        const dyPx = (e.clientY - startMouseY) / scale;

        const geo = rec.cell.getGeometry()?.clone();
        if (!geo) return;

        const minW = 180;
        const minH = 80;

        if (dir.dx === -1) {
          const maxDx = origW - minW;
          const clampedDx = Math.min(dxPx, maxDx);
          geo.x = origX + clampedDx;
          geo.width = origW - clampedDx;
        } else if (dir.dx === 1) {
          geo.width = Math.max(minW, origW + dxPx);
        }

        if (dir.dy === -1) {
          const maxDy = origH - minH;
          const clampedDy = Math.min(dyPx, maxDy);
          geo.y = origY + clampedDy;
          geo.height = origH - clampedDy;
        } else if (dir.dy === 1) {
          geo.height = Math.max(minH, origH + dyPx);
        }

        this.graph.getDataModel().setGeometry(rec.cell, geo);
        this.syncOverlay(blockId);
        if (rec.block.editor) rec.block.editor.layout();
      };

      const onMouseUp = () => {
        dragging = false;
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
        this.graph.refresh();
        this.syncAllOverlays();
      };

      handle.addEventListener('mousedown', onMouseDown);
    }
  }

  // ─── Selection ─────────────────────────────────────────────────────────────

  private setupOverlayClick(blockId: string): void {
    const rec = this.blocks.get(blockId);
    if (!rec) return;

    // Use mousedown on the overlay for selection, but only when the target
    // isn't an interactive element (editor, buttons, resize handles).
    // The header has its own mousedown handler that also handles selection.
    rec.overlay.addEventListener('mousedown', (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Skip if clicking on interactive child elements
      if (
        target.closest('.cell-header') ||
        target.closest('.editor-area') ||
        target.closest('.resize-handle') ||
        target.closest('.result-panel') ||
        target.tagName === 'BUTTON'
      ) {
        return;
      }

      e.stopPropagation();
      if (e.ctrlKey || e.metaKey) {
        if (this.selectedIds.has(blockId)) {
          this.deselectBlock(blockId);
        } else {
          this.selectBlock(blockId);
        }
      } else if (e.shiftKey) {
        this.selectBlock(blockId);
      } else {
        this.clearSelection();
        this.selectBlock(blockId);
      }
    });
  }

  private setupOverlaySelection(): void {
    // Rubberband selection: triggered by mousedown on the container background
    // (i.e. the SVG layer or container itself, not on overlays).
    let dragging = false;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // Only start rubberband when clicking on the actual canvas background.
      // That means: the container itself, the SVG root, or SVG child elements
      // that are NOT part of an overlay.
      if (target.closest('.cell-overlay') || target.closest('#overlay-layer')) return;

      // Deselect all on plain click on empty area
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
        this.clearSelection();
      }

      dragging = true;
      const rect = this.container.getBoundingClientRect();
      const startX = e.clientX - rect.left;
      const startY = e.clientY - rect.top;

      this.rubberBandEl = document.createElement('div');
      this.rubberBandEl.className = 'rubberband-selection';
      Object.assign(this.rubberBandEl.style, {
        left: `${startX}px`,
        top: `${startY}px`,
        width: '0px',
        height: '0px',
      });
      this.container.appendChild(this.rubberBandEl);
      this.rubberBandStart = { x: startX, y: startY };

      const onMouseMove = (e2: MouseEvent) => {
        if (!dragging || !this.rubberBandEl || !this.rubberBandStart) return;
        const r = this.container.getBoundingClientRect();
        const curX = e2.clientX - r.left;
        const curY = e2.clientY - r.top;

        const left = Math.min(this.rubberBandStart.x, curX);
        const top = Math.min(this.rubberBandStart.y, curY);
        const width = Math.abs(curX - this.rubberBandStart.x);
        const height = Math.abs(curY - this.rubberBandStart.y);

        Object.assign(this.rubberBandEl.style, {
          left: `${left}px`,
          top: `${top}px`,
          width: `${width}px`,
          height: `${height}px`,
        });
      };

      const onMouseUp = (e2: MouseEvent) => {
        dragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);

        if (this.rubberBandEl && this.rubberBandStart) {
          const r = this.container.getBoundingClientRect();
          const curX = e2.clientX - r.left;
          const curY = e2.clientY - r.top;

          const left = Math.min(this.rubberBandStart.x, curX);
          const top = Math.min(this.rubberBandStart.y, curY);
          const width = Math.abs(curX - this.rubberBandStart.x);
          const height = Math.abs(curY - this.rubberBandStart.y);

          // Select intersecting blocks if rubberband is large enough
          if (width > 5 || height > 5) {
            const band = { left, top, right: left + width, bottom: top + height };

            if (!e2.shiftKey && !e2.ctrlKey && !e2.metaKey) {
              this.clearSelection();
            }

            for (const [id, rec] of this.blocks) {
              const ol = rec.overlay;
              const olLeft = parseFloat(ol.style.left) || 0;
              const olTop = parseFloat(ol.style.top) || 0;
              const olRight = olLeft + (parseFloat(ol.style.width) || 0);
              const olBottom = olTop + (parseFloat(ol.style.height) || 0);

              if (
                olRight > band.left &&
                olLeft < band.right &&
                olBottom > band.top &&
                olTop < band.bottom
              ) {
                this.selectBlock(id);
              }
            }
          }

          this.rubberBandEl.remove();
          this.rubberBandEl = null;
          this.rubberBandStart = null;
        }
      };

      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    };

    // Listen on the container (captures clicks on SVG background)
    this.container.addEventListener('mousedown', onMouseDown);
  }

  private selectBlock(blockId: string): void {
    this.selectedIds.add(blockId);
    const rec = this.blocks.get(blockId);
    if (rec) {
      rec.overlay.classList.add('selected');
    }
  }

  private deselectBlock(blockId: string): void {
    this.selectedIds.delete(blockId);
    const rec = this.blocks.get(blockId);
    if (rec) {
      rec.overlay.classList.remove('selected');
    }
  }

  clearSelection(): void {
    for (const id of this.selectedIds) {
      const rec = this.blocks.get(id);
      if (rec) rec.overlay.classList.remove('selected');
    }
    this.selectedIds.clear();
  }

  getSelectedIds(): ReadonlySet<string> {
    return this.selectedIds;
  }

  // ─── Misc ──────────────────────────────────────────────────────────────────

  getBlock(id: string): SnippetBlock | undefined {
    return this.blocks.get(id)?.block;
  }

  getAllBlockIds(): string[] {
    return [...this.blocks.keys()];
  }

  getEdges(): readonly EdgeRecord[] {
    return this.edges;
  }

  getSourceModel(): SourceModel | null {
    return this.sourceModel;
  }

  // ─── Debug Step Visualization ──────────────────────────────────────────────

  /** Highlight a block as the "active" step */
  highlightBlock(snippetId: string): void {
    const rec = this.blocks.get(snippetId);
    if (rec) {
      rec.overlay.classList.add('debug-active');
    }
  }

  /** Remove all debug highlights from blocks */
  clearBlockHighlights(): void {
    for (const [, rec] of this.blocks) {
      rec.overlay.classList.remove('debug-active');
    }
  }

  /**
   * Animate an edge with directional flow.
   * direction: 'forward' = source→target, 'reverse' = target→source
   */
  animateEdge(edgeRec: { cell: Cell; kind: string }, direction: 'forward' | 'reverse'): void {
    const state = this.graph.getView().getState(edgeRec.cell);
    if (!state || !state.shape) return;
    const svgEl = (state.shape as { node?: SVGElement }).node;
    if (!svgEl) return;

    // Find the main path element(s) in the edge shape
    const paths = svgEl.querySelectorAll<SVGPathElement>('path');
    paths.forEach((path) => {
      path.classList.add('debug-edge-active');
      path.classList.add(direction === 'reverse' ? 'debug-edge-reverse' : 'debug-edge-forward');
    });
  }

  /** Remove all debug animation classes from edges */
  clearEdgeAnimations(): void {
    // Query all SVG paths in the graph container
    const svg = this.container.querySelector('svg');
    if (!svg) return;
    svg.querySelectorAll<SVGPathElement>('.debug-edge-active').forEach((p) => {
      p.classList.remove('debug-edge-active', 'debug-edge-forward', 'debug-edge-reverse');
    });
  }

  /** Clear all debug visuals (blocks + edges) */
  clearDebugVisuals(): void {
    this.clearBlockHighlights();
    this.clearEdgeAnimations();
  }

  /**
   * Apply a full debug step:
   * 1. Clear previous visuals
   * 2. Highlight the active block
   * 3. Animate incoming edges (forward: source→this block)
   * 4. Animate outgoing edges (forward: this block→targets)
   */
  applyDebugStep(
    snippetId: string,
    incomingEdges: Array<{ sourceSnippetId: string; targetSnippetId: string; kind: string }>,
    outgoingEdges: Array<{ sourceSnippetId: string; targetSnippetId: string; kind: string }>
  ): void {
    this.clearDebugVisuals();
    this.highlightBlock(snippetId);

    // Animate incoming edges (dependencies flowing INTO this block → forward direction)
    for (const se of incomingEdges) {
      const edgeRec = this.edges.find(
        (e) =>
          e.sourceSnippetId === se.sourceSnippetId &&
          e.targetSnippetId === se.targetSnippetId &&
          e.kind === se.kind
      );
      if (edgeRec) this.animateEdge(edgeRec, 'forward');
    }

    // Animate outgoing edges (this block producing → forward direction)
    for (const se of outgoingEdges) {
      const edgeRec = this.edges.find(
        (e) =>
          e.sourceSnippetId === se.sourceSnippetId &&
          e.targetSnippetId === se.targetSnippetId &&
          e.kind === se.kind
      );
      if (edgeRec) this.animateEdge(edgeRec, 'forward');
    }
  }

  clearAll(): void {
    for (const [, rec] of this.blocks) {
      rec.block.dispose();
      rec.overlay.remove();
    }
    this.blocks.clear();
    this.edges = [];
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

// ─── Easing Helpers ────────────────────────────────────────────────────────

/** Elastic ease-out: spring-like overshoot for wobbly settling */
function elasticEaseOut(t: number): number {
  if (t === 0 || t === 1) return t;
  const p = 0.4;
  return Math.pow(2, -10 * t) * Math.sin(((t - p / 4) * (2 * Math.PI)) / p) + 1;
}

/** Smooth cubic ease-out */
function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}
