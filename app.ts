// ═══════════════════════════════════════════════════════════════════════════════
//  TeachMatrices — Interactive Matrix Teaching Tool
//  Scientifically styled, color-coded cells, zoom, tiny-picture mode
//  Run: node --experimental-strip-types app.ts
// ═══════════════════════════════════════════════════════════════════════════════

import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

// ─── Type Definitions ────────────────────────────────────────────────────────

type RGB = [number, number, number];

type ViewPort = {
  rowStart: number;
  colStart: number;
  rowEnd: number;
  colEnd: number;
};

// ─── ANSI Terminal Helpers ───────────────────────────────────────────────────

const ESC = "\x1b";
const RESET = `${ESC}[0m`;
const BOLD = `${ESC}[1m`;
const DIM = `${ESC}[2m`;

function fg(r: number, g: number, b: number): string {
  return `${ESC}[38;2;${r};${g};${b}m`;
}

function bg(r: number, g: number, b: number): string {
  return `${ESC}[48;2;${r};${g};${b}m`;
}

function clearScreen(): void {
  stdout.write(`${ESC}[2J${ESC}[H`);
}

// ─── Scientific Colormap (Viridis-inspired) ─────────────────────────────────
// Maps a normalized value [0,1] to an RGB color using a perceptually
// uniform gradient: dark indigo → teal → green → yellow

const COLORMAP_STOPS: RGB[] = [
  [68, 1, 84],     // 0.00  deep indigo
  [72, 35, 116],   // 0.10
  [64, 67, 135],   // 0.20
  [52, 94, 141],   // 0.30
  [33, 144, 140],  // 0.50  teal
  [39, 173, 129],  // 0.60
  [92, 200, 99],   // 0.70
  [170, 220, 50],  // 0.80
  [253, 231, 37],  // 1.00  yellow
];

function colormapLerp(t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  const n = COLORMAP_STOPS.length - 1;
  const idx = clamped * n;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, n);
  const frac = idx - lo;
  const a = COLORMAP_STOPS[lo];
  const b_ = COLORMAP_STOPS[hi];
  return [
    Math.round(a[0] + (b_[0] - a[0]) * frac),
    Math.round(a[1] + (b_[1] - a[1]) * frac),
    Math.round(a[2] + (b_[2] - a[2]) * frac),
  ];
}

function contrastFg(bgColor: RGB): RGB {
  const luminance = 0.299 * bgColor[0] + 0.587 * bgColor[1] + 0.114 * bgColor[2];
  return luminance > 140 ? [0, 0, 0] : [255, 255, 255];
}

// ─── Matrix Class ────────────────────────────────────────────────────────────

class Matrix {
  rows: number;
  cols: number;
  data: number[][];
  name: string;

  constructor(data: number[][], name?: string) {
    this.rows = data.length;
    this.cols = data.length > 0 ? data[0].length : 0;
    this.data = data.map((row) => [...row]);
    this.name = name ?? "";
  }

  // ── Factory Methods ──

  static zeros(rows: number, cols: number, name?: string): Matrix {
    return new Matrix(
      Array.from({ length: rows }, () => new Array(cols).fill(0)),
      name
    );
  }

  static ones(rows: number, cols: number, name?: string): Matrix {
    return new Matrix(
      Array.from({ length: rows }, () => new Array(cols).fill(1)),
      name
    );
  }

