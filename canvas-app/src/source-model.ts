// ═══════════════════════════════════════════════════════════════════════════════
//  SourceModel — Single TypeScript source file model
//  The user's code lives in ONE virtual TypeScript file. All maxGraph blocks
//  are views into snippets of this single file. Edits in any block propagate
//  back to the unified source. Monaco gets full-file IntelliSense.
// ═══════════════════════════════════════════════════════════════════════════════

import type * as ts from 'typescript';
import {
  parseTypeScript,
  reconstructSource,
  type TsSnippet,
  type ParseResult,
  type SnippetReference,
  type ReferenceKind,
} from './ts-parser';
import { bus } from './reactive';

export interface SourceModelEvents {
  /** Fired after re-parse with the new snippet list */
  'source:parsed': ParseResult;
  /** Fired when a snippet's code changes */
  'snippet:changed': { snippetId: string; newCode: string };
  /** Fired when a snippet is extracted from another */
  'snippet:extracted': { original: TsSnippet; extracted: TsSnippet };
  /** Fired when the full source text changes */
  'source:changed': string;
}

/** Semantic edge between two snippet blocks */
export interface SemanticEdge {
  sourceSnippetId: string;
  targetSnippetId: string;
  kind: ReferenceKind;
  label: string;
}

/**
 * The central model: one TypeScript source file, parsed into snippets.
 * Blocks on the canvas are views into these snippets.
 */
export class SourceModel {
  private sourceText: string;
  private snippets: TsSnippet[] = [];
  private tsCompiler: typeof ts;
  private parseResult: ParseResult | null = null;

  constructor(initialSource: string, tsCompiler: typeof ts) {
    this.sourceText = initialSource;
    this.tsCompiler = tsCompiler;
    this.reparse();
  }

  // ─── Getters ─────────────────────────────────────────────────────────────

  getSourceText(): string {
    return this.sourceText;
  }

  getSnippets(): readonly TsSnippet[] {
    return this.snippets;
  }

  getSnippet(id: string): TsSnippet | undefined {
    return this.snippets.find((s) => s.id === id);
  }

  getSnippetByName(name: string): TsSnippet | undefined {
    return this.snippets.find((s) => s.name === name || s.declares.includes(name));
  }

  getParseResult(): ParseResult | null {
    return this.parseResult;
  }

  // ─── Source Manipulation ─────────────────────────────────────────────────

  /** Replace the full source text and re-parse */
  setSourceText(text: string): void {
    this.sourceText = text;
    this.reparse();
    bus.emit('source:changed', text);
  }

  /** Update a single snippet's code and rebuild the source */
  updateSnippetCode(snippetId: string, newCode: string): void {
    const idx = this.snippets.findIndex((s) => s.id === snippetId);
    if (idx === -1) return;

    this.snippets[idx] = { ...this.snippets[idx], code: newCode };
    this.sourceText = reconstructSource(this.snippets);
    // Re-parse to get fresh references and positions
    this.reparsePreservingIds();
    bus.emit('snippet:changed', { snippetId, newCode });
    bus.emit('source:changed', this.sourceText);
  }

  /** Add a new snippet (appended to the source) */
  addSnippet(code: string): TsSnippet | null {
    this.sourceText = this.sourceText.trimEnd() + '\n\n' + code;
    this.reparse();
    bus.emit('source:changed', this.sourceText);
    // Return the last snippet (the one we just added)
    return this.snippets[this.snippets.length - 1] ?? null;
  }

  /** Remove a snippet and reconstruct the source */
  removeSnippet(snippetId: string): void {
    this.snippets = this.snippets.filter((s) => s.id !== snippetId);
    this.sourceText = reconstructSource(this.snippets);
    this.reparse();
    bus.emit('source:changed', this.sourceText);
  }

  // ─── Semantic Edges ──────────────────────────────────────────────────────

