// ═══════════════════════════════════════════════════════════════════════════════
//  CodeBlock — Manages a Monaco editor instance inside a DOM container
// ═══════════════════════════════════════════════════════════════════════════════

import * as monaco from 'monaco-editor';
import { bus } from './reactive';
import { Matrix } from './matrix';

/** The type badge displayed in cell headers */
export type CellKind = 'class' | 'instance' | 'function' | 'matrix';

export interface CodeBlockOptions {
  id: string;
  title: string;
  kind: CellKind;
  initialCode: string;
}

/**
 * Represents a single code cell on the canvas.
 * Owns a Monaco editor and an expandable result panel.
 */
export class CodeBlock {
  readonly id: string;
  readonly kind: CellKind;
  title: string;

  private root: HTMLDivElement;
  private editorContainer: HTMLDivElement;
  private resultPanel: HTMLDivElement;
  private resultContent: HTMLDivElement;
  private headerTitle: HTMLSpanElement;
  private runBtn: HTMLButtonElement;
  private foldBtn: HTMLButtonElement;

  editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private disposeChangeListener: monaco.IDisposable | null = null;

  /** Latest execution result — accessible by downstream cells */
  lastResult: unknown = undefined;
  lastError: string | null = null;

  constructor(opts: CodeBlockOptions) {
    this.id = opts.id;
    this.kind = opts.kind;
    this.title = opts.title;

    // Build DOM
    this.root = document.createElement('div');
    this.root.className = 'code-cell';
    this.root.dataset.cellId = this.id;

    // Header
    const header = document.createElement('div');
    header.className = 'cell-header';

    this.headerTitle = document.createElement('span');
    this.headerTitle.className = 'cell-title';
    this.headerTitle.textContent = this.title;

    const badge = document.createElement('span');
    badge.className = `cell-type-badge ${this.kind}`;
    badge.textContent = this.kind;

    this.runBtn = document.createElement('button');
    this.runBtn.textContent = '▶';
    this.runBtn.title = 'Run cell';
    this.runBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.run();
    });

    this.foldBtn = document.createElement('button');
    this.foldBtn.textContent = '⌄';
    this.foldBtn.title = 'Toggle result';
    this.foldBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleResult();
    });

    header.append(this.headerTitle, badge, this.runBtn, this.foldBtn);

    // Editor area
    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'editor-area';

    // Result panel
    this.resultPanel = document.createElement('div');
    this.resultPanel.className = 'result-panel';
    this.resultContent = document.createElement('div');
    this.resultContent.className = 'result-content';
    this.resultPanel.appendChild(this.resultContent);

    this.root.append(header, this.editorContainer, this.resultPanel);

    // Defer Monaco init until the element is actually mounted (needs dimensions)
    this.deferredCode = opts.initialCode;
  }

  private deferredCode: string;

  /** Call once the root element is visible in the DOM with nonzero dimensions */
  initEditor(): void {
    if (this.editor) return;

    this.editor = monaco.editor.create(this.editorContainer, {
      value: this.deferredCode,
      language: 'typescript',
      theme: 'vs-dark',
      minimap: { enabled: false },
      lineNumbers: 'on',
      fontSize: 12,
      scrollBeyondLastLine: false,
      automaticLayout: true,
      tabSize: 2,
      wordWrap: 'on',
      overviewRulerLanes: 0,
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      padding: { top: 4, bottom: 4 },
    });

    // Emit change events so downstream cells can react
    this.disposeChangeListener = this.editor.onDidChangeModelContent(() => {
      bus.emit(`cell:changed:${this.id}`, this.getCode());
    });
  }

  getElement(): HTMLDivElement {
    return this.root;
  }

  getCode(): string {
    return this.editor?.getValue() ?? this.deferredCode;
  }

  setCode(code: string): void {
    if (this.editor) {
      this.editor.setValue(code);
    } else {
      this.deferredCode = code;
    }
  }

  /** Execute the cell's TypeScript code in a sandboxed scope */
  run(context: Record<string, unknown> = {}): unknown {
    const code = this.getCode();
    try {
      // Build a scope with Matrix and any upstream values
      const scope: Record<string, unknown> = {
        Matrix,
        ...context,
      };
      const keys = Object.keys(scope);
      const vals = keys.map((k) => scope[k]);

      // Execute via Function constructor (safer than eval, no access to local scope)
      const fn = new Function(...keys, code);
      const result = fn(...vals);

      this.lastResult = result;
      this.lastError = null;
      this.showResult(result);
      bus.emit(`cell:result:${this.id}`, result);
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.lastResult = undefined;
      this.lastError = msg;
      this.showError(msg);
      bus.emit(`cell:error:${this.id}`, msg);
      return undefined;
    }
  }

  private showResult(value: unknown): void {
    this.resultContent.className = 'result-content success';
    if (value instanceof Matrix) {
      this.resultContent.innerHTML = value.toHtml();
    } else if (value === undefined) {
      this.resultContent.textContent = '(no return value)';
    } else {
      try {
        this.resultContent.textContent =
          typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      } catch {
        this.resultContent.textContent = String(value);
      }
    }
    this.resultPanel.classList.add('open');
    this.foldBtn.textContent = '⌃';
  }

  private showError(msg: string): void {
    this.resultContent.className = 'result-content error';
    this.resultContent.textContent = `Error: ${msg}`;
    this.resultPanel.classList.add('open');
    this.foldBtn.textContent = '⌃';
  }

  toggleResult(): void {
    const open = this.resultPanel.classList.toggle('open');
    this.foldBtn.textContent = open ? '⌃' : '⌄';
  }

  dispose(): void {
    this.disposeChangeListener?.dispose();
    this.editor?.dispose();
  }
}
