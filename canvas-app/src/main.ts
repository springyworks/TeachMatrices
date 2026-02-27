// ═══════════════════════════════════════════════════════════════════════════════
//  KosmodTS — Main Entry Point
//  TypeScript cells on a 2D maxGraph canvas with Monaco editors
// ═══════════════════════════════════════════════════════════════════════════════

import './style.css';
import '@maxgraph/core/css/common.css';
import { GraphCanvas } from './graph-canvas';

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

// ─── Example Pipeline Builder ────────────────────────────────────────────────

function loadExample(canvas: GraphCanvas): void {
  // Cell 1: Define matrix A
  const idA = canvas.addCodeCell({
    title: 'MatrixA',
    kind: 'matrix',
    code: [
      '// Define a 3×3 matrix',
      'return new Matrix([',
      '  [1, 2, 3],',
      '  [4, 5, 6],',
      '  [7, 8, 9]',
      ']);',
    ].join('\n'),
    x: 40,
    y: 40,
    width: 340,
    height: 240,
  });

  // Cell 2: Define matrix B
  const idB = canvas.addCodeCell({
    title: 'MatrixB',
    kind: 'matrix',
    code: [
      '// Scale matrix: 2× identity',
      'return Matrix.identity(3).scale(2);',
    ].join('\n'),
    x: 40,
    y: 340,
    width: 340,
    height: 200,
  });

  // Cell 3: Multiply A × B
  const idMul = canvas.addCodeCell({
    title: 'Product',
    kind: 'function',
    code: [
      '// Multiply upstream matrices A × B',
      '// "MatrixA" and "MatrixB" are injected',
      '// from the dataflow edges above',
      'if (MatrixA && MatrixB) {',
      '  return MatrixA.mul(MatrixB);',
      '}',
      'return "waiting for inputs";',
    ].join('\n'),
    x: 460,
    y: 60,
    width: 360,
    height: 260,
  });

  // Cell 4: Transpose the product
  const idT = canvas.addCodeCell({
    title: 'Transposed',
    kind: 'function',
    code: [
      '// Transpose the incoming product',
      'if (Product) {',
      '  return Product.transpose();',
      '}',
      'return "waiting for Product";',
    ].join('\n'),
    x: 900,
    y: 40,
    width: 340,
    height: 220,
  });

  // Cell 5: Compute statistics
  const idStats = canvas.addCodeCell({
    title: 'Stats',
    kind: 'function',
    code: [
      '// Compute stats on the product matrix',
      'if (Product) {',
      '  const tr = Product.trace();',
      '  const n  = Product.norm();',
      '  return `trace = ${tr}\\nnorm  = ${n.toFixed(4)}\\nsize  = ${Product.rows}×${Product.cols}`;',
      '}',
      'return "waiting for Product";',
    ].join('\n'),
    x: 900,
    y: 320,
    width: 340,
    height: 240,
  });

  // Dataflow edges
  canvas.addEdge(idA, idMul, 'dataflow', 'A');
  canvas.addEdge(idB, idMul, 'dataflow', 'B');
  canvas.addEdge(idMul, idT, 'dataflow', 'mat');
  canvas.addEdge(idMul, idStats, 'dataflow', 'mat');

  // SysML demo edges
  canvas.addEdge(idA, idB, 'inheritance', '«extends»');
  canvas.addEdge(idT, idStats, 'dependency', '«uses»');

  // Auto-run after Monaco editors initialise
  setTimeout(() => canvas.runAll(), 1000);
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

function main(): void {
  const container = document.getElementById('graph-container');
  if (!container) throw new Error('Missing #graph-container');

  const canvas = new GraphCanvas(container);

  // Load the example pipeline on startup
  loadExample(canvas);

  // ── Toolbar Bindings ──

  document.getElementById('btn-add-cell')?.addEventListener('click', () => {
    canvas.addCodeCell({});
  });

  document.getElementById('btn-add-matrix')?.addEventListener('click', () => {
    canvas.addMatrixCell({});
  });

  document.getElementById('btn-run-all')?.addEventListener('click', () => {
    canvas.runAll();
  });

  document.getElementById('btn-layout')?.addEventListener('click', () => {
    canvas.autoLayout();
  });

  document.getElementById('btn-fit')?.addEventListener('click', () => {
    canvas.fitToView();
  });

  document.getElementById('btn-example')?.addEventListener('click', () => {
    canvas.clearAll();
    loadExample(canvas);
  });

  // Run all cells after a short delay to let Monaco initialize
  setTimeout(() => canvas.runAll(), 800);
}

main();
