// ═══════════════════════════════════════════════════════════════════════════════
//  ForceLayout — Force-directed graph layout with animated settling
//  Implements a velocity Verlet simulation:
//    • Repulsion (Coulomb) between all node pairs
//    • Attraction (spring/Hooke) along edges, weighted by relation type
//    • Center gravity to keep the graph from drifting
//    • Velocity damping for wobbly settling effect
//  Provides tick-by-tick positions so the caller can animate overlays.
// ═══════════════════════════════════════════════════════════════════════════════

import type { ReferenceKind } from './ts-parser';

export interface ForceNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // internal state
  vx: number;
  vy: number;
  fx: number;
  fy: number;
  /** If pinned, position doesn't change */
  pinned?: boolean;
}

export interface ForceEdge {
  source: string;
  target: string;
  kind: ReferenceKind;
}

/** Attraction strength multiplier per edge kind (stronger = shorter edge) */
const EDGE_WEIGHTS: Partial<Record<ReferenceKind, number>> = {
  extends: 2.5,
  implements: 2.0,
  instantiates: 1.8,
  calls: 1.5,
  'type-ref': 1.2,
  imports: 0.6,
  'uses-variable': 1.0,
  'uses-type': 1.0,
};

export interface ForceLayoutConfig {
  /** Repulsion strength between nodes (default: 8000) */
  repulsion: number;
  /** Base spring attraction strength (default: 0.005) */
  attraction: number;
  /** Ideal edge length in pixels (default: 250) */
  idealLength: number;
  /** Velocity damping factor 0..1 (default: 0.85 — wobbly) */
  damping: number;
  /** Center gravity strength (default: 0.01) */
  gravity: number;
  /** Max velocity per axis per tick (default: 30) */
  maxSpeed: number;
  /** Temperature: initial kinetic energy multiplier (default: 1.0) */
  temperature: number;
  /** Cooling rate per tick (default: 0.995) */
  cooling: number;
  /** Minimum temperature threshold to stop (default: 0.01) */
  minTemperature: number;
}

const DEFAULT_CONFIG: ForceLayoutConfig = {
  repulsion: 8000,
  attraction: 0.005,
  idealLength: 250,
  damping: 0.85,
  gravity: 0.01,
  maxSpeed: 30,
  temperature: 1.0,
  cooling: 0.995,
  minTemperature: 0.01,
};

export type TickCallback = (
  nodes: ReadonlyArray<ForceNode>,
  progress: number,
  settled: boolean
) => void;

export class ForceLayout {
  private nodes: ForceNode[] = [];
  private edges: ForceEdge[] = [];
  private nodeMap = new Map<string, ForceNode>();
  private config: ForceLayoutConfig;
  private temperature: number;
  private tickCount = 0;
  private maxTicks = 300;
  private animFrameId: number | null = null;
  private onTick: TickCallback | null = null;
  private running = false;

  constructor(config?: Partial<ForceLayoutConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.temperature = this.config.temperature;
  }

  /** Initialize nodes and edges for the simulation */
  init(
    nodes: Array<{ id: string; x: number; y: number; width: number; height: number }>,
    edges: ForceEdge[]
  ): void {
    this.stop();
    this.nodes = nodes.map((n) => ({
      ...n,
      vx: 0,
      vy: 0,
      fx: 0,
      fy: 0,
    }));
    this.edges = edges;
    this.nodeMap.clear();
    for (const n of this.nodes) {
      this.nodeMap.set(n.id, n);
    }
    this.temperature = this.config.temperature;
    this.tickCount = 0;
  }

  /** Pin a node at a specific position (it won't move in the simulation) */
  pinNode(id: string, x: number, y: number): void {
    const node = this.nodeMap.get(id);
    if (node) {
      node.x = x;
      node.y = y;
      node.vx = 0;
      node.vy = 0;
      node.pinned = true;
    }
  }

  /** Unpin a node so the simulation can move it again */
  unpinNode(id: string): void {
    const node = this.nodeMap.get(id);
    if (node) {
      node.pinned = false;
    }
  }

  /** Reset temperature to re-energize the simulation (e.g. after user intervention) */
  reheat(temp?: number): void {
    this.temperature = temp ?? this.config.temperature * 0.5;
    this.tickCount = Math.min(this.tickCount, this.maxTicks * 0.5);
  }

  /** Start the animated simulation */
  start(onTick: TickCallback): void {
    if (this.running) this.stop();
    this.onTick = onTick;
    this.running = true;
    this.tickCount = 0;
    this.temperature = this.config.temperature;
    this.loop();
  }

