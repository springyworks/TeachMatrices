// ═══════════════════════════════════════════════════════════════════════════════
//  KosmodTS — TypeScript Structure Explorer
//  Parses a single TypeScript source file into AST-driven snippet blocks
//  displayed on a maxGraph canvas with Monaco editors.
//  Semantic connections (extends, implements, calls, uses) are auto-derived.
// ═══════════════════════════════════════════════════════════════════════════════

import './style.css';
import '@maxgraph/core/css/common.css';
import * as monaco from 'monaco-editor';
import { GraphCanvas } from './graph-canvas';
import { SourceModel, DEFAULT_SOURCE } from './source-model';
import { loadTypeScript } from './ts-parser';
import { DebugStepper } from './debug-stepper';
import { bus } from './reactive';
import type { SnippetKind } from './ts-parser';

/** Default expanded heights by kind (matches DEFAULT_SIZES in graph-canvas) */
const DEFAULT_SIZES_FOR_HEIGHT: Record<SnippetKind, number> = {
  class: 320,
  interface: 240,
  'type-alias': 140,
  enum: 200,
  function: 220,
  variable: 140,
  import: 100,
  export: 100,
  namespace: 300,
  'module-level': 160,
};

// ─── Monaco Worker Setup (required by Vite) ──────────────────────────────────

import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker';

self.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new tsWorker();
    }
    return new editorWorker();
  },
};

// ─── Configure Monaco TypeScript Defaults ────────────────────────────────────

function configureMonacoTS(): void {
  const tsDefaults = monaco.languages.typescript.typescriptDefaults;
  tsDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.Latest,
    module: monaco.languages.typescript.ModuleKind.ESNext,
    strict: true,
    noEmit: true,
    esModuleInterop: true,
    allowJs: false,
    declaration: true,
    lib: ['es2022', 'dom'],
  });
  tsDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false,
  });
}

// ─── Tab Management ──────────────────────────────────────────────────────────

type TabId = 'canvas' | 'source';