  static identity(n: number, name?: string): Matrix {
    const d: number[][] = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))
    );
    return new Matrix(d, name);
  }

  static random(
    rows: number, cols: number,
    min: number = 0, max: number = 9,
    integers: boolean = true,
    name?: string,
  ): Matrix {
    const d: number[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => {
        const v = min + Math.random() * (max - min);
        return integers ? Math.round(v) : Math.round(v * 100) / 100;
      })
    );
    return new Matrix(d, name);
  }

  static scalar(value: number, name?: string): Matrix {
    return new Matrix([[value]], name);
  }

  static vector(values: number[], name?: string): Matrix {
    return new Matrix(values.map((v) => [v]), name);
  }

  static rowVector(values: number[], name?: string): Matrix {
    return new Matrix([values], name);
  }

  // Generate a matrix whose values form a simple image pattern
  static tinyPicture(
    size: number,
    pattern: string,
    name?: string,
  ): Matrix {
    const d: number[][] = Array.from({ length: size }, () =>
      new Array(size).fill(0)
    );
    if (pattern === "checker") {
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          d[r][c] = (r + c) % 2 === 0 ? 255 : 0;
    } else if (pattern === "gradient-h") {
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          d[r][c] = Math.round((c / (size - 1)) * 255);
    } else if (pattern === "gradient-v") {
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          d[r][c] = Math.round((r / (size - 1)) * 255);
    } else if (pattern === "circle") {
      const cx = (size - 1) / 2;
      const cy = (size - 1) / 2;
      const rad = size / 3;
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++) {
          const dist = Math.sqrt((r - cy) ** 2 + (c - cx) ** 2);
          d[r][c] = dist <= rad ? 255 : 0;
        }
    } else if (pattern === "cross") {
      const mid = Math.floor(size / 2);
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          d[r][c] = r === mid || c === mid ? 255 : 0;
    } else if (pattern === "diagonal") {
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          d[r][c] = r === c || r === size - 1 - c ? 255 : 0;
    } else if (pattern === "wave") {
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          d[r][c] = Math.round(
            127.5 + 127.5 * Math.sin((2 * Math.PI * c) / size +
                                      (2 * Math.PI * r) / size)
          );
    } else if (pattern === "spiral") {
      const cx = (size - 1) / 2;
      const cy = (size - 1) / 2;
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++) {
          const dx = c - cx;
          const dy = r - cy;
          const angle = Math.atan2(dy, dx);
          const dist = Math.sqrt(dx * dx + dy * dy);
          d[r][c] = Math.round(
            127.5 + 127.5 * Math.sin(angle * 3 + dist * 0.5)
          );
        }
    } else {
      // random noise
      for (let r = 0; r < size; r++)
        for (let c = 0; c < size; c++)
          d[r][c] = Math.round(Math.random() * 255);
    }
    return new Matrix(d, name);
  }

  // ── Accessors ──

  get(row: number, col: number): number {
    return this.data[row][col];
  }

  set(row: number, col: number, value: number): void {
    this.data[row][col] = value;
  }

  getRow(r: number): number[] {
    return [...this.data[r]];
  }

  getCol(c: number): number[] {
    return this.data.map((row) => row[c]);
  }

  // ── Properties ──

  isSquare(): boolean {
    return this.rows === this.cols;
  }

  isVector(): boolean {
    return this.cols === 1 || this.rows === 1;
  }

  isScalar(): boolean {
    return this.rows === 1 && this.cols === 1;
  }

  // Frobenius norm
  norm(): number {
    let sum = 0;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        sum += this.data[r][c] ** 2;
    return Math.sqrt(sum);
  }

  trace(): number {
    if (!this.isSquare()) throw new Error("Trace requires square matrix");
    let t = 0;
    for (let i = 0; i < this.rows; i++) t += this.data[i][i];
    return t;
  }

  min(): number {
    let m = Infinity;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.data[r][c] < m) m = this.data[r][c];
    return m;
  }

  max(): number {
    let m = -Infinity;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (this.data[r][c] > m) m = this.data[r][c];
    return m;
  }

  // ── Operations ──

  add(b: Matrix): Matrix {
    if (this.rows !== b.rows || this.cols !== b.cols)
      throw new Error(
        `Dimension mismatch: (${this.rows}×${this.cols}) + (${b.rows}×${b.cols})`
      );
    const d: number[][] = Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) =>
        this.data[r][c] + b.data[r][c]
      )
    );
    return new Matrix(d);
  }

  subtract(b: Matrix): Matrix {
    if (this.rows !== b.rows || this.cols !== b.cols)
      throw new Error(
        `Dimension mismatch: (${this.rows}×${this.cols}) - (${b.rows}×${b.cols})`
      );
    const d: number[][] = Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) =>
        this.data[r][c] - b.data[r][c]
      )
    );
    return new Matrix(d);
  }

  scalarMultiply(s: number): Matrix {
    const d: number[][] = Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) =>
        Math.round(this.data[r][c] * s * 1000) / 1000
      )
    );
    return new Matrix(d);
  }

  multiply(b: Matrix): Matrix {
    if (this.cols !== b.rows)
      throw new Error(
        `Cannot multiply (${this.rows}×${this.cols}) × (${b.rows}×${b.cols}): inner dimensions mismatch`
      );
    const d: number[][] = Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: b.cols }, (_, c) => {
        let sum = 0;
        for (let k = 0; k < this.cols; k++)
          sum += this.data[r][k] * b.data[k][c];
        return Math.round(sum * 1000) / 1000;
      })
    );
    return new Matrix(d);
  }

  // Hadamard (element-wise) product
  hadamard(b: Matrix): Matrix {
    if (this.rows !== b.rows || this.cols !== b.cols)
      throw new Error("Dimension mismatch for Hadamard product");
    const d: number[][] = Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) =>
        this.data[r][c] * b.data[r][c]
      )
    );
    return new Matrix(d);
  }

  transpose(): Matrix {
    const d: number[][] = Array.from({ length: this.cols }, (_, r) =>
      Array.from({ length: this.rows }, (_, c) => this.data[c][r])
    );
    return new Matrix(d);
  }

  // Element-wise map
  map(fn: (value: number, row: number, col: number) => number): Matrix {
    const d: number[][] = Array.from({ length: this.rows }, (_, r) =>
      Array.from({ length: this.cols }, (_, c) => fn(this.data[r][c], r, c))
    );
    return new Matrix(d);
  }

  // Determinant — recursive (for up to ~10×10; sufficient for teaching)
  determinant(): number {
    if (!this.isSquare()) throw new Error("Determinant requires square matrix");
    const n = this.rows;
    if (n === 1) return this.data[0][0];
    if (n === 2)
      return this.data[0][0] * this.data[1][1] - this.data[0][1] * this.data[1][0];

    let det = 0;
    for (let c = 0; c < n; c++) {
      const minor = this.cofactorMatrix(0, c);
      det += (c % 2 === 0 ? 1 : -1) * this.data[0][c] * minor.determinant();
    }
    return Math.round(det * 1000) / 1000;
  }

  private cofactorMatrix(skipRow: number, skipCol: number): Matrix {
    const d: number[][] = [];
    for (let r = 0; r < this.rows; r++) {
      if (r === skipRow) continue;
      const row: number[] = [];
      for (let c = 0; c < this.cols; c++) {
        if (c === skipCol) continue;
        row.push(this.data[r][c]);
      }
      d.push(row);
    }
    return new Matrix(d);
  }

  // Inverse using Gauss-Jordan elimination
  inverse(): Matrix {
    if (!this.isSquare()) throw new Error("Inverse requires square matrix");
    const n = this.rows;
    // Augment with identity
    const aug: number[][] = this.data.map((row, i) => [
      ...row,
      ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
    ]);

    for (let i = 0; i < n; i++) {
      // Partial pivoting
      let maxRow = i;
      for (let r = i + 1; r < n; r++)
        if (Math.abs(aug[r][i]) > Math.abs(aug[maxRow][i])) maxRow = r;
      [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];

      const pivot = aug[i][i];
      if (Math.abs(pivot) < 1e-12)
        throw new Error("Matrix is singular (non-invertible)");

      // Scale pivot row
      for (let c = 0; c < 2 * n; c++) aug[i][c] /= pivot;

      // Eliminate column
      for (let r = 0; r < n; r++) {
        if (r === i) continue;
        const factor = aug[r][i];
        for (let c = 0; c < 2 * n; c++) aug[r][c] -= factor * aug[i][c];
      }
    }

    const result: number[][] = aug.map((row) =>
      row.slice(n).map((v) => Math.round(v * 10000) / 10000)
    );
    return new Matrix(result);
  }

  // Row echelon form
  rref(): Matrix {
    const d: number[][] = this.data.map((r) => [...r]);
    const m = this.rows;
    const n = this.cols;
    let lead = 0;

    for (let r = 0; r < m && lead < n; r++) {
      let i = r;
      while (Math.abs(d[i][lead]) < 1e-12) {
        i++;
        if (i === m) {
          i = r;
          lead++;
          if (lead === n) return new Matrix(d);
        }
      }
      [d[i], d[r]] = [d[r], d[i]];
      const div = d[r][lead];
      for (let c = 0; c < n; c++) d[r][c] /= div;
      for (let j = 0; j < m; j++) {
        if (j === r) continue;
        const factor = d[j][lead];
        for (let c = 0; c < n; c++) d[j][c] -= factor * d[r][c];
      }
      lead++;
    }
    return new Matrix(
      d.map((row) => row.map((v) => Math.round(v * 10000) / 10000))
    );
  }

  rank(): number {
    const reduced = this.rref();
    let r = 0;
    for (let i = 0; i < reduced.rows; i++) {
      if (reduced.data[i].some((v) => Math.abs(v) > 1e-10)) r++;
    }
    return r;
  }

  // Power (matrix exponentiation)
  power(exp: number): Matrix {
    if (!this.isSquare()) throw new Error("Power requires square matrix");
    if (exp === 0) return Matrix.identity(this.rows);
    let result = this.clone();
    for (let i = 1; i < exp; i++) result = result.multiply(this);
    return result;
  }

  clone(): Matrix {
    return new Matrix(this.data.map((r) => [...r]), this.name);
  }

  equals(other: Matrix, epsilon: number = 1e-10): boolean {
    if (this.rows !== other.rows || this.cols !== other.cols) return false;
    for (let r = 0; r < this.rows; r++)
      for (let c = 0; c < this.cols; c++)
        if (Math.abs(this.data[r][c] - other.data[r][c]) > epsilon)
          return false;
    return true;
  }

  submatrix(vp: ViewPort): Matrix {
    const d: number[][] = [];
    for (let r = vp.rowStart; r <= vp.rowEnd && r < this.rows; r++) {
      const row: number[] = [];
      for (let c = vp.colStart; c <= vp.colEnd && c < this.cols; c++)
        row.push(this.data[r][c]);
      d.push(row);
    }
    return new Matrix(d);
  }
}

