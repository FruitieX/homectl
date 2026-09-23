/**
 * Shared mount budget for lazy WebGL previews (rooms list, future lists).
 *
 * Every preview registers itself and reports whether it is currently
 * intersecting the viewport. The budget keeps at most `maxMounted` previews
 * mounted at once: currently visible previews always win, previously visible
 * ones stay mounted (so scrolling back shows their canvas immediately) until
 * a newly visible preview needs the slot. That keeps the number of live WebGL
 * contexts bounded while avoiding mount/unmount churn for previews the user is
 * likely to scroll back to.
 */

interface PreviewEntry {
  visible: boolean;
  lastVisibleAt: number;
}

function setsEqual(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  if (left.size !== right.size) {
    return false;
  }

  for (const value of left) {
    if (!right.has(value)) {
      return false;
    }
  }

  return true;
}

export class PreviewMountBudget {
  private readonly entries = new Map<string, PreviewEntry>();
  private readonly selected = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly maxMounted: number;
  private sequence = 0;

  constructor(maxMounted: number) {
    this.maxMounted = maxMounted;
  }

  /**
   * Subscribe to mount-slot changes. Stable reference so it can be passed
   * straight to `useSyncExternalStore`.
   */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  register(id: string) {
    this.entries.set(id, { visible: false, lastVisibleAt: 0 });
    this.recompute();
  }

  unregister(id: string) {
    if (this.entries.delete(id)) {
      this.recompute();
    }
  }

  setVisible(id: string, visible: boolean) {
    const entry = this.entries.get(id);
    if (!entry || entry.visible === visible) {
      return;
    }

    entry.visible = visible;
    if (visible) {
      this.sequence += 1;
      entry.lastVisibleAt = this.sequence;
    }

    this.recompute();
  }

  isMounted(id: string) {
    return this.selected.has(id);
  }

  private recompute() {
    const capacity = Math.max(1, this.maxMounted);
    const entries = [...this.entries.entries()];
    const byOldestFirst = (
      a: [string, PreviewEntry],
      b: [string, PreviewEntry],
    ) => a[1].lastVisibleAt - b[1].lastVisibleAt;
    const byNewestFirst = (
      a: [string, PreviewEntry],
      b: [string, PreviewEntry],
    ) => b[1].lastVisibleAt - a[1].lastVisibleAt;

    // Keep already-mounted visible previews, then mount newly visible ones
    // (oldest first for fairness), then keep nearby previously visible
    // previews, most recently seen first, while capacity remains.
    const keptVisible = entries
      .filter(([id, entry]) => this.selected.has(id) && entry.visible)
      .sort(byOldestFirst);
    const freshVisible = entries
      .filter(([id, entry]) => !this.selected.has(id) && entry.visible)
      .sort(byOldestFirst);
    const nearbyMounted = entries
      .filter(([id, entry]) => this.selected.has(id) && !entry.visible)
      .sort(byNewestFirst);

    const next = new Set<string>();
    for (const group of [keptVisible, freshVisible, nearbyMounted]) {
      for (const [id] of group) {
        if (next.size >= capacity) {
          break;
        }
        next.add(id);
      }
    }

    if (setsEqual(next, this.selected)) {
      return;
    }

    this.selected.clear();
    for (const id of next) {
      this.selected.add(id);
    }

    for (const listener of this.listeners) {
      listener();
    }
  }
}

/**
 * Global budget for group floorplan previews. Browsers keep only a handful of
 * WebGL contexts alive per page (single digits on low-memory phones), and
 * evicting a context blanks a preview the user is looking at. Staying well
 * below that cap leaves headroom for the rest of the app's canvases.
 */
export const previewMountBudget = new PreviewMountBudget(6);
