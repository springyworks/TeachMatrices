// ═══════════════════════════════════════════════════════════════════════════════
//  Matrix — Scientific matrix operations with Viridis colormap visualization
// ═══════════════════════════════════════════════════════════════════════════════

export type RGB = [number, number, number];

// ─── Viridis Colormap ────────────────────────────────────────────────────────

const VIRIDIS_STOPS: RGB[] = [
  [68, 1, 84],
  [72, 35, 116],
  [64, 67, 135],
  [52, 94, 141],
  [33, 144, 140],
  [39, 173, 129],
  [92, 200, 99],
  [170, 220, 50],
  [253, 231, 37],
];

export function viridis(t: number): RGB {
  const v = Math.max(0, Math.min(1, t));
  const n = VIRIDIS_STOPS.length - 1;
  const idx = v * n;
  const lo = Math.floor(idx);
  const hi = Math.min(lo + 1, n);
  const f = idx - lo;
  const a = VIRIDIS_STOPS[lo];
  const b = VIRIDIS_STOPS[hi];
  return [
    Math.round(a[0] + (b[0] - a[0]) * f),
    Math.round(a[1] + (b[1] - a[1]) * f),
    Math.round(a[2] + (b[2] - a[2]) * f),
  ];
}

export function contrastFg(bg: RGB): RGB {
  const lum = 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2];
  return lum > 140 ? [0, 0, 0] : [255, 255, 255];
}

function rgbCss(c: RGB): string {
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

// ─── Matrix Class ────────────────────────────────────────────────────────────

export class Matrix {
  readonly rows: number;
  readonly cols: number;
  readonly data: number[][];

  constructor(data: number[][]) {
    this.rows = data.length;
    this.cols = data.length > 0 ? data[0].length : 0;
    this.data = data.map((r) => [...r]);
  }

  static zeros(rows: number, cols: number): Matrix {
    return new Matrix(
      Array.from({ length: rows }, () => new Array<number>(cols).fill(0))
    );
  }

  static identity(n: number): Matrix {
    const m = Matrix.zeros(n, n);
    for (let i = 0; i < n; i++) m.data[i][i] = 1;
    return m;
  }

  static random(rows: number, cols: number, lo = 0, hi = 1): Matrix {
    return new Matrix(
      Array.from({ length: rows }, () =>
        Array.from({ length: cols }, () => lo + Math.random() * (hi - lo))
      )
    );
  }

  get(r: number, c: number): number {
    return this.data[r][c];
  }

  add(other: Matrix): Matrix {
    if (this.rows !== other.rows || this.cols !== other.cols)
      throw new Error(`Dimension mismatch: (${this.rows}×${this.cols}) + (${other.rows}×${other.cols})`);
    return new Matrix(
      this.data.map((row, i) => row.map((v, j) => v + other.data[i][j]))
    );
  }

  sub(other: Matrix): Matrix {
    if (this.rows !== other.rows || this.cols !== other.cols)
      throw new Error(`Dimension mismatch: (${this.rows}×${this.cols}) - (${other.rows}×${other.cols})`);
    return new Matrix(
      this.data.map((row, i) => row.map((v, j) => v - other.data[i][j]))
    );
  }

  mul(other: Matrix): Matrix {
    if (this.cols !== other.rows)
      throw new Error(`Dimension mismatch: (${this.rows}×${this.cols}) × (${other.rows}×${other.cols})`);
    const result = Matrix.zeros(this.rows, other.cols);
    for (let i = 0; i < this.rows; i++) {
      for (let j = 0; j < other.cols; j++) {
        let sum = 0;
        for (let k = 0; k < this.cols; k++) {
          sum += this.data[i][k] * other.data[k][j];
        }
        result.data[i][j] = sum;
      }
    }
    return result;
  }

  scale(s: number): Matrix {
    return new Matrix(this.data.map((row) => row.map((v) => v * s)));
  }

  transpose(): Matrix {
    const result = Matrix.zeros(this.cols, this.rows);
    for (let i = 0; i < this.rows; i++)
      for (let j = 0; j < this.cols; j++)
        result.data[j][i] = this.data[i][j];
    return result;
  }

  trace(): number {
    const n = Math.min(this.rows, this.cols);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += this.data[i][i];
    return sum;
  }

  norm(): number {
    let sum = 0;
    for (const row of this.data)
      for (const v of row) sum += v * v;
    return Math.sqrt(sum);
  }

  map(fn: (v: number, r: number, c: number) => number): Matrix {
    return new Matrix(
      this.data.map((row, i) => row.map((v, j) => fn(v, i, j)))
    );
  }

  /** Render as a colorized HTML grid */
  toHtml(maxRows = 16, maxCols = 16): string {
    const rEnd = Math.min(this.rows, maxRows);
    const cEnd = Math.min(this.cols, maxCols);

    // Find value range for normalization
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < rEnd; i++)
      for (let j = 0; j < cEnd; j++) {
        const v = this.data[i][j];
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    const range = hi - lo || 1;

    const gridCols = `repeat(${cEnd}, 28px)`;
    let html = `<div class="matrix-grid" style="grid-template-columns:${gridCols}">`;
    for (let i = 0; i < rEnd; i++) {
      for (let j = 0; j < cEnd; j++) {
        const v = this.data[i][j];
        const t = (v - lo) / range;
        const bg = viridis(t);
        const fg = contrastFg(bg);
        const display = Number.isInteger(v) ? String(v) : v.toFixed(1);
        html += `<div class="matrix-cell" style="background:${rgbCss(bg)};color:${rgbCss(fg)}">${display}</div>`;
      }
    }
    html += '</div>';
    if (this.rows > maxRows || this.cols > maxCols) {
      html += `<div style="font-size:10px;color:#888;margin-top:2px">${this.rows}×${this.cols} (truncated)</div>`;
    }
    return html;
  }

  toString(): string {
    return `Matrix(${this.rows}×${this.cols})`;
  }
}
