// ============================================================
// useHotkeys — Global keyboard shortcut handler
// ============================================================

'use client';

import { useEffect, useCallback } from 'react';

interface HotkeyActions {
  onBuy: () => void;
  onSell: () => void;
  onSubmit: () => void;
  onCancel: () => void;
  onPriceUp: () => void;
  onPriceDown: () => void;
}

export function useHotkeys(actions: HotkeyActions, enabled: boolean = true) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled) return;

      // Don't trigger hotkeys when typing in input fields
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        // Allow Enter and Escape in inputs
        if (e.key === 'Enter') {
          e.preventDefault();
          actions.onSubmit();
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          actions.onCancel();
          (target as HTMLInputElement).blur();
          return;
        }
        return;
      }

      // Ctrl+B → Buy
      if (e.ctrlKey && e.key === 'b') {
        e.preventDefault();
        actions.onBuy();
        return;
      }

      // Ctrl+S → Sell
      if (e.ctrlKey && e.key === 's') {
        e.preventDefault();
        actions.onSell();
        return;
      }

      // Enter → Submit
      if (e.key === 'Enter') {
        e.preventDefault();
        actions.onSubmit();
        return;
      }

      // Escape → Cancel
      if (e.key === 'Escape') {
        e.preventDefault();
        actions.onCancel();
        return;
      }

      // Arrow Up → Price Up
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        actions.onPriceUp();
        return;
      }

      // Arrow Down → Price Down
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        actions.onPriceDown();
        return;
      }
    },
    [actions, enabled]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
