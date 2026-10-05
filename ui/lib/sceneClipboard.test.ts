import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clipboardFields,
  describeClipboard,
  pasteSceneTarget,
  type SceneClipboard,
} from './sceneClipboard.ts';

const clip = (config: object): SceneClipboard => ({
  config: config as SceneClipboard['config'],
  sourceName: 'Desk lamp',
  sourceKey: 'device:zigbee/desk',
});

describe('scene target clipboard', () => {
  const warm = clip({ power: true, brightness: 0.4, color: { ct: 2700 } });

  it('pastes an exact copy by default', () => {
    const pasted = pasteSceneTarget({ power: false, transition: 2 }, warm);
    assert.deepEqual(pasted, {
      power: true,
      brightness: 0.4,
      color: { ct: 2700 },
    });
    assert.notEqual(
      (pasted as { color: object }).color,
      (warm.config as { color: object }).color,
    );
  });

  it('pastes selected fields and resets fields the copy leaves unset', () => {
    assert.deepEqual(
      pasteSceneTarget({ power: false, brightness: 0.9, transition: 2 }, warm, [
        'color',
      ]),
      { power: false, brightness: 0.9, transition: 2, color: { ct: 2700 } },
    );
    assert.deepEqual(
      pasteSceneTarget({ brightness: 0.9, transition: 2 }, warm, [
        'transition',
      ]),
      { brightness: 0.9 },
    );
  });

  it('turns a link target into a state target on a field paste', () => {
    assert.deepEqual(
      pasteSceneTarget({ scene_id: 'evening' }, warm, ['brightness']),
      { brightness: 0.4 },
    );
  });

  it('copies links whole, ignoring field selection', () => {
    const link = clip({
      integration_id: 'circadian',
      device_id: 'rhythm',
      brightness: 0.8,
    });
    assert.deepEqual(clipboardFields(link), []);
    assert.deepEqual(
      pasteSceneTarget({ power: true }, link, ['color']),
      link.config,
    );
    assert.equal(describeClipboard(link), 'Follows circadian/rhythm');
  });

  it('describes copied state', () => {
    assert.deepEqual(clipboardFields(warm), ['power', 'brightness', 'color']);
    assert.equal(describeClipboard(warm), 'On · 40% · 2700 K');
    assert.equal(describeClipboard(clip({})), 'Defaults (on, full brightness)');
  });
});