  /** Stop the simulation */
  stop(): void {
    this.running = false;
    if (this.animFrameId !== null) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  /** Run a single tick of the simulation */
  tick(): boolean {
    if (this.nodes.length === 0) return true;

    const { repulsion, attraction, idealLength, damping, gravity, maxSpeed, cooling, minTemperature } =
      this.config;

    // Reset forces
    for (const n of this.nodes) {
      n.fx = 0;
      n.fy = 0;
    }

    // ── Repulsion (all pairs) ──
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        // Use center-to-center distance
        const ax = a.x + a.width / 2;
        const ay = a.y + a.height / 2;
        const bx = b.x + b.width / 2;
        const by = b.y + b.height / 2;
        let dx = bx - ax;
        let dy = by - ay;
        const distSq = dx * dx + dy * dy;
        const dist = Math.sqrt(distSq) || 1;

        // Account for node sizes — reduce effective distance by overlap
        const minDist = (a.width + b.width) / 2 + 40;
        const effectiveDist = Math.max(dist - minDist, 1);

        const force = (repulsion * this.temperature) / (effectiveDist * effectiveDist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.fx -= fx;
        a.fy -= fy;
        b.fx += fx;
        b.fy += fy;
      }
    }

    // ── Spring attraction along edges ──
    for (const edge of this.edges) {
      const a = this.nodeMap.get(edge.source);
      const b = this.nodeMap.get(edge.target);
      if (!a || !b) continue;

      const ax = a.x + a.width / 2;
      const ay = a.y + a.height / 2;
      const bx = b.x + b.width / 2;
      const by = b.y + b.height / 2;
      let dx = bx - ax;
      let dy = by - ay;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;

      const weight = EDGE_WEIGHTS[edge.kind] ?? 1.0;
      const displacement = dist - idealLength;
      const force = attraction * weight * displacement;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.fx += fx;
      a.fy += fy;
      b.fx -= fx;
      b.fy -= fy;
    }

    // ── Edge-node overlap avoidance ──
    // Push nodes away from edges they're not endpoints of, preventing
    // connectors from running under/through unrelated nodes.
    const edgeNodeRepulsion = repulsion * 0.3;
    for (const edge of this.edges) {
      const src = this.nodeMap.get(edge.source);
      const tgt = this.nodeMap.get(edge.target);
      if (!src || !tgt) continue;

      const sx = src.x + src.width / 2;
      const sy = src.y + src.height / 2;
      const tx = tgt.x + tgt.width / 2;
      const ty = tgt.y + tgt.height / 2;
      const edgeDx = tx - sx;
      const edgeDy = ty - sy;
      const edgeLenSq = edgeDx * edgeDx + edgeDy * edgeDy;
      if (edgeLenSq < 1) continue;
      const edgeLen = Math.sqrt(edgeLenSq);

      for (const n of this.nodes) {
        if (n.id === edge.source || n.id === edge.target) continue;

        // Project node center onto the edge line segment
        const nx = n.x + n.width / 2;
        const ny = n.y + n.height / 2;
        const t = Math.max(0, Math.min(1,
          ((nx - sx) * edgeDx + (ny - sy) * edgeDy) / edgeLenSq
        ));
        const closestX = sx + t * edgeDx;
        const closestY = sy + t * edgeDy;

        const pdx = nx - closestX;
        const pdy = ny - closestY;
        const pDist = Math.sqrt(pdx * pdx + pdy * pdy) || 1;

        // Only apply force if node is close to the edge
        const nodeRadius = Math.max(n.width, n.height) / 2 + 30;
        if (pDist < nodeRadius) {
          const pushForce = edgeNodeRepulsion * (1 - pDist / nodeRadius) / pDist;
          n.fx += pdx * pushForce;
          n.fy += pdy * pushForce;
          // Also push the edge endpoints slightly away
          const epForce = pushForce * 0.15;
          src.fx -= pdx * epForce * (1 - t);
          src.fy -= pdy * epForce * (1 - t);
          tgt.fx -= pdx * epForce * t;
          tgt.fy -= pdy * epForce * t;
        }
      }
    }

    // ── Edge crossing minimization ──
    // When two edges cross, apply a torque-like force to uncross them
    // by rotating their endpoints apart.
    const crossingRepulsion = repulsion * 0.08;
    for (let i = 0; i < this.edges.length; i++) {
      const e1 = this.edges[i];
      const a1 = this.nodeMap.get(e1.source);
      const b1 = this.nodeMap.get(e1.target);
      if (!a1 || !b1) continue;

      for (let j = i + 1; j < this.edges.length; j++) {
        const e2 = this.edges[j];
        // Skip if edges share an endpoint (they always cross at that point)
        if (e2.source === e1.source || e2.source === e1.target ||
            e2.target === e1.source || e2.target === e1.target) continue;

        const a2 = this.nodeMap.get(e2.source);
        const b2 = this.nodeMap.get(e2.target);
        if (!a2 || !b2) continue;

        // Check if they cross using segment intersection test
        if (this.segmentsIntersect(
          a1.x + a1.width / 2, a1.y + a1.height / 2,
          b1.x + b1.width / 2, b1.y + b1.height / 2,
          a2.x + a2.width / 2, a2.y + a2.height / 2,
          b2.x + b2.width / 2, b2.y + b2.height / 2
        )) {
          // Apply perpendicular forces to uncross: push midpoints apart
          const m1x = (a1.x + a1.width / 2 + b1.x + b1.width / 2) / 2;
          const m1y = (a1.y + a1.height / 2 + b1.y + b1.height / 2) / 2;
          const m2x = (a2.x + a2.width / 2 + b2.x + b2.width / 2) / 2;
          const m2y = (a2.y + a2.height / 2 + b2.y + b2.height / 2) / 2;

          let mdx = m1x - m2x;
          let mdy = m1y - m2y;
          const mDist = Math.sqrt(mdx * mdx + mdy * mdy) || 1;
          mdx /= mDist;
          mdy /= mDist;

          const cf = crossingRepulsion * this.temperature;
          // Push edge1 endpoints one way, edge2 the other
          a1.fx += mdx * cf;
          a1.fy += mdy * cf;
          b1.fx += mdx * cf;
          b1.fy += mdy * cf;
          a2.fx -= mdx * cf;
          a2.fy -= mdy * cf;
          b2.fx -= mdx * cf;
          b2.fy -= mdy * cf;
        }
      }
    }

    // ── Center gravity ──
    if (this.nodes.length > 0) {
      let cx = 0, cy = 0;
      for (const n of this.nodes) {
        cx += n.x + n.width / 2;
        cy += n.y + n.height / 2;
      }
      cx /= this.nodes.length;
      cy /= this.nodes.length;

      for (const n of this.nodes) {
        const nx = n.x + n.width / 2;
        const ny = n.y + n.height / 2;
        n.fx -= (nx - cx) * gravity;
        n.fy -= (ny - cy) * gravity;
      }
    }

    // ── Integrate (velocity Verlet) ──
    let totalMovement = 0;
    for (const n of this.nodes) {
      if (n.pinned) continue;
      n.vx = (n.vx + n.fx) * damping;
      n.vy = (n.vy + n.fy) * damping;

      // Clamp speed
      const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
      if (speed > maxSpeed * this.temperature) {
        const scale = (maxSpeed * this.temperature) / speed;
        n.vx *= scale;
        n.vy *= scale;
      }

      n.x += n.vx;
      n.y += n.vy;

      totalMovement += Math.abs(n.vx) + Math.abs(n.vy);
    }

    // Cool down
    this.temperature *= cooling;
    this.tickCount++;

    // Settled when temperature is very low or max ticks reached
    const settled =
      this.temperature < minTemperature ||
      this.tickCount >= this.maxTicks ||
      totalMovement < 0.5;

    return settled;
  }

  private loop = (): void => {
    if (!this.running) return;

    const settled = this.tick();
    const progress = Math.min(1, this.tickCount / this.maxTicks);

    // Don't auto-stop if there are pinned nodes — the simulation should
    // stay reactive so unpinned nodes keep adjusting around pinned ones.
    const hasPinned = this.nodes.some((n) => n.pinned);
    const shouldStop = settled && !hasPinned;

    if (this.onTick) {
      this.onTick(this.nodes, progress, shouldStop);
    }

    if (shouldStop) {
      this.running = false;
      return;
    }

    this.animFrameId = requestAnimationFrame(this.loop);
  };

  /** Check if two line segments (p1-p2 and p3-p4) intersect */
  private segmentsIntersect(
    x1: number, y1: number, x2: number, y2: number,
    x3: number, y3: number, x4: number, y4: number
  ): boolean {
    const d1x = x2 - x1, d1y = y2 - y1;
    const d2x = x4 - x3, d2y = y4 - y3;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return false; // parallel

    const dx = x3 - x1, dy = y3 - y1;
    const t = (dx * d2y - dy * d2x) / cross;
    const u = (dx * d1y - dy * d1x) / cross;

    return t > 0 && t < 1 && u > 0 && u < 1;
  }
}
