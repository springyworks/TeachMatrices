# TeachMatrices

Interactive Matrix Laboratory — scientifically styled, color-coded cells, up to 256×256.

**[▶ Launch TeachMatrices](https://springyworks.github.io/TeachMatrices/)**

## Features

- **Scalars, Vectors, Matrices** — all treated uniformly
- **Color-coded cells** — Viridis scientific colormap, auto-contrast text
- **Matrix operations** — add, subtract, multiply, Hadamard, transpose, inverse, determinant, RREF, power, element-wise functions
- **Zoom & viewport** — navigate large matrices (up to 256×256) with scroll/zoom controls
- **Tiny picture mode** — render matrices as pixel art (checker, gradient, circle, wave, spiral, etc.)
- **Constellation view** — display multiple matrices side by side with operators
- **Gallery** — rotation, Fibonacci, Hilbert, magic square, Hadamard, Pascal, DFT matrices
- **Interactive tutorials** — step-by-step lessons on matrix concepts

## Run locally

Open `index.html` in any browser. No server needed.

Or with Node.js (v22.7+):
```bash
node --experimental-strip-types app.ts
```

## Tech

- Single self-contained HTML file (zero dependencies)
- TypeScript terminal version for Node.js
- Pure client-side — no server, no communication
