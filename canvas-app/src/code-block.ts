// ═══════════════════════════════════════════════════════════════════════════════
//  SnippetBlock — A Monaco editor block showing one TypeScript snippet
//  Part of the single-source-file model: each block is a view into a piece
//  of the user's TypeScript source. Monaco shares a single model for
//  IntelliSense (Go to Definition, references, completions, etc.)
// ═══════════════════════════════════════════════════════════════════════════════

import * as monaco from 'monaco-editor';
import { bus } from './reactive';
import type { SnippetKind, TsSnippet } from './ts-parser';

/** Badge colors for different snippet kinds */
const BADGE_COLORS: Record<SnippetKind, string> = {
  class: '#c0a0ff',
  interface: '#80d0ff',
  'type-alias': '#80d0ff',
  enum: '#ffa080',
  function: '#64ffb4',
  variable: '#ffdc28',
  import: '#888',
  export: '#888',
  namespace: '#c0a0ff',
  'module-level': '#aaa',
};

export interface SnippetBlockOptions {
  snippet: TsSnippet;
  /** The shared Monaco model URI (all blocks share one virtual TS file) */
  sharedModelUri: monaco.Uri;
}

/**
 * Represents a single snippet block on the canvas.
 * Owns a Monaco editor configured to show a specific range of the
 * shared TypeScript source file.
 */
export class SnippetBlock {
  readonly snippetId: string;
  kind: SnippetKind;
  name: string;

  private root: HTMLDivElement;
  private editorContainer: HTMLDivElement;
  private infoPanel: HTMLDivElement;
  private infoContent: HTMLDivElement;
  private headerTitle: HTMLSpanElement;
  private badge: HTMLSpanElement;
  private foldBtn: HTMLButtonElement;
  private extractBtn: HTMLButtonElement;
  private heightToggleBtn: HTMLButtonElement;
  private compact = false;

  editor: monaco.editor.IStandaloneCodeEditor | null = null;
  private disposeChangeListener: monaco.IDisposable | null = null;

  /** The code this block displays */
  private currentCode: string;

  /** Lines in the snippet */
  declares: string[];
  references: TsSnippet['references'];
  exported: boolean;

  constructor(opts: SnippetBlockOptions) {
    const { snippet } = opts;
    this.snippetId = snippet.id;
    this.kind = snippet.kind;
    this.name = snippet.name;
    this.currentCode = snippet.code;
    this.declares = [...snippet.declares];
    this.references = [...snippet.references];
    this.exported = snippet.exported;

    // Build DOM
    this.root = document.createElement('div');
    this.root.className = 'code-cell';
    this.root.dataset.snippetId = this.snippetId;

    // Header
    const header = document.createElement('div');
    header.className = 'cell-header';

    this.headerTitle = document.createElement('span');
    this.headerTitle.className = 'cell-title';
    this.headerTitle.textContent = this.name;

    this.badge = document.createElement('span');
    this.badge.className = 'cell-type-badge';
    this.badge.textContent = snippet.kind;
    this.badge.style.color = BADGE_COLORS[snippet.kind] ?? '#aaa';

    // Export indicator
    if (snippet.exported) {
      const expBadge = document.createElement('span');
      expBadge.className = 'cell-type-badge export-badge';
      expBadge.textContent = 'export';
      expBadge.style.color = '#64ffb4';
      header.appendChild(expBadge);
    }

    this.extractBtn = document.createElement('button');
    this.extractBtn.textContent = '⤴';
    this.extractBtn.title = 'Extract item from this block';
    this.extractBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      bus.emit('block:extract-request', { snippetId: this.snippetId });
    });

    this.heightToggleBtn = document.createElement('button');
    this.heightToggleBtn.className = 'height-toggle-btn';
    this.heightToggleBtn.textContent = '▼';
    this.heightToggleBtn.title = 'Toggle compact / expanded height';
    this.heightToggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.compact = !this.compact;
      this.heightToggleBtn.textContent = this.compact ? '▲' : '▼';
      bus.emit('block:height-toggle', {
        snippetId: this.snippetId,
        compact: this.compact,
      });
    });

    this.foldBtn = document.createElement('button');
    this.foldBtn.textContent = '⌄';
    this.foldBtn.title = 'Toggle info panel';
    this.foldBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleInfo();
    });

    header.append(this.headerTitle, this.badge, this.heightToggleBtn, this.extractBtn, this.foldBtn);

    // Editor area
    this.editorContainer = document.createElement('div');
    this.editorContainer.className = 'editor-area';

    // Info panel (shows declares, references, etc.)
    this.infoPanel = document.createElement('div');
    this.infoPanel.className = 'result-panel';
    this.infoContent = document.createElement('div');
    this.infoContent.className = 'result-content';
    this.infoPanel.appendChild(this.infoContent);

    this.root.append(header, this.editorContainer, this.infoPanel);
  }

  /** Call once the root element is visible in the DOM with nonzero dimensions */
  initEditor(): void {
    if (this.editor) return;

    this.editor = monaco.editor.create(this.editorContainer, {
      value: this.currentCode,
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
      glyphMargin: false,
      folding: true,
      renderLineHighlight: 'all',
      scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        verticalScrollbarSize: 8,
        horizontalScrollbarSize: 8,
      },
      padding: { top: 4, bottom: 4 },
      // Enable rich IntelliSense features
      quickSuggestions: true,
      suggestOnTriggerCharacters: true,
      parameterHints: { enabled: true },
      hover: { enabled: true },
    });

    // Emit change events so the source model can update
    this.disposeChangeListener = this.editor.onDidChangeModelContent(() => {
      const newCode = this.getCode();
      this.currentCode = newCode;
      bus.emit(`snippet:code-changed`, {
        snippetId: this.snippetId,
        code: newCode,
      });
    });

    // Show info panel with snippet metadata
    this.updateInfoPanel();
  }

  getElement(): HTMLDivElement {
    return this.root;
  }

  getCode(): string {
    return this.editor?.getValue() ?? this.currentCode;
  }

  setCode(code: string): void {
    this.currentCode = code;
    if (this.editor) {
      // Avoid triggering the change listener for programmatic updates
      const model = this.editor.getModel();
      if (model && model.getValue() !== code) {
        model.setValue(code);
      }
    }
  }

  /** Update the snippet metadata and refresh display */
  updateSnippet(snippet: TsSnippet): void {
    this.kind = snippet.kind;
    this.name = snippet.name;
    this.declares = [...snippet.declares];
    this.references = [...snippet.references];
    this.exported = snippet.exported;

    this.headerTitle.textContent = this.name;
    this.badge.textContent = snippet.kind;
    this.badge.style.color = BADGE_COLORS[snippet.kind] ?? '#aaa';

    this.setCode(snippet.code);
    this.updateInfoPanel();
  }

  private updateInfoPanel(): void {
    const lines: string[] = [];
    if (this.declares.length > 0) {
      lines.push(`Declares: ${this.declares.join(', ')}`);
    }
    if (this.references.length > 0) {
      lines.push(`References:`);
      for (const ref of this.references) {
        lines.push(`  ${ref.kind} → ${ref.name}`);
      }
    }
    if (this.exported) {
      lines.push('Exported: yes');
    }
    this.infoContent.textContent = lines.join('\n') || '(no declarations)';
    this.infoContent.className = 'result-content info';
  }

  private toggleInfo(): void {
    const open = this.infoPanel.classList.toggle('open');
    this.foldBtn.textContent = open ? '⌃' : '⌄';
  }

  dispose(): void {
    this.disposeChangeListener?.dispose();
    this.editor?.dispose();
  }
}
