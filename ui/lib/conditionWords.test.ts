import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  conditionWords,
  fieldLabel,
  operatorWords,
  valueWords,
} from './conditionWords.ts';

test('fieldLabel names known fields and falls back to the pointer tail', () => {
  assert.equal(fieldLabel('/value'), 'value');
  assert.equal(fieldLabel('/brightness'), 'brightness');
  assert.equal(fieldLabel('/color/h'), 'h');
  assert.equal(fieldLabel('/value/level'), 'level');
  assert.equal(fieldLabel('/entryway_cooldown'), 'entryway cooldown');
  assert.equal(fieldLabel('/items/2'), 'item 3');
  assert.equal(fieldLabel(''), 'value');
  assert.equal(fieldLabel(undefined), 'value');
});

test('operatorWords reads as words, never as tokens', () => {
  assert.equal(operatorWords('eq'), 'is');
  assert.equal(operatorWords('gte'), 'is at least');
  assert.equal(operatorWords('truthy'), 'has a value');
  assert.equal(operatorWords('starts_with'), 'starts with');
  assert.equal(operatorWords('weird_op'), 'weird op');
});

test('valueWords renders booleans and brightness as people say them', () => {
  assert.equal(valueWords(true, 'power'), 'on');
  assert.equal(valueWords(false, 'power'), 'off');
  assert.equal(valueWords(true, 'motion'), 'active');
  assert.equal(valueWords(false, 'contact'), 'clear');
  assert.equal(valueWords(true, 'state'), 'true');
  assert.equal(valueWords(0.42, 'brightness'), '42%');
  assert.equal(valueWords(21.5, 'temperature'), '21.5');
  assert.equal(valueWords('home', 'state'), 'home');
  assert.equal(valueWords(undefined, 'state'), null);
});

test('conditionWords reads as one sentence', () => {
  assert.equal(
    conditionWords({ field: 'state', subject: 'Entryway cooldown' }, 'eq', false),
    'Entryway cooldown state is false',
  );
  assert.equal(
    conditionWords({ field: 'power', subject: 'Living room lamp' }, 'eq', true),
    'Living room lamp power is on',
  );
  assert.equal(
    conditionWords({ field: 'brightness', subject: 'Hallway spot' }, 'gt', 0.5),
    'Hallway spot brightness is more than 50%',
  );
  // No-value operators never trail a dangling "null".
  assert.equal(
    conditionWords({ field: 'value', subject: 'Sensor' }, 'exists', null),
    'Sensor value exists',
  );
  assert.equal(
    conditionWords({ field: 'value', subject: 'Sensor' }, 'truthy', true),
    'Sensor value has a value',
  );
  // A comparison without a value still reads as a sentence.
  assert.equal(
    conditionWords({ field: 'value', subject: 'Sensor' }, 'eq', undefined),
    'Sensor value is a value',
  );
});