// ─── Display Engine ──────────────────────────────────────────────────────────

// Format a number for display inside a cell
function fmtNum(v: number, width: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 10000) {
    return String(v).padStart(width);
  }
  if (Math.abs(v) >= 1e6 || (Math.abs(v) < 0.01 && v !== 0)) {
    return v.toExponential(1).padStart(width);
  }
  const s = v.toFixed(2);
  return s.length > width ? v.toFixed(1).padStart(width) : s.padStart(width);
}

// Determine cell width based on matrix values
function cellWidth(m: Matrix): number {
  let maxLen = 1;
  for (let r = 0; r < m.rows; r++)
    for (let c = 0; c < m.cols; c++) {
      const len = fmtNum(m.data[r][c], 1).trim().length;
      if (len > maxLen) maxLen = len;
    }
  return Math.min(maxLen + 2, 10); // pad + cap
}

// Render a single colored cell
function renderCell(
  value: number, minVal: number, maxVal: number, width: number,
): string {
  const range = maxVal - minVal || 1;
  const t = (value - minVal) / range;
  const bgColor = colormapLerp(t);
  const fgColor = contrastFg(bgColor);
  const text = fmtNum(value, width);
  return `${bg(bgColor[0], bgColor[1], bgColor[2])}${fg(fgColor[0], fgColor[1], fgColor[2])}${text}${RESET}`;
}

// Render matrix with bracket notation and colored cells
function renderMatrix(
  m: Matrix,
  viewport?: ViewPort,
  zoom: number = 1,
  label?: string,
): string {
  const vp = viewport ?? {
    rowStart: 0, colStart: 0,
    rowEnd: m.rows - 1, colEnd: m.cols - 1,
  };

  // Apply zoom: sample every `zoom` cells
  const sampledRows: number[] = [];
  const sampledCols: number[] = [];
  for (let r = vp.rowStart; r <= Math.min(vp.rowEnd, m.rows - 1); r += zoom)
    sampledRows.push(r);
  for (let c = vp.colStart; c <= Math.min(vp.colEnd, m.cols - 1); c += zoom)
    sampledCols.push(c);

  // Build a sub-matrix for display
  const sub = new Matrix(
    sampledRows.map((r) => sampledCols.map((c) => m.data[r][c]))
  );

  const minVal = sub.min();
  const maxVal = sub.max();
  const w = cellWidth(sub);
  const lines: string[] = [];

  // Header
  const headerLabel = label ?? m.name ?? "";
  if (headerLabel) {
    lines.push(
      `${BOLD}${fg(200, 200, 255)} ${headerLabel}${RESET}  ${DIM}(${m.rows}×${m.cols})${RESET}`
    );
  } else {
    lines.push(`${DIM}(${m.rows}×${m.cols})${RESET}`);
  }

  // Column indices
  if (sub.cols <= 40) {
    let colHeader = "     ";
    for (const c of sampledCols)
      colHeader += `${DIM}${String(c).padStart(w)}${RESET}`;
    lines.push(colHeader);
  }

  // Row rendering with brackets
  for (let ri = 0; ri < sub.rows; ri++) {
    const rowIdx = sampledRows[ri];
    const rowLabel = `${DIM}${String(rowIdx).padStart(3)}${RESET} `;
    const leftBracket = ri === 0 ? "⎡" : ri === sub.rows - 1 ? "⎣" : "⎢";
    const rightBracket = ri === 0 ? "⎤" : ri === sub.rows - 1 ? "⎦" : "⎥";

    let row = `${rowLabel}${leftBracket}`;
    for (let ci = 0; ci < sub.cols; ci++) {
      row += renderCell(sub.data[ri][ci], minVal, maxVal, w);
    }
    row += `${rightBracket}`;
    lines.push(row);
  }

  // Viewport info when zoomed or windowed
  if (zoom > 1) {
    lines.push(
      `${DIM}  zoom: 1:${zoom}  showing ${sub.rows}×${sub.cols} of ${m.rows}×${m.cols}${RESET}`
    );
  }

  return lines.join("\n");
}

// Render matrix as a "tiny picture" — each cell is a half-block character
function renderTinyPicture(m: Matrix, label?: string): string {
  const minVal = m.min();
  const maxVal = m.max();
  const range = maxVal - minVal || 1;
  const lines: string[] = [];
  if (label) lines.push(`${BOLD}${fg(200, 200, 255)} ${label}${RESET}`);

  // Use upper-half block ▀ to pack 2 rows per terminal line
  for (let r = 0; r < m.rows; r += 2) {
    let line = " ";
    for (let c = 0; c < m.cols; c++) {
      const t1 = (m.data[r][c] - minVal) / range;
      const top = colormapLerp(t1);

      if (r + 1 < m.rows) {
        const t2 = (m.data[r + 1][c] - minVal) / range;
        const bot = colormapLerp(t2);
        line += `${fg(top[0], top[1], top[2])}${bg(bot[0], bot[1], bot[2])}▀${RESET}`;
      } else {
        line += `${fg(top[0], top[1], top[2])}▀${RESET}`;
      }
    }
    lines.push(line);
  }
  lines.push(`${DIM} (${m.rows}×${m.cols})${RESET}`);
  return lines.join("\n");
}

// Render constellation — multiple matrices side by side
function renderConstellation(
  matrices: Matrix[],
  operators: string[],
  resultName?: string,
): string {
  // Render each matrix to an array of lines, then zip side by side
  const rendered = matrices.map((m) => renderMatrix(m).split("\n"));
  const maxHeight = Math.max(...rendered.map((r) => r.length));

  // Pad each rendered block to same height
  for (const block of rendered) {
    while (block.length < maxHeight) block.push("");
  }

  // Get max width of each block (using visible width)
  const blockWidths = rendered.map((block) =>
    Math.max(...block.map((line) => stripAnsi(line).length))
  );

  const lines: string[] = [];
  const opRow = Math.floor(maxHeight / 2);

  for (let row = 0; row < maxHeight; row++) {
    let line = "";
    for (let b = 0; b < rendered.length; b++) {
      const text = rendered[b][row] ?? "";
      const pad = blockWidths[b] - stripAnsi(text).length;
      line += text + " ".repeat(Math.max(0, pad));

      if (b < operators.length) {
        if (row === opRow) {
          line += `  ${BOLD}${fg(255, 200, 50)} ${operators[b]} ${RESET}  `;
        } else {
          line += "       ";
        }
      }
    }
    lines.push(line);
  }

  if (resultName) {
    lines.push(`${DIM}  → result stored as "${resultName}"${RESET}`);
  }

  return lines.join("\n");
}

