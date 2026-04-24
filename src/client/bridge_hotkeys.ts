// Global keyboard handler for the bridge: Escape clears selection, R resets the plot, Space submits.
// Depends on: nothing. Consumed by: src/client/main.ts.
// Invariant: hotkeys are ignored while the user is typing in an input/select/textarea/button/contenteditable target, or holding Alt/Ctrl/Meta, or while a pointer drag is active.

export type GlobalHotkeyCallbacks = {
  hasActiveTacticalDrag: () => boolean;
  hasSelectedSystem: () => boolean;
  canSubmitPlot: () => boolean;
  onClearSelectedSystem: () => void;
  onResetPlotDraft: () => void;
  onSubmitPlot: () => void;
};

export function shouldIgnoreGlobalHotkeys(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest("input, select, textarea, button, [contenteditable='true']"));
}

export function createGlobalHotkeyHandler(callbacks: GlobalHotkeyCallbacks): (event: KeyboardEvent) => void {
  return (event) => {
    if (
      event.defaultPrevented ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.repeat ||
      callbacks.hasActiveTacticalDrag()
    ) {
      return;
    }

    if (shouldIgnoreGlobalHotkeys(event.target)) {
      return;
    }

    if (event.key === "Escape") {
      if (callbacks.hasSelectedSystem()) {
        event.preventDefault();
        callbacks.onClearSelectedSystem();
      }
      return;
    }

    if (!callbacks.canSubmitPlot()) {
      return;
    }

    if (event.code === "KeyR") {
      event.preventDefault();
      callbacks.onResetPlotDraft();
      return;
    }

    if (event.code === "Space") {
      event.preventDefault();
      callbacks.onSubmitPlot();
    }
  };
}
