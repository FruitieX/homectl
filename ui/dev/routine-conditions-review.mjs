import { writeFile } from 'node:fs/promises';

// Own records only, on the explicitly marked isolated fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const base = origin + '/api/v1/config/routines';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = `routine-conditions-${width}-${Date.now()}`;
  const path = '/config/routines/' + id;
  const main = { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' };
  const helper = id + '-helper';
  const helperWrite = await fetch(origin + '/api/v1/config/helpers/' + helper, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: helper,
      name: 'Condition helper',
      kind: { kind: 'boolean' },
      initial_value: false,
      persistence: 'durable',
      create_only: true,
    }),
  });
  if (!helperWrite.ok) throw Error('Helper fixture failed');
  const comparison = {
    kind: 'comparison',
    source: { kind: 'device', device: main, path: '/brightness' },
    operator: 'gt',
    value: 5,
    future: 'kept',
  };
  const initial = {
    id,
    name: 'Nested condition review',
    enabled: false,
    semantics_version: 2,
    revision: 1,
    rules: [],
    actions: [],
    definition_v2: {
      triggers: [
        {
          id: 'held',
          kind: 'predicate_for',
          predicate: { ...comparison, value: 2 },
          duration_ms: 60000,
        },
      ],
      condition: {
        kind: 'all',
        future: 'root-kept',
        conditions: [
          comparison,
          {
            kind: 'any',
            conditions: [
              { kind: 'not', condition: { kind: 'literal', value: true } },
              {
                kind: 'group',
                group_id: 'living_room',
                quantifier: 'all',
                power: true,
                scene: 'normal',
              },
            ],
          },
          {
            kind: 'comparison',
            source: { kind: 'helper', helper },
            operator: 'eq',
            value: false,
          },
          {
            kind: 'comparison',
            source: { kind: 'future', payload: { opaque: false } },
            operator: 'eq',
            value: 1,
          },
        ],
      },
      execution: { mode: 'queued', max_actions: 32 },
      program: {
        kind: 'native',
        steps: [
          {
            id: 'branching',
            action: 'choose',
            branches: [
              {
                id: 'first',
                condition: { ...comparison, value: 3 },
                steps: [
                  {
                    id: 'nested-cancel',
                    action: 'cancel_timer',
                    timer: 'test',
                  },
                ],
              },
            ],
          },
          { id: 'cancel', action: 'cancel_timer', timer: 'test' },
        ],
      },
    },
  };
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initial),
  });
  if (!created.ok) throw Error('Fixture create failed');
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const pause = () => new Promise((r) => setTimeout(r, 150));
  const until = async (expr, name) => {
    for (let i = 0; i < 80; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(name);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const labeled = (label, tag = '', scope = 'document') =>
    `${scope}?.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)})`;
  const click = async (expr) => {
    const point = await evaluate(
      `(()=>{const e=${expr}; if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await pause();
  };
  const key = async (key, code, modifiers = 0) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      windowsVirtualKeyCode: code,
      modifiers,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      windowsVirtualKeyCode: code,
      modifiers,
    });
  };
  const type = async (label, value, scope = 'document') => {
    await click(labeled(label, 'input', scope));
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (value) await cdp.send('Input.insertText', { text: value });
    await pause();
  };
  const pick = async (label, text, scope = 'document') => {
    await click(labeled(label, 'button', scope));
    await until(`!!document.querySelector('[role=option]')`, 'Type options');
    const index = await evaluate(
      `[...document.querySelectorAll('[role=option]')].findIndex(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
    if (index < 0) throw Error('Missing option ' + text);
    await key('Home', 36);
    await pause();
    for (let i = 0; i < index; i++) {
      await key('ArrowDown', 40);
      await pause();
    }
    await key('Enter', 13);
    await until(
      "!document.querySelector('[role=listbox]')",
      'Selection closed',
    );
  };
  const goto = async (route) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(route)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const checks = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const read = async () =>
    (await (await fetch(base)).json()).data.find((row) => row.id === id);
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === base + '/' + id && request.method === 'PUT') writes++;
  });
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/routine-conditions-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Fixture cleanup failed');
    await fetch(origin + '/api/v1/config/helpers/' + helper, {
      method: 'DELETE',
    });
  };
  const assert = (name, condition) => {
    if (!condition) throw Error(name);
    checks.push({ name, passed: true });
  };
  const save = async () => {
    await click(
      '(' + button('Save changes') + ' || ' + button('Retry save') + ')',
    );
    await until(`!${button('Discard')}`, 'Source saved');
  };
  const reload = async () => {
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until(`!!${labeled('Trigger type', 'button')}`, 'Source reloaded');
  };

  const node = (id) =>
    'document.querySelector(\'[data-node-id="' + id + '"]\')';
  const condition = (path) =>
    'document.querySelector(' +
    JSON.stringify('[data-condition-path="' + path + '"]') +
    ')';
  const root = condition('condition'),
    first = condition('condition/all/conditions/0');
  const group = condition('condition/all/conditions/1/any/conditions/1');
  const field = (scope) => labeled('Expected value', 'input', scope);
  const cmd = async (expr, text) => {
    await click(expr);
    await until("!!document.querySelector('[cmdk-item]')", 'Picker ready');
    await click(
      "[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes(" +
        JSON.stringify(text) +
        '))',
    );
  };
  const remove = async (scope, label = 'condition') => {
    await click(labeled('Actions for ' + label, 'button', scope));
    await until("!!document.querySelector('[role=menuitem]')", 'Actions open');
    await click(
      "[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()==='Remove')",
    );
  };
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until('!!' + field(first), 'Condition editor ready');
    await check(
      'Unsupported source data remains visible without crashing known siblings',
      "document.body.textContent.includes('Unsupported condition') && document.body.textContent.includes('opaque')",
    );
    assert(
      'Inspecting unsupported data does not write or normalize it',
      writes === 0 &&
        (await read()).definition_v2.condition.conditions[3].source.kind ===
          'future',
    );
    await remove(
      "[...document.querySelectorAll('.flow-condition-node')].find(e=>e.querySelector('header').textContent.includes('Unsupported condition'))",
    );
    await type('Expected value', '', first);
    await click(
      '(' + button('Save changes') + ' || ' + button('Retry save') + ')',
    );
    await check(
      'Incomplete expected number stays blank and receives focus',
      field(first) + ".value==='' && document.activeElement===" + field(first),
    );
    await click(
      labeled('Move condition down', 'button', first + ".closest('article')"),
    );
    const moved = condition('condition/all/conditions/1');
    await check(
      'Moving a condition moves its unfinished numeric draft',
      field(moved) +
        ".value==='' && " +
        condition('condition/all/conditions/0') +
        ".closest('article').textContent.includes('Any condition')",
    );
    await click(
      labeled('Move condition up', 'button', moved + ".closest('article')"),
    );
    await goto('/config/routines');
    await goto(path);
    await until('!!' + field(first), 'Draft returned');
    await check(
      'Nested numeric drafts survive navigation',
      field(first) + ".value===''",
    );
    await type('Expected value', '0', first);
    await pick('Value type', 'Text', first);
    await type('Expected value', 'night', first);
    await pick('Value type', 'Number', first);
    await check(
      'Value type switches restore zero instead of a default',
      field(first) + ".value==='0'",
    );
    await pick('Comparison operator', 'Exists', first);
    await check(
      'Valueless operators hide expected-value controls and shortcuts',
      '!' +
        field(first) +
        ' && !' +
        first +
        ".textContent.includes('Use as expected value')",
    );
    await save();
    assert(
      'Exists saves with no comparison value',
      !Object.hasOwn(
        (await read()).definition_v2.condition.conditions[0],
        'value',
      ),
    );
    await pick('Comparison operator', 'Equals', first);
    await pick('Value type', 'Number', first);
    await type('Expected value', '12.5', first);
    await pick('Comparison operator', 'Truthy', first);
    await pick('Comparison operator', 'Equals', first);
    await check(
      'Operator switches restore the previous expected value',
      field(first) + ".value==='12.5'",
    );
    await pick(
      'Condition type',
      'Always / never',
      first + ".closest('article')",
    );
    await pick(
      'Condition type',
      'Value check',
      condition('condition/all/conditions/0') + ".closest('article')",
    );
    await check(
      'Changing a condition type retains its previous fields',
      field(first) + ".value==='12.5'",
    );
    await pick('Condition type', 'Any condition holds', root);
    await pick('Condition type', 'All conditions hold', root);
    await check(
      'All/Any switches retain the complete nested subtree',
      field(first) + ".value==='12.5' && !!" + group,
    );
    await cmd(
      labeled('Choose a device, helper or source…', 'button', first),
      'Condition helper',
    );
    await cmd(
      labeled('Choose a device, helper or source…', 'button', first),
      'Circadian rhythm',
    );
    await cmd(
      labeled('Choose a field…', 'button', first),
      'Enter a custom path',
    );
    await type('Custom value path', '/color/ct', first);
    await cmd(
      labeled('Choose a device, helper or source…', 'button', first),
      'living_room_lamp',
    );
    await check(
      'Returning to a device restores its field',
      first + ".textContent.includes('brightness')",
    );
    await cmd(
      labeled('Choose a device, helper or source…', 'button', first),
      'Circadian rhythm',
    );
    await check(
      'Returning to a computed source restores its custom path',
      first +
        ".textContent.includes('/color/ct') || " +
        labeled('Custom value path', 'input', first) +
        "?.value==='/color/ct'",
    );
    await pick(
      'Condition result',
      'Always false',
      condition('condition/all/conditions/1/any/conditions/0/not/condition'),
    );
    await pick('Group power', 'Off', group);
    await pick('Group scene', 'Night', group);
    for (const [label, quantifier] of [
      ['Any member', 'any'],
      ['No member', 'none'],
      ['Partially (a mix)', 'partial'],
      ['All members', 'all'],
    ]) {
      await pick('Group match', label, group);
      await save();
      assert(
        'Group quantifier persists: ' + quantifier,
        (await read()).definition_v2.condition.conditions[1].conditions[1]
          .quantifier === quantifier,
      );
    }
    let saved = (await read()).definition_v2.condition;
    assert(
      'Nested All/Any/Not, false and group fields persist without losing extensions',
      saved.future === 'root-kept' &&
        saved.conditions[0].future === 'kept' &&
        saved.conditions[1].conditions[0].condition.value === false &&
        saved.conditions[1].conditions[1].power === false &&
        saved.conditions[1].conditions[1].scene === 'night' &&
        saved.conditions[2].value === false,
    );
    await pick('Group scene', 'Any scene', group);
    await save();
    assert(
      'Optional group scene clears without changing power',
      !Object.hasOwn(
        (await read()).definition_v2.condition.conditions[1].conditions[1],
        'scene',
      ),
    );
    // Every operator is explicitly changed and saved, including both value-free operators.
    for (const [code, label] of [
      ['ne', 'Not equal'],
      ['gt', 'Greater than'],
      ['gte', 'Greater than or equal'],
      ['lt', 'Less than'],
      ['lte', 'Less than or equal'],
      ['contains', 'Contains'],
      ['starts_with', 'Starts with'],
      ['regex', 'Regex match'],
      ['truthy', 'Truthy'],
    ]) {
      await pick('Comparison operator', label, first);
      if (['contains', 'starts_with', 'regex'].includes(code)) {
        await pick('Value type', 'Text', first);
        await type(
          'Expected value',
          code === 'regex' ? '^night$' : 'night',
          first,
        );
      }
      await save();
      assert(
        'Comparison operator persists: ' + code,
        (await read()).definition_v2.condition.conditions[0].operator === code,
      );
    }
    await pick('Comparison operator', 'Equals', first);
    await pick('Value type', 'JSON', first);
    await click(
      first + ".querySelector('.condition-value button.justify-start')",
    );
    await until(
      '!!document.querySelector(\'textarea[aria-label="JSON value"]\')',
      'JSON editor',
    );
    await click(labeled('JSON value', 'textarea'));
    await key('a', 65, 2);
    await cdp.send('Input.insertText', { text: 'null' });
    await check(
      'Top-level null explains the API restriction before applying',
      button('Apply value') +
        ".disabled && document.querySelector('[role=dialog]').textContent.includes('other than null')",
    );
    await key('a', 65, 2);
    await cdp.send('Input.insertText', { text: '{"future":[null,false,0]}' });
    await click(button('Apply value'));
    await save();
    assert(
      'Structured values preserve nested null, false and zero',
      JSON.stringify(
        (await read()).definition_v2.condition.conditions[0].value,
      ) === '{"future":[null,false,0]}',
    );
    await type(
      'Expected value',
      '-',
      condition('step/branching/choose/branch/first/condition'),
    );
    await remove(node('branching'), 'branching');
    await save();
    assert(
      'Removing a branch action clears its incomplete condition drafts',
      (await read()).definition_v2.program.steps.length === 1,
    );
    await reload();
    await check(
      'Nested conditions remain editable after reload',
      '!!' + group + ' && ' + first + ".textContent.includes('future')",
    );
    await click(labeled('Condition type', 'button', root));
    await key('Escape', 27);
    await shot('nested');
    await click(labeled('Group match', 'button', group));
    await key('Escape', 27);
    await shot('group');
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}