// Strip ANSI codes for width calculations
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// Colorbar legend
function renderColorbar(minVal: number, maxVal: number, width: number = 40): string {
  let bar = `${DIM}  ${fmtNum(minVal, 6).trim()} ${RESET}`;
  for (let i = 0; i < width; i++) {
    const t = i / (width - 1);
    const c = colormapLerp(t);
    bar += `${bg(c[0], c[1], c[2])} ${RESET}`;
  }
  bar += `${DIM} ${fmtNum(maxVal, 6).trim()}${RESET}`;
  return bar;
}

// ─── Interactive Application ─────────────────────────────────────────────────

class TeachMatrices {
  rl: ReturnType<typeof createInterface>;
  workspace: Map<string, Matrix>;
  running: boolean;

  constructor() {
    this.rl = createInterface({ input: stdin, output: stdout });
    this.workspace = new Map();
    this.running = true;
  }

  async ask(prompt: string): Promise<string> {
    const answer = await this.rl.question(prompt);
    return answer.trim();
  }

  async askNumber(prompt: string, defaultVal?: number): Promise<number> {
    const s = await this.ask(prompt);
    if (s === "" && defaultVal !== undefined) return defaultVal;
    const n = Number(s);
    if (isNaN(n)) {
      console.log(`  ${fg(255, 80, 80)}Invalid number, try again${RESET}`);
      return this.askNumber(prompt, defaultVal);
    }
    return n;
  }

  async askName(prompt: string): Promise<string> {
    const name = await this.ask(prompt);
    if (!name || name.length === 0) {
      console.log(`  ${fg(255, 80, 80)}Name required${RESET}`);
      return this.askName(prompt);
    }
    return name;
  }

  printTitle(): void {
    console.log(`
${BOLD}${fg(100, 200, 255)}╔══════════════════════════════════════════════════════════╗
║               T E A C H   M A T R I C E S              ║
║         Interactive Matrix Laboratory  v1.0             ║
╚══════════════════════════════════════════════════════════╝${RESET}
${DIM}  Scalars · Vectors · Matrices · up to 256×256${RESET}
${DIM}  Color-coded cells · Scientific notation · Zoom${RESET}
`);
  }

  printMenu(): void {
    const count = this.workspace.size;
    console.log(`
${BOLD}${fg(180, 200, 255)}  ── Main Menu ──${RESET}   ${DIM}[${count} matrices in workspace]${RESET}

  ${fg(100, 255, 180)}[1]${RESET} Create matrix       ${fg(100, 255, 180)}[6]${RESET} Zoom / Viewport
  ${fg(100, 255, 180)}[2]${RESET} View matrix         ${fg(100, 255, 180)}[7]${RESET} Tiny picture mode
  ${fg(100, 255, 180)}[3]${RESET} Operations          ${fg(100, 255, 180)}[8]${RESET} Constellation view
  ${fg(100, 255, 180)}[4]${RESET} Properties          ${fg(100, 255, 180)}[9]${RESET} Gallery
  ${fg(100, 255, 180)}[5]${RESET} List workspace      ${fg(100, 255, 180)}[0]${RESET} Learn / Tutorial
  ${fg(255, 100, 100)}[q]${RESET} Quit
`);
  }

  listMatrices(): void {
    if (this.workspace.size === 0) {
      console.log(`  ${DIM}(workspace empty — create some matrices first)${RESET}`);
      return;
    }
    console.log(`\n${BOLD}  Workspace:${RESET}`);
    for (const [name, m] of this.workspace) {
      const kind = m.isScalar()
        ? "scalar"
        : m.isVector()
        ? "vector"
        : "matrix";
      console.log(
        `    ${fg(100, 255, 180)}${name}${RESET}  ${DIM}${m.rows}×${m.cols} ${kind}${RESET}`
      );
    }
    console.log();
  }

  async pickMatrix(prompt: string): Promise<Matrix | null> {
    this.listMatrices();
    if (this.workspace.size === 0) return null;
    const name = await this.ask(prompt);
    const m = this.workspace.get(name);
    if (!m) {
      console.log(`  ${fg(255, 80, 80)}Matrix "${name}" not found${RESET}`);
      return null;
    }
    return m;
  }

  // ── Create Menu ──

  async createMenu(): Promise<void> {
    console.log(`
${BOLD}${fg(180, 200, 255)}  ── Create Matrix ──${RESET}

  ${fg(100, 255, 180)}[1]${RESET} Zeros            ${fg(100, 255, 180)}[5]${RESET} Custom (enter values)
  ${fg(100, 255, 180)}[2]${RESET} Ones             ${fg(100, 255, 180)}[6]${RESET} Random
  ${fg(100, 255, 180)}[3]${RESET} Identity         ${fg(100, 255, 180)}[7]${RESET} Scalar (1×1)
  ${fg(100, 255, 180)}[4]${RESET} Vector           ${fg(100, 255, 180)}[8]${RESET} Large random (up to 256×256)
  ${fg(100, 255, 180)}[b]${RESET} Back
`);
    const choice = await this.ask("  choice> ");

    if (choice === "b") return;

    const name = await this.askName("  name> ");

    if (choice === "1") {
      const rows = await this.askNumber("  rows> ");
      const cols = await this.askNumber("  cols> ");
      this.workspace.set(name, Matrix.zeros(rows, cols, name));
    } else if (choice === "2") {
      const rows = await this.askNumber("  rows> ");
      const cols = await this.askNumber("  cols> ");
      this.workspace.set(name, Matrix.ones(rows, cols, name));
    } else if (choice === "3") {
      const n = await this.askNumber("  size (n×n)> ");
      this.workspace.set(name, Matrix.identity(n, name));
    } else if (choice === "4") {
      const input = await this.ask("  values (space-separated)> ");
      const vals = input.split(/[\s,]+/).map(Number).filter((v) => !isNaN(v));
      if (vals.length === 0) {
        console.log(`  ${fg(255, 80, 80)}No valid numbers entered${RESET}`);
        return;
      }
      const dir = await this.ask("  column vector (c) or row vector (r)? [c]> ");
      if (dir === "r") {
        this.workspace.set(name, Matrix.rowVector(vals, name));
      } else {
        this.workspace.set(name, Matrix.vector(vals, name));
      }
    } else if (choice === "5") {
      const rows = await this.askNumber("  rows> ");
      const cols = await this.askNumber("  cols> ");
      console.log(`  Enter ${rows} rows with ${cols} values each (space-separated):`);
      const data: number[][] = [];
      for (let r = 0; r < rows; r++) {
        const line = await this.ask(`  row ${r}> `);
        const vals = line.split(/[\s,]+/).map(Number);
        if (vals.length !== cols || vals.some(isNaN)) {
          console.log(`  ${fg(255, 80, 80)}Expected ${cols} numbers. Row skipped (filled with 0).${RESET}`);
          data.push(new Array(cols).fill(0));
        } else {
          data.push(vals);
        }
      }
      this.workspace.set(name, new Matrix(data, name));
    } else if (choice === "6") {
      const rows = await this.askNumber("  rows> ");
      const cols = await this.askNumber("  cols> ");
      const minV = await this.askNumber("  min value [0]> ", 0);
      const maxV = await this.askNumber("  max value [9]> ", 9);
      const ints = (await this.ask("  integers? (y/n) [y]> ")) !== "n";
      this.workspace.set(
        name,
        Matrix.random(rows, cols, minV, maxV, ints, name)
      );
    } else if (choice === "7") {
      const val = await this.askNumber("  value> ");
      this.workspace.set(name, Matrix.scalar(val, name));
    } else if (choice === "8") {
      const rows = await this.askNumber("  rows (up to 256)> ");
      const cols = await this.askNumber("  cols (up to 256)> ");
      const r = Math.min(256, Math.max(1, rows));
      const c = Math.min(256, Math.max(1, cols));
      const minV = await this.askNumber("  min value [0]> ", 0);
      const maxV = await this.askNumber("  max value [255]> ", 255);
      this.workspace.set(
        name,
        Matrix.random(r, c, minV, maxV, true, name)
      );
      console.log(`  ${fg(100, 255, 180)}Created ${r}×${c} matrix "${name}"${RESET}`);
    } else {
      console.log(`  ${fg(255, 80, 80)}Invalid choice${RESET}`);
      return;
    }

    const m = this.workspace.get(name);
    if (m) {
      if (m.rows <= 20 && m.cols <= 20) {
        console.log("\n" + renderMatrix(m, undefined, 1, name));
      } else {
        console.log(
          `\n  ${fg(100, 255, 180)}Created "${name}" (${m.rows}×${m.cols}). Use View or Zoom to see it.${RESET}`
        );
      }
    }
  }

