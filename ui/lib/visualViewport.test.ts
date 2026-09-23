import assert from 'node:assert/strict';
import test from 'node:test';

import {
  KEYBOARD_MIN_INSET_PX,
  resolveVisualViewportHeight,
} from './visualViewport.ts';

// Overlays with a text field size themselves from the visual viewport so the
// software keyboard cannot cover the composer. Two mistakes are worth
// preventing: sizing from a visual viewport that only shrank because the
// browser chrome scrolled away (sheets resize while the user scrolls), and
// leaving a sheet sized for a keyboard that has already closed.
test('a keyboard-sized inset sizes the sheet to the visual viewport', () => {
  assert.equal(
    resolveVisualViewportHeight({ layoutHeight: 915, visualHeight: 715 }),
    715,
  );
});

test('browser chrome changes leave the sheet on the dynamic viewport height', () => {
  assert.equal(
    resolveVisualViewportHeight({ layoutHeight: 915, visualHeight: 867 }),
    null,
  );
  assert.equal(
    resolveVisualViewportHeight({ layoutHeight: 915, visualHeight: 915 }),
    null,
  );
});

test('an inset at the keyboard threshold counts as a keyboard', () => {
  assert.equal(
    resolveVisualViewportHeight({
      layoutHeight: 800,
      visualHeight: 800 - KEYBOARD_MIN_INSET_PX,
    }),
    700,
  );
});

test('a missing or nonsensical height falls back to the dynamic viewport', () => {
  assert.equal(
    resolveVisualViewportHeight({ layoutHeight: 800, visualHeight: 0 }),
    null,
  );
  assert.equal(
    resolveVisualViewportHeight({
      layoutHeight: 800,
      visualHeight: Number.NaN,
    }),
    null,
  );
  assert.equal(
    resolveVisualViewportHeight({ layoutHeight: 0, visualHeight: 600 }),
    null,
  );
});