function setupTabs(
  canvas: GraphCanvas,
  sourceModel: SourceModel
): void {
  const tabCanvas = document.getElementById('tab-canvas')!;
  const tabSource = document.getElementById('tab-source')!;
  const canvasView = document.getElementById('canvas-view')!;
  const sourceView = document.getElementById('source-view')!;
  const sourceEditorEl = document.getElementById('source-editor')!;

  let sourceEditor: monaco.editor.IStandaloneCodeEditor | null = null;
  let activeTab: TabId = 'canvas';

  function switchTab(tab: TabId): void {
    activeTab = tab;
    tabCanvas.classList.toggle('active', tab === 'canvas');
    tabSource.classList.toggle('active', tab === 'source');
    canvasView.style.display = tab === 'canvas' ? 'flex' : 'none';
    sourceView.style.display = tab === 'source' ? 'flex' : 'none';

    if (tab === 'source') {
      if (!sourceEditor) {
        sourceEditor = monaco.editor.create(sourceEditorEl, {
          value: sourceModel.getSourceText(),
          language: 'typescript',
          theme: 'vs-dark',
          minimap: { enabled: true },
          lineNumbers: 'on',
          fontSize: 13,
          scrollBeyondLastLine: true,
          automaticLayout: true,
          tabSize: 2,
          wordWrap: 'off',
          folding: true,
          renderLineHighlight: 'all',
          glyphMargin: true,
          // Full IntelliSense — same as VS Code
          quickSuggestions: true,
          suggestOnTriggerCharacters: true,
          parameterHints: { enabled: true },
          hover: { enabled: true },
        });

        // When user edits full source, re-parse and rebuild canvas
        sourceEditor.onDidChangeModelContent(() => {
          const newText = sourceEditor!.getValue();
          sourceModel.setSourceText(newText);
        });
      } else {
        // Sync the editor with latest source (blocks may have changed it)
        const current = sourceEditor.getValue();
        const latest = sourceModel.getSourceText();
        if (current !== latest) {
          sourceEditor.setValue(latest);
        }
      }
    }

    if (tab === 'canvas') {
      // Rebuild canvas from model when switching back
      canvas.bindSourceModel(sourceModel);
    }
  }

  tabCanvas.addEventListener('click', () => switchTab('canvas'));
  tabSource.addEventListener('click', () => switchTab('source'));
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const container = document.getElementById('graph-container');
  if (!container) throw new Error('Missing #graph-container');

  // Configure Monaco for full TypeScript IntelliSense
  configureMonacoTS();

  // Load the TypeScript compiler for AST parsing
  const tsCompiler = await loadTypeScript();

  // Create the source model from the default example
  const sourceModel = new SourceModel(DEFAULT_SOURCE, tsCompiler);

  // Create the canvas and bind to the model
  const canvas = new GraphCanvas(container);
  canvas.bindSourceModel(sourceModel);

  // Setup tabbed view (canvas / source)
  setupTabs(canvas, sourceModel);

  // ── Toolbar Bindings ──

  document.getElementById('btn-add-snippet')?.addEventListener('click', () => {
    const code = prompt('Enter TypeScript code for the new snippet:', 'function example(): void {\n  // your code here\n}');
    if (code) {
      sourceModel.addSnippet(code);
      canvas.bindSourceModel(sourceModel);
    }
  });

  document.getElementById('btn-layout')?.addEventListener('click', () => {
    canvas.autoLayout();
  });

  document.getElementById('btn-fit')?.addEventListener('click', () => {
    canvas.fitToView();
  });

  // Float layout (force-directed with wobbly settling)
  const btnFloat = document.getElementById('btn-float')!;
  let floating = false;
  btnFloat.addEventListener('click', () => {
    if (floating) {
      canvas.stopFloat();
      btnFloat.textContent = '🌊 Float';
      btnFloat.classList.remove('active');
      floating = false;
    } else {
      canvas.floatLayout();
      btnFloat.textContent = '⏹ Stop';
      btnFloat.classList.add('active');
      floating = true;
    }
  });

  // Height toggle from code blocks
  bus.on('block:height-toggle', (data: { snippetId: string; compact: boolean }) => {
    // Compact: 120px, Expanded: use the default size for the snippet kind
    const block = canvas.getBlock(data.snippetId);
    if (!block) return;
    const defaultH = DEFAULT_SIZES_FOR_HEIGHT[block.kind] ?? 200;
    const newH = data.compact ? 120 : defaultH;
    canvas.resizeBlock(data.snippetId, newH);
  });

  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    canvas.bindSourceModel(sourceModel);
  });

  document.getElementById('btn-example')?.addEventListener('click', () => {
    sourceModel.setSourceText(DEFAULT_SOURCE);
    canvas.bindSourceModel(sourceModel);
    stepper.buildSteps(sourceModel);
  });

  // ── Debug Stepper ──

  const debugStepInfo = document.getElementById('debug-step-info')!;
  const btnPlay = document.getElementById('btn-debug-play')!;
  const debugSpeedInput = document.getElementById('debug-speed') as HTMLInputElement;

  const stepper = new DebugStepper({
    onStep(step, total) {
      canvas.applyDebugStep(step.snippetId, step.incoming, step.outgoing);
      debugStepInfo.textContent = `${step.index + 1}/${total}: ${step.label}`;
    },
    onReset() {
      canvas.clearDebugVisuals();
      debugStepInfo.textContent = '';
    },
    onStateChange(state) {
      btnPlay.textContent = state === 'playing' ? '⏸' : '▶';
      btnPlay.classList.toggle('debug-active-btn', state === 'playing');
    },
  });

  // Build initial steps
  stepper.buildSteps(sourceModel);

  document.getElementById('btn-debug-step')?.addEventListener('click', () => {
    if (stepper.getTotalSteps() === 0) stepper.buildSteps(sourceModel);
    stepper.step();
  });

  document.getElementById('btn-debug-back')?.addEventListener('click', () => {
    stepper.stepBack();
  });

  document.getElementById('btn-debug-play')?.addEventListener('click', () => {
    if (stepper.getTotalSteps() === 0) stepper.buildSteps(sourceModel);
    stepper.togglePlay();
  });

  document.getElementById('btn-debug-reset')?.addEventListener('click', () => {
    stepper.reset();
  });

  debugSpeedInput?.addEventListener('change', () => {
    const val = parseInt(debugSpeedInput.value, 10);
    if (!isNaN(val) && val >= 200) {
      stepper.setSpeed(val);
    }
  });

  // Auto-fit after initial render
  setTimeout(() => canvas.fitToView(), 500);
}

main().catch((err) => {
  const el = document.getElementById('status-bar');
  if (el) el.textContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
});
