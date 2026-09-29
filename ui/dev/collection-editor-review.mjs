import { writeFile } from 'node:fs/promises';

// Own records only, on the explicitly marked isolated fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const base = origin + '/api/v1/config/integrations';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = `collection-review-${width}-${Date.now()}`;
  const path = '/config/integrations/' + id;
  const initial = {
    id,
    plugin: 'dummy',
    enabled: false,
    config: {
      devices: {},
      amount: 12,
      sequence: [10, 20],
      nullable: null,
      nested: { 'a/b~c': [false, 0, null] },
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
  const labeled = (label, tag = '') =>
    `document.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)})`;
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
  const type = async (label, value) => {
    await click(labeled(label, 'input'));
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (value) await cdp.send('Input.insertText', { text: value });
    await pause();
  };
  const pick = async (label, text) => {
    await click(labeled(label + ' value type', 'button'));
    await until(`!!document.querySelector('[role=option]')`, 'Type options');
    await click(
      `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
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
      `/tmp/collection-editor-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Fixture cleanup failed');
  };
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(`!!${labeled('amount', 'input')}`, 'Extension fields');
    await type('amount', '');
    await check(
      'Clearing a number keeps its input and marks the unfinished draft',
      `${labeled('amount', 'input')}?.value==='' && ${labeled('amount', 'input')}?.getAttribute('aria-invalid')==='true' && !!${button('Discard')}`,
    );
    await click(button('Retry save'));
    await check(
      'Validation focuses the number without duplicating the save error',
      `document.activeElement===${labeled('amount', 'input')} && document.querySelectorAll('.settings-save-errors p').length===1`,
    );
    if (writes !== 0 || (await read()).config.amount !== 12)
      throw Error('Invalid value was saved');
    checks.push({
      name: 'Unfinished number issues no API write',
      passed: true,
    });
    await type('amount', '-');
    await goto('/config/integrations');
    await goto(path);
    await until(`!!${labeled('amount', 'input')}`, 'Returned editor');
    await check(
      'Unfinished number survives related-page navigation',
      `${labeled('amount', 'input')}.value==='-'`,
    );
    await shot('invalid');
    await type('amount', '-0.25');
    await click(button('Save changes'));
    await until(`!${button('Save changes')}`, 'Decimal saved');
    if ((await read()).config.amount !== -0.25) throw Error('Decimal lost');
    checks.push({ name: 'A negative decimal saves as a number', passed: true });
    await type('amount', '1e');
    await check(
      'An unfinished exponent stays editable',
      `${labeled('amount', 'input')}.value==='1e' && ${labeled('amount', 'input')}.getAttribute('aria-invalid')==='true'`,
    );
    await cdp.send('Input.insertText', { text: '3' });
    await pause();
    await click(button('Save changes'));
    await until(`!${button('Save changes')}`, 'Exponent saved');
    if ((await read()).config.amount !== 1000) throw Error('Exponent lost');
    checks.push({
      name: 'Completed exponent saves its numeric value',
      passed: true,
    });
    await pick('sequence 1', 'Text');
    await pick('sequence 2', 'Text');
    const list = `${labeled('sequence value type', 'button')}.closest('.json-value-editor')`;
    await click(`${list}.querySelector('[aria-label="Move later item 1"]')`);
    await pick('sequence 1', 'Number');
    await pick('sequence 2', 'Number');
    await check(
      'Type variants follow reordered items',
      `${labeled('sequence 1', 'input')}.value==='20' && ${labeled('sequence 2', 'input')}.value==='10'`,
    );
    await type('sequence 1', '-');
    await click(`${list}.querySelector('[aria-label="Move later item 1"]')`);
    await check(
      'Unfinished inputs follow reordered items',
      `${labeled('sequence 2', 'input')}.value==='-' && ${labeled('sequence 1', 'input')}.value==='10'`,
    );
    await click(`${list}.querySelector('[aria-label="Remove item 2"]')`);
    await click(
      `[...${list}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Add item')`,
    );
    await pick('sequence 2', 'Number');
    await check(
      'Removing an item clears its raw input and type cache before a new item is added',
      `${labeled('sequence 2', 'input')}.value==='0' && !document.querySelector('input[aria-invalid=true]')`,
    );
    await click(button('Save changes'));
    await until(`!${button('Save changes')}`, 'List saved');
    const saved = await read();
    if (
      JSON.stringify(saved.config.sequence) !== '[10,0]' ||
      saved.config.nullable !== null ||
      JSON.stringify(saved.config.nested) !==
        JSON.stringify(initial.config.nested)
    )
      throw Error('Round trip lost collection or unknown values');
    checks.push({
      name: 'Saved collection preserves zero, false, null, escaped keys and unrelated nested data',
      passed: true,
    });
    await pick('amount', 'Text');
    await click(labeled('Remove amount', 'button'));
    await type('New Additional configuration field name', 'amount');
    await click(
      `[...document.querySelectorAll('#additional > div button,#additional button')].find(b=>b.textContent.trim()==='Add field' && !b.disabled)`,
    );
    await pick('amount', 'Number');
    await check(
      'Deleting and recreating a field cannot restore its old type cache',
      `${labeled('amount', 'input')}.value==='0'`,
    );
    await click(button('Discard'));
    await check(
      'Discard restores saved values and clears numeric errors',
      `${labeled('amount', 'input')}.value==='1000' && !document.querySelector('input[aria-invalid=true]')`,
    );
    await click(labeled('sequence 1', 'input'));
    await check(
      'Collection controls fit the viewport',
      `![...document.querySelectorAll('#additional input,#additional button')].some(e=>e.getBoundingClientRect().right>innerWidth+1)`,
    );
    await shot('saved');
    return { passed: true, checks };
  } finally {
    await cleanup();
  }
}