  /** Compute all semantic edges between snippets */
  computeEdges(): SemanticEdge[] {
    const edges: SemanticEdge[] = [];
    const nameToId = new Map<string, string>();
    for (const s of this.snippets) {
      for (const d of s.declares) {
        const baseName = d.includes('.') ? d.split('.')[0] : d;
        nameToId.set(baseName, s.id);
      }
    }

    for (const snippet of this.snippets) {
      for (const ref of snippet.references) {
        const targetId = nameToId.get(ref.name);
        if (targetId && targetId !== snippet.id) {
          // Edge goes from the snippet that references → the snippet that declares
          edges.push({
            sourceSnippetId: snippet.id,
            targetSnippetId: targetId,
            kind: ref.kind,
            label: formatEdgeLabel(ref),
          });
        }
      }
    }

    // Deduplicate edges with same source, target, and kind
    const seen = new Set<string>();
    return edges.filter((e) => {
      const key = `${e.sourceSnippetId}→${e.targetSnippetId}:${e.kind}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ─── Internal ────────────────────────────────────────────────────────────

  private reparse(): void {
    this.parseResult = parseTypeScript(this.sourceText, this.tsCompiler);
    this.snippets = this.parseResult.snippets;
    bus.emit('source:parsed', this.parseResult);
  }

  /**
   * Re-parse but try to preserve snippet IDs by matching on name+kind.
   * This keeps the canvas stable when the user edits a snippet.
   */
  private reparsePreservingIds(): void {
    const oldMap = new Map(this.snippets.map((s) => [`${s.kind}:${s.name}`, s.id]));
    this.parseResult = parseTypeScript(this.sourceText, this.tsCompiler);
    // Restore IDs where possible
    for (const newSnip of this.parseResult.snippets) {
      const key = `${newSnip.kind}:${newSnip.name}`;
      const oldId = oldMap.get(key);
      if (oldId) {
        newSnip.id = oldId;
      }
    }
    this.snippets = this.parseResult.snippets;
    bus.emit('source:parsed', this.parseResult);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function formatEdgeLabel(ref: SnippetReference): string {
  switch (ref.kind) {
    case 'extends': return `extends ${ref.name}`;
    case 'implements': return `implements ${ref.name}`;
    case 'type-ref': return `⟨${ref.name}⟩`;
    case 'calls': return `calls ${ref.name}`;
    case 'instantiates': return `new ${ref.name}`;
    case 'imports': return `imports ${ref.name}`;
    case 'uses-variable': return `uses ${ref.name}`;
    case 'uses-type': return `uses type ${ref.name}`;
    default: return ref.name;
  }
}

// ─── Default Example Source ────────────────────────────────────────────────

export const DEFAULT_SOURCE = `\
// ═══════════════════════════════════════════════════════════════
//  Example TypeScript source file
//  Each top-level item becomes a block on the canvas
// ═══════════════════════════════════════════════════════════════

interface Shape {
  name: string;
  area(): number;
  perimeter(): number;
}

interface Colorable {
  color: string;
  setColor(c: string): void;
}

class Circle implements Shape, Colorable {
  color: string = '#3498db';

  constructor(public radius: number) {}

  get name(): string {
    return 'Circle';
  }

  area(): number {
    return Math.PI * this.radius ** 2;
  }

  perimeter(): number {
    return 2 * Math.PI * this.radius;
  }

  setColor(c: string): void {
    this.color = c;
  }
}

class Rectangle implements Shape {
  constructor(
    public width: number,
    public height: number
  ) {}

  get name(): string {
    return 'Rectangle';
  }

  area(): number {
    return this.width * this.height;
  }

  perimeter(): number {
    return 2 * (this.width + this.height);
  }
}

class Square extends Rectangle {
  constructor(side: number) {
    super(side, side);
  }

  get name(): string {
    return 'Square';
  }
}

type ShapeCollection = Shape[];

function describeShape(s: Shape): string {
  return \`\${s.name}: area=\${s.area().toFixed(2)}, perimeter=\${s.perimeter().toFixed(2)}\`;
}

function totalArea(shapes: ShapeCollection): number {
  return shapes.reduce((sum, s) => sum + s.area(), 0);
}

const myCircle = new Circle(5);

const mySquare = new Square(4);

const allShapes: ShapeCollection = [myCircle, mySquare];

const report = allShapes.map(describeShape).join('\\n');
`;
