/**
 * Context menu E2E verification.
 * NOTE: Skipped — the context menu UI component is not yet implemented.
 * The service (contextMenu.ts) dispatches events but no component renders the menu DOM.
 */
import { test } from '@playwright/test';

test.describe('Context Menu', () => {
  test.skip('context menu appears on right-click in viewport', async () => {
    // Pending ContextMenu component implementation
  });

  test.skip('context menu has expected items for viewport', async () => {
    // Pending ContextMenu component implementation
  });

  test.skip('context menu closes on click outside', async () => {
    // Pending ContextMenu component implementation
  });
});