  // ── View ──

  async viewMenu(): Promise<void> {
    const m = await this.pickMatrix("  view which matrix> ");
    if (!m) return;
    console.log();
    if (m.rows <= 30 && m.cols <= 30) {
      console.log(renderMatrix(m, undefined, 1, m.name));
    } else {
      // Auto zoom
      const zoom = Math.max(1, Math.ceil(Math.max(m.rows, m.cols) / 30));
      console.log(renderMatrix(m, undefined, zoom, m.name));
    }
    console.log(renderColorbar(m.min(), m.max()));
    console.log();
  }

  // ── Operations ──

  async operationsMenu(): Promise<void> {
    console.log(`
${BOLD}${fg(180, 200, 255)}  ── Operations ──${RESET}

  ${fg(100, 255, 180)}[1]${RESET} A + B  (add)               ${fg(100, 255, 180)}[7]${RESET}  Aᵀ (transpose)
  ${fg(100, 255, 180)}[2]${RESET} A − B  (subtract)          ${fg(100, 255, 180)}[8]${RESET}  det(A) (determinant)
  ${fg(100, 255, 180)}[3]${RESET} A × B  (multiply)          ${fg(100, 255, 180)}[9]${RESET}  A⁻¹ (inverse)
  ${fg(100, 255, 180)}[4]${RESET} k × A  (scalar multiply)   ${fg(100, 255, 180)}[10]${RESET} RREF (row echelon)
  ${fg(100, 255, 180)}[5]${RESET} A ∘ B  (Hadamard)          ${fg(100, 255, 180)}[11]${RESET} Aⁿ (power)
  ${fg(100, 255, 180)}[6]${RESET} A map f (element-wise fn)  ${fg(100, 255, 180)}[b]${RESET}  Back
`);
    const choice = await this.ask("  choice> ");
    if (choice === "b") return;

    try {
      if (choice === "1" || choice === "2" || choice === "3" || choice === "5") {
        const a = await this.pickMatrix("  matrix A> ");
        if (!a) return;
        const b = await this.pickMatrix("  matrix B> ");
        if (!b) return;

        let result: Matrix;
        let op: string;
        if (choice === "1") {
          result = a.add(b);
          op = "+";
        } else if (choice === "2") {
          result = a.subtract(b);
          op = "−";
        } else if (choice === "3") {
          result = a.multiply(b);
          op = "×";
        } else {
          result = a.hadamard(b);
          op = "∘";
        }

        const resName = await this.askName("  store result as> ");
        result.name = resName;
        this.workspace.set(resName, result);

        if (a.rows <= 10 && a.cols <= 10) {
          console.log(
            "\n" + renderConstellation([a, b, result], [op, "="], resName)
          );
        } else {
          console.log("\n" + renderMatrix(result, undefined, 1, resName));
        }
      } else if (choice === "4") {
        const a = await this.pickMatrix("  matrix A> ");
        if (!a) return;
        const k = await this.askNumber("  scalar k> ");
        const result = a.scalarMultiply(k);
        const resName = await this.askName("  store result as> ");
        result.name = resName;
        this.workspace.set(resName, result);
        console.log(
          "\n" + renderConstellation(
            [Matrix.scalar(k), a, result],
            ["×", "="],
            resName,
          )
        );
      } else if (choice === "6") {
        const a = await this.pickMatrix("  matrix A> ");
        if (!a) return;
        console.log(`  Available functions: abs, sqrt, square, negate, sin, cos, floor, ceil, round`);
        const fname = await this.ask("  function> ");
        const fns: Record<string, (v: number) => number> = {
          abs: Math.abs,
          sqrt: (v: number) => Math.sqrt(Math.abs(v)),
          square: (v: number) => v * v,
          negate: (v: number) => -v,
          sin: Math.sin,
          cos: Math.cos,
          floor: Math.floor,
          ceil: Math.ceil,
          round: Math.round,
        };
        const fn = fns[fname];
        if (!fn) {
          console.log(`  ${fg(255, 80, 80)}Unknown function "${fname}"${RESET}`);
          return;
        }
        const result = a.map((v) => Math.round(fn(v) * 1000) / 1000);
        const resName = await this.askName("  store result as> ");
        result.name = resName;
        this.workspace.set(resName, result);
        console.log("\n" + renderMatrix(result, undefined, 1, resName));
      } else if (choice === "7") {
        const a = await this.pickMatrix("  matrix A> ");
        if (!a) return;
        const result = a.transpose();
        const resName = await this.askName("  store result as> ");
        result.name = resName;
        this.workspace.set(resName, result);
        console.log(
          "\n" + renderConstellation([a, result], ["ᵀ→"], resName)
        );
      } else if (choice === "8") {
        const a = await this.pickMatrix("  matrix A> ");
        if (!a) return;
        const det = a.determinant();
        console.log(
          `\n  ${BOLD}det(${a.name}) = ${fg(255, 220, 50)}${det}${RESET}\n`
        );
      } else if (choice === "9") {
        const a = await this.pickMatrix("  matrix A> ");
        if (!a) return;
        const result = a.inverse();
        const resName = await this.askName("  store result as> ");
        result.name = resName;
        this.workspace.set(resName, result);

        // Verify: A × A⁻¹ = I
        const check = a.multiply(result);
        console.log(
          "\n" +
            renderConstellation([a, result, check], ["⁻¹→", "verify: A×A⁻¹="], resName)
        );
      } else if (choice === "10") {
        const a = await this.pickMatrix("  matrix A> ");
        if (!a) return;
        const result = a.rref();
        const resName = await this.askName("  store result as> ");
        result.name = resName;
        this.workspace.set(resName, result);
        console.log(
          "\n" + renderConstellation([a, result], ["RREF→"], resName)
        );
      } else if (choice === "11") {
        const a = await this.pickMatrix("  matrix A> ");
        if (!a) return;
        const n = await this.askNumber("  exponent> ");
        const result = a.power(n);
        const resName = await this.askName("  store result as> ");
        result.name = resName;
        this.workspace.set(resName, result);
        console.log("\n" + renderMatrix(result, undefined, 1, resName));
      } else {
        console.log(`  ${fg(255, 80, 80)}Invalid choice${RESET}`);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  ${fg(255, 80, 80)}Error: ${msg}${RESET}`);
    }
  }

  // ── Properties ──

  async propertiesMenu(): Promise<void> {
    const m = await this.pickMatrix("  matrix> ");
    if (!m) return;
    console.log();
    console.log(`${BOLD}  Properties of "${m.name}":${RESET}`);
    console.log(`    Size:       ${m.rows}×${m.cols}`);
    console.log(`    Type:       ${m.isScalar() ? "scalar" : m.isVector() ? "vector" : "matrix"}`);
    console.log(`    Square:     ${m.isSquare() ? "yes" : "no"}`);
    console.log(`    Min value:  ${m.min()}`);
    console.log(`    Max value:  ${m.max()}`);
    console.log(`    Norm (F):   ${Math.round(m.norm() * 1000) / 1000}`);
    console.log(`    Rank:       ${m.rank()}`);
    if (m.isSquare()) {
      console.log(`    Trace:      ${m.trace()}`);
      if (m.rows <= 10) {
        try {
          console.log(`    Determinant: ${m.determinant()}`);
        } catch {
          console.log(`    Determinant: (computation error)`);
        }
      } else {
        console.log(`    Determinant: (matrix too large for recursive computation)`);
      }
    }
    console.log();
  }

  // ── Zoom / Viewport ──

  async zoomMenu(): Promise<void> {
    const m = await this.pickMatrix("  matrix> ");
    if (!m) return;

    let rowStart = 0;
    let colStart = 0;
    let zoom = Math.max(1, Math.ceil(Math.max(m.rows, m.cols) / 30));
    let viewRows = Math.min(30, m.rows);
    let viewCols = Math.min(30, m.cols);

    const redraw = (): void => {
      const vp: ViewPort = {
        rowStart,
        colStart,
        rowEnd: Math.min(rowStart + viewRows * zoom - 1, m.rows - 1),
        colEnd: Math.min(colStart + viewCols * zoom - 1, m.cols - 1),
      };
      console.log("\n" + renderMatrix(m, vp, zoom, m.name));
      console.log(renderColorbar(m.min(), m.max()));
      console.log(
        `${DIM}  viewport: rows ${rowStart}..${vp.rowEnd}  cols ${colStart}..${vp.colEnd}  zoom 1:${zoom}${RESET}`
      );
      console.log(
        `${DIM}  [w/s] scroll ↑↓  [a/d] scroll ←→  [+/-] zoom  [q] back${RESET}\n`
      );
    };

    redraw();

    while (true) {
      const cmd = await this.ask("  navigate> ");
      if (cmd === "q" || cmd === "b") break;
      const step = zoom * 5;
      if (cmd === "w") rowStart = Math.max(0, rowStart - step);
      else if (cmd === "s")
        rowStart = Math.min(m.rows - 1, rowStart + step);
      else if (cmd === "a") colStart = Math.max(0, colStart - step);
      else if (cmd === "d")
        colStart = Math.min(m.cols - 1, colStart + step);
      else if (cmd === "+" || cmd === "=")
        zoom = Math.max(1, zoom - 1);
      else if (cmd === "-")
        zoom = Math.min(Math.max(m.rows, m.cols), zoom + 1);
      else continue;
      redraw();
    }
  }

  // ── Tiny Picture Mode ──

  async tinyPictureMenu(): Promise<void> {
    console.log(`
${BOLD}${fg(180, 200, 255)}  ── Tiny Picture Mode ──${RESET}

  ${fg(100, 255, 180)}[1]${RESET} View existing matrix as picture
  ${fg(100, 255, 180)}[2]${RESET} Generate pattern picture
  ${fg(100, 255, 180)}[b]${RESET} Back
`);
    const choice = await this.ask("  choice> ");
    if (choice === "b") return;

    if (choice === "1") {
      const m = await this.pickMatrix("  matrix> ");
      if (!m) return;
      console.log("\n" + renderTinyPicture(m, m.name));
    } else if (choice === "2") {
      console.log(
        `  Patterns: checker, gradient-h, gradient-v, circle, cross, diagonal, wave, spiral, noise`
      );
      const pattern = await this.ask("  pattern> ");
      const size = await this.askNumber("  size (8-256) [32]> ", 32);
      const s = Math.min(256, Math.max(4, size));
      const name = await this.askName("  name> ");
      const m = Matrix.tinyPicture(s, pattern, name);
      this.workspace.set(name, m);
      console.log("\n" + renderTinyPicture(m, name));
    }
    console.log();
  }

  // ── Constellation View ──

  async constellationMenu(): Promise<void> {
    console.log(
      `\n${BOLD}${fg(180, 200, 255)}  ── Constellation View ──${RESET}`
    );
    console.log(`  ${DIM}Display multiple matrices side by side${RESET}\n`);

    this.listMatrices();
    if (this.workspace.size === 0) return;

    const input = await this.ask("  matrix names (space-separated)> ");
    const names = input.split(/\s+/).filter((n) => n.length > 0);
    const matrices: Matrix[] = [];
    for (const n of names) {
      const m = this.workspace.get(n);
      if (!m) {
        console.log(`  ${fg(255, 80, 80)}Skipping "${n}" — not found${RESET}`);
      } else {
        matrices.push(m);
      }
    }

    if (matrices.length === 0) return;

    // Render side by side with spacers
    const operators = new Array(matrices.length - 1).fill("·");
    console.log("\n" + renderConstellation(matrices, operators));
    console.log();
  }

  // ── Gallery ──

  async galleryMenu(): Promise<void> {
    console.log(`
${BOLD}${fg(180, 200, 255)}  ── Gallery ──${RESET}
${DIM}  Pre-built interesting matrices${RESET}

  ${fg(100, 255, 180)}[1]${RESET} Rotation matrix (2D)
  ${fg(100, 255, 180)}[2]${RESET} Fibonacci matrix
  ${fg(100, 255, 180)}[3]${RESET} Hilbert matrix
  ${fg(100, 255, 180)}[4]${RESET} Magic square (3×3)
  ${fg(100, 255, 180)}[5]${RESET} Hadamard matrix (4×4)
  ${fg(100, 255, 180)}[6]${RESET} Pascal matrix
  ${fg(100, 255, 180)}[7]${RESET} DFT matrix (4×4 magnitudes)
  ${fg(100, 255, 180)}[8]${RESET} All gallery items as tiny pictures
  ${fg(100, 255, 180)}[b]${RESET} Back
`);
    const choice = await this.ask("  choice> ");
    if (choice === "b") return;

    const gallery: Record<string, Matrix> = {};

    // Rotation matrix
    const angle = choice === "1" ? await this.askNumber("  angle (degrees)> ", 45) : 45;
    const rad = (angle * Math.PI) / 180;
    gallery["Rot2D"] = new Matrix(
      [
        [Math.round(Math.cos(rad) * 10000) / 10000, Math.round(-Math.sin(rad) * 10000) / 10000],
        [Math.round(Math.sin(rad) * 10000) / 10000, Math.round(Math.cos(rad) * 10000) / 10000],
      ],
      "Rot2D"
    );

    // Fibonacci
    gallery["Fibonacci"] = new Matrix([[1, 1], [1, 0]], "Fibonacci");

    // Hilbert
    const hilN = 5;
    gallery["Hilbert"] = new Matrix(
      Array.from({ length: hilN }, (_, i) =>
        Array.from({ length: hilN }, (_, j) =>
          Math.round((1 / (i + j + 1)) * 10000) / 10000
        )
      ),
      "Hilbert"
    );

    // Magic square
    gallery["Magic3"] = new Matrix(
      [[2, 7, 6], [9, 5, 1], [4, 3, 8]],
      "Magic3"
    );

    // Hadamard
    gallery["Hadamard4"] = new Matrix(
      [
        [1, 1, 1, 1],
        [1, -1, 1, -1],
        [1, 1, -1, -1],
        [1, -1, -1, 1],
      ],
      "Hadamard4"
    );

    // Pascal
    const pasN = 5;
    const pasData: number[][] = Array.from({ length: pasN }, () =>
      new Array(pasN).fill(0)
    );
    for (let i = 0; i < pasN; i++) {
      pasData[i][0] = 1;
      pasData[0][i] = 1;
    }
    for (let i = 1; i < pasN; i++)
      for (let j = 1; j < pasN; j++)
        pasData[i][j] = pasData[i - 1][j] + pasData[i][j - 1];
    gallery["Pascal"] = new Matrix(pasData, "Pascal");

    // DFT magnitudes (4×4)
    const dftN = 4;
    const dftData: number[][] = Array.from({ length: dftN }, (_, k) =>
      Array.from({ length: dftN }, (_, n) => {
        const angle = (2 * Math.PI * k * n) / dftN;
        // magnitude of e^(-j*angle) = 1, but let's show cos component
        return Math.round(Math.cos(angle) * 1000) / 1000;
      })
    );
    gallery["DFT4"] = new Matrix(dftData, "DFT4");

    if (choice === "8") {
      // Show all as tiny pictures
      for (const [name, m] of Object.entries(gallery)) {
        this.workspace.set(name, m);
        console.log("\n" + renderMatrix(m, undefined, 1, name));
      }
    } else if (choice >= "1" && choice <= "7") {
      const items = Object.entries(gallery);
      const idx = Number(choice) - 1;
      if (idx < items.length) {
        const [name, m] = items[idx];
        this.workspace.set(name, m);
        console.log("\n" + renderMatrix(m, undefined, 1, name));
        console.log(renderColorbar(m.min(), m.max()));
      }
    } else {
      console.log(`  ${fg(255, 80, 80)}Invalid choice${RESET}`);
    }
    console.log();
  }

  // ── Learn / Tutorial ──

  async learnMenu(): Promise<void> {
    console.log(`
${BOLD}${fg(180, 200, 255)}  ── Learn ──${RESET}

  ${fg(100, 255, 180)}[1]${RESET} What is a matrix?
  ${fg(100, 255, 180)}[2]${RESET} Scalars, vectors, and matrices
  ${fg(100, 255, 180)}[3]${RESET} Matrix addition
  ${fg(100, 255, 180)}[4]${RESET} Matrix multiplication
  ${fg(100, 255, 180)}[5]${RESET} Transpose
  ${fg(100, 255, 180)}[6]${RESET} Determinant
  ${fg(100, 255, 180)}[7]${RESET} Inverse
  ${fg(100, 255, 180)}[8]${RESET} Identity matrix
  ${fg(100, 255, 180)}[9]${RESET} Interactive demo — multiply step by step
  ${fg(100, 255, 180)}[b]${RESET} Back
`);
    const choice = await this.ask("  choice> ");
    if (choice === "b") return;

    if (choice === "1") {
      console.log(`
${BOLD}  What is a Matrix?${RESET}

  A matrix is a rectangular grid of numbers arranged in rows and columns.

  Example — a 3×3 matrix:`);
      const demo = Matrix.random(3, 3, 1, 9, true, "demo");
      console.log("\n" + renderMatrix(demo, undefined, 1, "A"));
      console.log(`
  ${DIM}Each colored cell holds a number. The color tells you how big or
  small the value is relative to other values in the matrix.

  Rows go left ↔ right.  Columns go up ↕ down.
  This matrix has 3 rows and 3 columns — we call it a "3 by 3" matrix.${RESET}
`);
    } else if (choice === "2") {
      console.log(`
${BOLD}  Scalars, Vectors, and Matrices${RESET}

  They are all the same thing — just different sizes!`);

      const s = Matrix.scalar(7, "scalar");
      const v = Matrix.vector([2, 5, 3], "vector");
      const m = Matrix.random(3, 3, 1, 9, true, "matrix");

      console.log("\n" + renderConstellation([s, v, m], ["  ", "  "]));
      console.log(`
  ${DIM}• A scalar is a 1×1 matrix — just one number.
  • A vector is a matrix with only 1 column (or 1 row).
  • A matrix is the general rectangular grid of numbers.

  In this tool, all three are stored the same way!${RESET}
`);
    } else if (choice === "3") {
      console.log(`
${BOLD}  Matrix Addition${RESET}

  Add two matrices of the ${BOLD}same size${RESET} — add matching cells.`);

      const a = new Matrix([[1, 2], [3, 4]], "A");
      const b = new Matrix([[5, 6], [7, 8]], "B");
      const c = a.add(b);
      c.name = "A+B";

      console.log("\n" + renderConstellation([a, b, c], ["+", "="]));
      console.log(`
  ${DIM}Each cell: result[r][c] = A[r][c] + B[r][c]
  For example: 1 + 5 = 6,  2 + 6 = 8,  3 + 7 = 10,  4 + 8 = 12${RESET}
`);
    } else if (choice === "4") {
      console.log(`
${BOLD}  Matrix Multiplication${RESET}

  To multiply A(m×n) × B(n×p), the inner dimensions must match!
  Result is (m×p).  Each cell is a ${BOLD}dot product${RESET} of a row and column.`);

      const a = new Matrix([[1, 2, 3], [4, 5, 6]], "A");
      const b = new Matrix([[7, 8], [9, 10], [11, 12]], "B");
      const c = a.multiply(b);
      c.name = "A×B";

      console.log("\n" + renderConstellation([a, b, c], ["×", "="]));
      console.log(`
  ${DIM}result[0][0] = 1×7 + 2×9 + 3×11 = 7 + 18 + 33 = 58
  result[0][1] = 1×8 + 2×10 + 3×12 = 8 + 20 + 36 = 64
  ...and so on for each cell.${RESET}
`);
    } else if (choice === "5") {
      console.log(`
${BOLD}  Transpose${RESET}

  Flip the matrix over its diagonal — rows become columns.`);

      const a = new Matrix([[1, 2, 3], [4, 5, 6]], "A");
      const t = a.transpose();
      t.name = "Aᵀ";

      console.log("\n" + renderConstellation([a, t], ["ᵀ→"]));
      console.log(`
  ${DIM}A is 2×3, its transpose Aᵀ is 3×2.
  Row 0 of A becomes column 0 of Aᵀ, etc.${RESET}
`);
    } else if (choice === "6") {
      console.log(`
${BOLD}  Determinant${RESET}

  A single number that tells you about a square matrix.
  If det = 0, the matrix is "singular" (no inverse exists).`);

      const a = new Matrix([[3, 1], [5, 2]], "A");
      console.log("\n" + renderMatrix(a, undefined, 1, "A"));
      console.log(`
  ${DIM}For a 2×2 matrix [[a,b],[c,d]]:  det = a×d − b×c
  det(A) = 3×2 − 1×5 = 6 − 5 = ${BOLD}1${RESET}

  ${DIM}The determinant tells you the "scaling factor" of the transformation
  the matrix represents. If det = 2, areas double. If det = −1, areas
  stay same size but flip orientation.${RESET}
`);
    } else if (choice === "7") {
      console.log(`
${BOLD}  Inverse${RESET}

  The inverse A⁻¹ is the matrix such that A × A⁻¹ = I (identity).
  Only square matrices with ${BOLD}non-zero determinant${RESET} have inverses.`);

      const a = new Matrix([[4, 7], [2, 6]], "A");
      const inv = a.inverse();
      inv.name = "A⁻¹";
      const id = a.multiply(inv);
      id.name = "A×A⁻¹";

      console.log(
        "\n" + renderConstellation([a, inv, id], ["⁻¹→", "verify:"])
      );
      console.log(`
  ${DIM}A × A⁻¹ gives the identity matrix (1s on diagonal, 0s elsewhere).
  The inverse "undoes" what the matrix does.${RESET}
`);
    } else if (choice === "8") {
      console.log(`
${BOLD}  Identity Matrix${RESET}

  The identity matrix I has 1s on the diagonal and 0s everywhere else.
  Any matrix times I equals itself: A × I = A.`);

      const id = Matrix.identity(4, "I₄");
      const a = Matrix.random(4, 4, 1, 9, true, "A");
      const result = a.multiply(id);
      result.name = "A×I";

      console.log("\n" + renderConstellation([a, id, result], ["×", "="]));
      console.log(`
  ${DIM}I is the matrix version of the number 1.
  Multiplying by I changes nothing — it's the "do nothing" matrix.${RESET}
`);
    } else if (choice === "9") {
      await this.interactiveMultiplyDemo();
    } else {
      console.log(`  ${fg(255, 80, 80)}Invalid choice${RESET}`);
    }
  }

  async interactiveMultiplyDemo(): Promise<void> {
    console.log(`
${BOLD}  Interactive Multiplication Demo${RESET}
  ${DIM}Watch how each cell of the result is computed step by step.${RESET}
`);

    const a = new Matrix([[1, 2, 3], [4, 5, 6]], "A");
    const b = new Matrix([[7, 8], [9, 10], [11, 12]], "B");

    console.log(renderConstellation([a, b], ["×"]));
    console.log();

    const result = Matrix.zeros(a.rows, b.cols, "C");

    for (let r = 0; r < a.rows; r++) {
      for (let c = 0; c < b.cols; c++) {
        let explanation = `  C[${r}][${c}] = `;
        let sum = 0;
        const terms: string[] = [];
        for (let k = 0; k < a.cols; k++) {
          const prod = a.data[r][k] * b.data[k][c];
          sum += prod;
          terms.push(`${a.data[r][k]}×${b.data[k][c]}`);
        }
        explanation += terms.join(" + ") + ` = ${BOLD}${fg(255, 220, 50)}${sum}${RESET}`;
        result.set(r, c, sum);
        console.log(explanation);
        console.log(renderMatrix(result, undefined, 1, "C (building...)"));
        console.log();
        await this.ask(`  ${DIM}[press Enter to continue]${RESET}`);
      }
    }

    result.name = "C";
    this.workspace.set("C", result);
    console.log(`  ${fg(100, 255, 180)}Final result stored as "C"${RESET}\n`);
  }

  // ── Main Loop ──

  async run(): Promise<void> {
    clearScreen();
    this.printTitle();

    // Seed workspace with a few example matrices
    this.workspace.set("A", Matrix.random(3, 3, 0, 9, true, "A"));
    this.workspace.set("I3", Matrix.identity(3, "I3"));

    while (this.running) {
      this.printMenu();
      const choice = await this.ask("  choice> ");

      if (choice === "q" || choice === "quit" || choice === "exit") {
        console.log(
          `\n  ${fg(100, 200, 255)}Thanks for learning matrices! Goodbye.${RESET}\n`
        );
        this.running = false;
      } else if (choice === "1") {
        await this.createMenu();
      } else if (choice === "2") {
        await this.viewMenu();
      } else if (choice === "3") {
        await this.operationsMenu();
      } else if (choice === "4") {
        await this.propertiesMenu();
      } else if (choice === "5") {
        this.listMatrices();
      } else if (choice === "6") {
        await this.zoomMenu();
      } else if (choice === "7") {
        await this.tinyPictureMenu();
      } else if (choice === "8") {
        await this.constellationMenu();
      } else if (choice === "9") {
        await this.galleryMenu();
      } else if (choice === "0") {
        await this.learnMenu();
      } else {
        console.log(`  ${fg(255, 80, 80)}Unknown option "${choice}"${RESET}`);
      }
    }

    this.rl.close();
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

const app = new TeachMatrices();
await app.run();
