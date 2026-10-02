import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  conditionResult,
  previewReferences,
  scalarPreviewValue,
} from './automationPreview.ts';

test('an evaluation error takes precedence over true/false/unknown', () => {
  for (const truth of ['true', 'false', 'unknown'] as const)
    assert.equal(
      conditionResult({ truth, error: 'Worker failed' }).tone,
      'error',
    );
  assert.equal(conditionResult({ truth: 'true', error: '' }).tone, 'error');
  assert.equal(conditionResult({ truth: 'false' }).label, 'Condition not met');
  assert.equal(
    conditionResult({ truth: 'unknown' }).label,
    'Condition unknown',
  );
  assert.equal(conditionResult({ truth: 'true' }).label, 'Condition met');
});
test('preview values preserve zero, false, empty text and literal user content', () => {
  assert.equal(scalarPreviewValue(0), '0');
  assert.equal(scalarPreviewValue(false), 'False');
  assert.equal(scalarPreviewValue(''), 'Empty text');
  assert.equal(scalarPreviewValue(null), 'Null');
  assert.equal(
    scalarPreviewValue('<script>bad()</script>'),
    '<script>bad()</script>',
  );
  assert.equal(scalarPreviewValue({ ready: false }), undefined);
});
test('typed plan references win; ambiguous targets do not become guessed entity links', () => {
  const references = [{ entity: 'scene', entity_id: 'a/b' }];
  assert.deepEqual(
    previewReferences({ kind: 'dim', targets: ['a/b'], references }),
    references,
  );
  assert.deepEqual(
    previewReferences({ kind: 'dim', targets: ['a/b'], references: [] }),
    [],
  );
  assert.deepEqual(
    previewReferences({
      kind: 'activate_scene',
      targets: ['normal', 'zigbee/lamp', 'room'],
    }),
    [
      { entity: 'scene', entity_id: 'normal' },
      { entity: 'device', entity_id: 'zigbee/lamp' },
      { entity: 'group', entity_id: 'room' },
    ],
  );
  assert.deepEqual(
    previewReferences({ kind: 'invoke_routine', targets: ['evening'] }),
    [{ entity: 'routine', entity_id: 'evening' }],
  );
  assert.deepEqual(
    previewReferences({ kind: 'schedule_timer', targets: ['local_timer'] }),
    [],
  );
  assert.deepEqual(
    previewReferences({ kind: 'future_action', targets: ['normal'] }),
    [],
  );
});
