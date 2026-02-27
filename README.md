# TeachMatrices

## ▶ Try it now

Open **https://springyworks.github.io/TeachMatrices/** in your browser — nothing to install.

Pick one of two apps from the landing page:

| App | What it is |
|-----|-----------|
| **Terminal Lab** | A browser terminal for matrix math — type commands, see color-coded results |
| **KosmodTS Canvas** | Drag-and-drop TypeScript code cells on a 2D graph canvas with live dataflow |

---

## Terminal Lab

An interactive command-line matrix tool that runs entirely in the browser.

**What you can do:**
- Create matrices (up to 256×256), vectors, and scalars
- Multiply, add, subtract, transpose, invert, compute determinants and RREF
- Visualize values with a Viridis scientific colormap — cells change color by magnitude
- Zoom and scroll through large matrices with viewport controls
- Render pixel-art patterns (checker, gradient, circle, wave, spiral)
- View a gallery of classic matrices (rotation, Fibonacci, Hilbert, Hadamard, Pascal, DFT)
- Follow interactive step-by-step tutorials on matrix concepts

Type a menu number or command and press Enter. No server, no sign-up.

## KosmodTS Canvas

A visual programming environment where TypeScript code cells live on a 2D canvas.

**What you can do:**
- Add code cells — each contains a Monaco editor (the same editor as VS Code)
- Connect cells with dataflow edges — when an upstream cell produces a result, downstream cells re-execute automatically
- Write TypeScript that creates, transforms, and multiplies `Matrix` objects
- See results (including color-mapped matrix grids) rendered inline below each cell
- Drag cells by their header, auto-layout, and fit-to-view
- Click **★ Example** to load a demo pipeline: two matrices → multiply → transpose → stats

Edges use SysML-inspired styles: dataflow (green), inheritance (purple), containment (blue), dependency (gray).

Built with [maxGraph](https://github.com/maxGraph/maxGraph) for the graph canvas and [Monaco Editor](https://microsoft.github.io/monaco-editor/) for in-cell code editing.

---

## Run locally

**Terminal Lab** — just open `index.html` in any browser. Or run the Node.js version:
```bash
node --experimental-strip-types app.ts
```

**KosmodTS Canvas:**
```bash
cd canvas-app
npm install
npm run dev
```
Then open `http://localhost:5173`.

## Tech

- Pure client-side — no server, no backend, no communication
- Terminal Lab: single self-contained HTML file, zero dependencies
- KosmodTS Canvas: Vite + TypeScript, maxGraph, Monaco Editor
- Deployable as a static site (GitHub Pages)

## Origin

Forked from [TypeScript-Website](https://github.com/nicognaW/TypeScript-Website).
