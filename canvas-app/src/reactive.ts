// ═══════════════════════════════════════════════════════════════════════════════
//  Reactive Pub/Sub — Pure TypeScript event bus for inter-cell communication
// ═══════════════════════════════════════════════════════════════════════════════

export type Listener<T = unknown> = (data: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<Listener>>();

  on<T = unknown>(event: string, fn: Listener<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    const set = this.listeners.get(event)!;
    set.add(fn as Listener);
    // Return unsubscribe function
    return () => set.delete(fn as Listener);
  }

  off<T = unknown>(event: string, fn: Listener<T>): void {
    this.listeners.get(event)?.delete(fn as Listener);
  }

  emit<T = unknown>(event: string, data: T): void {
    this.listeners.get(event)?.forEach((fn) => fn(data));
  }

  clear(): void {
    this.listeners.clear();
  }
}

/** Singleton bus shared across the whole canvas */
export const bus = new EventBus();

// ═══════════════════════════════════════════════════════════════════════════════
//  Topological execution order — ensures cells run in dependency order
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Kahn's algorithm for topological sort.
 * Returns cell IDs in valid execution order, or null if a cycle exists.
 */
export function topoSort(
  nodeIds: string[],
  edges: Array<{ source: string; target: string }>
): string[] | null {
  const inDeg = new Map<string, number>();
  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDeg.set(id, 0);
    adj.set(id, []);
  }
  for (const { source, target } of edges) {
    adj.get(source)?.push(target);
    inDeg.set(target, (inDeg.get(target) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, deg] of inDeg) {
    if (deg === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const neighbor of adj.get(node) ?? []) {
      const newDeg = (inDeg.get(neighbor) ?? 1) - 1;
      inDeg.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  return order.length === nodeIds.length ? order : null;
}
