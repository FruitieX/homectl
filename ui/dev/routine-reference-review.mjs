import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/',
    id = 'reference-review-' + width,
    helper = id + '-helper';
  const marker = await fetch(base + 'routines');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  if ((await marker.json()).data.some((r) => r.id === id))
    throw Error('Review ID exists');
  const sceneCatalog = await (await fetch(base + 'scenes')).json();
  const missingDevice = { integration_id: 'missing', device_id: 'lamp' };
  const definition = {
    triggers: [{ kind: 'manual', id: 'manual' }],
    condition: {
      kind: 'comparison',
      source: { kind: 'helper', helper: 'gone-condition-helper' },
      operator: 'eq',
      value: false,
    },
    program: {
      kind: 'native',
      steps: [
        {
          id: 'mapped',
          action: 'activate_scene',
          select: {
            kind: 'helper_enum',
            helper: 'gone-selection-helper',
            mapping: { old: 'gone-scene', day: 'normal' },
            fallback_scene_id: 'gone-fallback',
            future: 'keep',
          },
          targets: {
            devices: [missingDevice],
            groups: ['gone-room'],
            future: 'keep',
          },
          use_scene_transition: true,
        },
        {
          id: 'writer',
          action: 'set_helper',
          helper: 'gone-value-helper',
          value: { retained: [false, null, 0] },
        },
        {
          id: 'invoke',
          action: 'invoke_routine',
          routine_id: 'gone-routine',
          mode: 'fire_and_forget',
        },
      ],
    },
  };
  const request = async (path, method, body) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw Error('Fixture ' + r.status);
    return r.json();
  };
  const saved = async () =>
    (await (await fetch(base + 'routines')).json()).data.find(
      (r) => r.id === id,
    );
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
  const until = async (expr, msg) => {
    for (let i = 0; i < 140; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(msg);
  };
  const checks = [],
    exceptions = [];
  let failCatalog = true,
    writes = 0;
  const check = async (name, value) => {
    if (!value) throw Error(name);
    checks.push({ name, passed: true });
  };
  const button = (text, scope = 'document') =>
    '[...' +
    scope +
    ".querySelectorAll('button')].find(e=>e.textContent.trim()===" +
    JSON.stringify(text) +
    ')';
  const node = (id) =>
    "document.querySelector('[data-node-id=" + JSON.stringify(id) + "]')";
  const field = "document.querySelector('[data-field=name]')";
  const label = (text, scope = 'document') =>
    scope + ".querySelector('[aria-label=" + JSON.stringify(text) + "]')";
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        modifiers,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
      });
    await pause();
  };
  const activate = async (expr) => {
    await evaluate(
      expr + ".scrollIntoView({block:'center'});" + expr + '.focus()',
    );
    await key('Enter', 13);
  };
  const type = async (expr, text) => {
    await evaluate(expr + '.focus()');
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (text) await cdp.send('Input.insertText', { text });
    await pause();
  };
  const pick = async (expr, query) => {
    await activate(expr);
    await until("!!document.querySelector('[cmdk-input]')", 'Picker search');
    await type("document.querySelector('[cmdk-input]')", query);
    const match =
      "[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes(" +
      JSON.stringify(query) +
      ")&&e.textContent!=='Clear selection')";
    await until('!!' + match, 'Picker match');
    // cmdk selects the first matching option; Clear selection precedes it.
    await key('End', 35);
    await key('Enter', 13);
    await until(
      expr + ".getAttribute('aria-expanded')==='false'",
      'Picker closes',
    );
    await check(
      'Selecting ' + query + ' restores picker focus',
      await evaluate('document.activeElement===' + expr),
    );
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      '/tmp/routine-reference-' + width + '-' + name + '.png',
      Buffer.from(data, 'base64'),
    );
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const reload = async () => {
    let done;
    const p = new Promise((r) => (done = r));
    cdp.on('Page.loadEventFired', () => done());
    await cdp.send('Page.reload');
    await p;
    await until('!!' + field, 'Reload');
  };
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method === 'PUT' && request.url === base + 'routines/' + id)
      writes++;
  });
  await request('helpers/' + helper, 'PUT', {
    id: helper,
    name: 'Reference modes',
    kind: { kind: 'enum', options: ['day', 'night'] },
    initial_value: 'day',
    persistence: 'durable',
    hidden: false,
    create_only: true,
  });
  await request('routines', 'POST', {
    id,
    name: 'Routine reference review',
    enabled: false,
    semantics_version: 2,
    revision: 1,
    rules: [],
    actions: [],
    definition_v2: definition,
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: base + 'scenes' }],
  });
  cdp.on('Fetch.requestPaused', ({ requestId }) => {
    void cdp
      .send('Fetch.fulfillRequest', {
        requestId,
        responseCode: failCatalog ? 503 : 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify(
            failCatalog
              ? { success: false, error: 'Fixture scene catalog unavailable' }
              : sceneCatalog,
          ),
        ).toString('base64'),
      })
      .catch((e) => exceptions.push(e.message));
  });
  try {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdp.send('Page.navigate', { url: origin + '/config/routines/' + id });
    await until(
      '!!' + button('Retry reference lists'),
      'Catalog recovery warning',
    );
    await type(field, 'Draft retained during catalog recovery');
    await shot('catalog-failed');
    await check(
      'Read failure keeps the saved definition',
      same((await saved()).definition_v2, definition) && writes === 0,
    );
    failCatalog = false;
    await activate(button('Retry reference lists'));
    await until('!' + button('Retry reference lists'), 'Catalog recovered');
    await check(
      'Catalog retry retains edited name',
      await evaluate(
        field + ".value==='Draft retained during catalog recovery'",
      ),
    );
    const mapNode = node('mapped'),
      writer = node('writer');
    await check(
      'Missing helper, scene and fallback stay identifiable',
      await evaluate(
        mapNode +
          ".textContent.includes('gone-selection-helper (unavailable)')&&" +
          mapNode +
          ".textContent.includes('gone-scene (unavailable)')&&" +
          mapNode +
          ".textContent.includes('gone-fallback (unavailable)')",
      ),
    );
    await check(
      'Missing helper keeps its structured value visible',
      await evaluate(
        writer +
          ".textContent.includes('retained')&&" +
          writer +
          ".textContent.includes('Select an available helper')",
      ),
    );
    const helperPicker = label('Scene selection helper', mapNode);
    await activate(helperPicker);
    await until("!!document.querySelector('[cmdk-input]')", 'Helper search');
    await type("document.querySelector('[cmdk-input]')", 'no-match-query');
    await key('Escape', 27);
    await check(
      'Escape closes picker and restores trigger',
      await evaluate(
        helperPicker +
          ".getAttribute('aria-expanded')==='false'&&document.activeElement===" +
          helperPicker,
      ),
    );
    await activate(helperPicker);
    await until("!!document.querySelector('[cmdk-input]')", 'Reopened helper');
    await check(
      'Reopening clears the previous search',
      await evaluate("document.querySelector('[cmdk-input]').value===''"),
    );
    await key('Escape', 27);
    await pick(helperPicker, 'Reference modes');
    await check(
      'Choosing a helper retains obsolete mappings for repair',
      await evaluate(
        mapNode +
          ".textContent.includes('old')&&" +
          mapNode +
          ".textContent.includes('Not in the helper')",
      ),
    );
    await activate(button('Discard'));
    await check(
      'Discard restores missing references and structured helper values',
      await evaluate(
        node('mapped') +
          ".textContent.includes('gone-selection-helper')&&" +
          node('writer') +
          ".textContent.includes('retained')",
      ),
    );
    await type(field, 'Saved while references unavailable');
    await activate(button('Save changes'));
    await until('!' + button('Save changes'), 'Saved unchanged references');
    await reload();
    await check(
      'Name-only Save/reload preserves exact unavailable definition',
      same((await saved()).definition_v2, definition) && writes === 1,
    );
    await shot('retained');
    await pick(helperPicker, 'Reference modes');
    await pick(label('Scene for old', mapNode), 'Normal');
    await activate(label('Fallback scene', mapNode));
    await until("!!document.querySelector('[cmdk-input]')", 'Fallback choices');
    await key('Home', 36);
    await key('Enter', 13);
    await until(
      label('Fallback scene', mapNode) +
        ".getAttribute('aria-expanded')==='false'",
      'Fallback cleared',
    );
    await activate(mapNode + ".querySelector('summary')");
    await check(
      'Unavailable scope members remain removable',
      await evaluate(
        mapNode +
          ".textContent.includes('missing/lamp (unavailable)')&&" +
          mapNode +
          ".textContent.includes('gone-room (unavailable)')",
      ),
    );
    await activate(label('Remove missing/lamp (unavailable)', mapNode));
    await activate(label('Remove gone-room (unavailable)', mapNode));
    await pick(label('Helper', writer), 'Entryway cooldown');
    const condition = "document.querySelector('.condition-source')";
    const conditionPicker = label(
      'Choose a device, helper or source…',
      condition,
    );
    await activate(conditionPicker);
    await until(
      "!!document.querySelector('[cmdk-input]')",
      'Condition choices',
    );
    await check(
      'Required value source does not offer a no-op Clear selection',
      await evaluate(
        "![...document.querySelectorAll('[cmdk-item]')].some(e=>e.textContent==='Clear selection')",
      ),
    );
    await key('Escape', 27);
    await pick(conditionPicker, 'Entryway cooldown');
    await pick(label('Select routine...', node('invoke')), 'Kitchen daytime');
    await check(
      'Repair edits are staged before Save',
      writes === 1 && same((await saved()).definition_v2, definition),
    );
    const repaired = structuredClone(definition);
    repaired.condition.source.helper = 'entryway_cooldown';
    const [mappedStep, writerStep, invokeStep] = repaired.program.steps;
    mappedStep.select.helper = helper;
    mappedStep.select.mapping.old = 'normal';
    delete mappedStep.select.fallback_scene_id;
    mappedStep.targets.devices = [];
    mappedStep.targets.groups = [];
    writerStep.helper = 'entryway_cooldown';
    writerStep.value = false;
    invokeStep.routine_id = 'kitchen_day';
    await activate(button('Save changes'));
    await until('!' + button('Save changes'), 'Saved repaired references');
    await reload();
    await check(
      'Save/reload persists every repaired reference and preserved extension',
      same((await saved()).definition_v2, repaired) && writes === 2,
    );
    await shot('repaired');
    await check('No page exceptions', exceptions.length === 0);
    return {
      passed: true,
      checks,
      scope:
        'Temporary local routine, intercepted scene-catalog failure; no routine execution',
    };
  } catch (e) {
    await shot('failure');
    throw e;
  } finally {
    await cdp.send('Fetch.disable');
    await request('routines/' + id, 'DELETE');
    await request('helpers/' + helper, 'DELETE');
  }
}
