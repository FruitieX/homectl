// Whole-program v2 scripts remain convertible without an early write.
export default async function (cdp, { url }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Fixture required');
  const base = 'http://127.0.0.1:3021/api/v1/config/routines';
  const response = await fetch(base);
  if (response.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Fixture required');
  const row = structuredClone(
    (await response.json()).data.find((r) => r.id === 'motion_on'),
  );
  row.id = `conversion_${Date.now()}`;
  row.name = 'Script conversion review';
  row.enabled = false;
  const spec = {
    api_version: 1,
    source_body: 'return {actions: [], next_state: {count: 1}};',
    declarations: [
      {
        kind: 'device',
        device: {
          integration_id: 'zigbee2mqtt',
          device_id: 'living_room_lamp',
        },
      },
    ],
    limits_profile: 'default',
  };
  row.definition_v2.program = {
    kind: 'script',
    spec,
    future: { preserve: true },
  };
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(row),
  });
  if (!created.ok) throw Error(await created.text());
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const until = async (expression) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw Error('Timed out: ' + expression);
  };
  const click = (text) =>
    evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)}).click()`,
    );
  const current = async () =>
    (await (await fetch(base)).json()).data.find((r) => r.id === row.id);
  try {
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:3021/config/routines/${row.id}`,
    });
    await until(
      `document.body.textContent.includes('Use as an action in the flow')`,
    );
    await click('Use as an action in the flow');
    await until(`!!document.querySelector('#then [data-node-id]')`);
    const id = await evaluate(
      `document.querySelector('#then [data-node-id]').dataset.nodeId`,
    );
    if ((await current()).definition_v2.program.kind !== 'script')
      throw Error('Converted before save');
    await click('Discard');
    await until(
      `document.body.textContent.includes('Use as an action in the flow')`,
    );
    await click('Use as an action in the flow');
    await until(`!!document.querySelector('#then [data-node-id]')`);
    await click('Save changes');
    await until(
      `![...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Save changes')`,
    );
    const program = (await current()).definition_v2.program;
    if (
      program.kind !== 'native' ||
      program.steps.length !== 1 ||
      program.future?.preserve !== true ||
      program.steps[0].action !== 'run_script' ||
      !program.steps[0].id ||
      JSON.stringify(program.steps[0].spec) !== JSON.stringify(spec)
    )
      throw Error('Conversion lost script details');
    return {
      passed: true,
      checks: [
        'Whole-program script converts into a native action',
        'Conversion creates a stable action ID',
        'No write before Save',
        'Discard restores whole-program script',
        'Save preserves complete script and declarations',
        'Conversion preserves program extension fields',
      ],
      firstDraftId: id,
    };
  } finally {
    await fetch(`${base}/${row.id}`, { method: 'DELETE' });
  }
}
