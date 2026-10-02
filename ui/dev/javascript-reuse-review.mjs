// Native pointer/keyboard authoring review on an isolated fixture.
// Worker execution and persistence are covered by the server tests.
export default async function (cdp, { width, url }) {
  cdp.on('Runtime.consoleAPICalled', (event) => {
    if (event.type === 'error')
      console.log(event.args.map((item) => item.description ?? item.value));
  });
  const origin = 'http://127.0.0.1:3026';
  const marker = await fetch(origin + '/api/v1/config/blocks');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
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
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  const until = async (expression, name) => {
    for (let n = 0; n < 100; n++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    console.log(
      await evaluate(
        "({text:document.body.innerText.slice(-8000),labels:[...document.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label'))})",
      ),
    );
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(
      '/tmp/javascript-review-failure.png',
      Buffer.from(shot.data, 'base64'),
    );
    throw Error(name);
  };
  const checks = [];
  const check = async (name, expression) => {
    if (!(await evaluate(expression))) throw Error(name);
    checks.push(name);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const labeled = (label) =>
    `document.querySelector(${JSON.stringify('[aria-label="' + label + '"]')})`;
  const click = async (expression) => {
    const p = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await pause();
  };
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        modifiers,
      });
  };
  const type = async (label, text) => {
    await click(labeled(label));
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (text) await cdp.send('Input.insertText', { text });
    await pause();
  };
  const pick = async (label, text) => {
    await click(labeled(label));
    await until("!!document.querySelector('[role=option]')", 'Options open');
    await click(
      `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const id = 'reuse-review-' + width;
  const script = {
    api_version: 1,
    source_body: 'return inputs.n * 2;',
    functions: [],
    declarations: [],
    limits_profile: 'default',
  };
  const block = {
    id,
    name: 'Double value',
    kind: 'function',
    revision: 1,
    description: 'Reusable calculation',
    inputs: { n: { label: 'Number', kind: { kind: 'number' }, default: 3 } },
    body: { kind: 'javascript', spec: script, output: { kind: 'number' } },
  };
  const created = await fetch(origin + '/api/v1/config/blocks/' + id, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(block),
  });
  if (!created.ok) throw Error('Fixture create failed');
  let previewRequest;
  // The fixture has no JavaScript engine. Stub only the preview response UI.
  await cdp.send('Fetch.enable', {
    patterns: [
      {
        urlPattern: origin + '/api/v1/config/reuse-preview',
        requestStage: 'Request',
      },
    ],
  });
  cdp.on('Fetch.requestPaused', async (event) => {
    previewRequest = JSON.parse(event.request.postData);
    await cdp.send('Fetch.fulfillRequest', {
      requestId: event.requestId,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(
        JSON.stringify({
          success: true,
          data:
            previewRequest.kind === 'helper'
              ? { kind: 'helper', value: false }
              : { kind: 'function', value: 6 },
        }),
      ).toString('base64'),
    });
  });
  await cdp.send('Page.navigate', { url: origin + '/config/blocks/' + id });
  await until(`!!${labeled('Function output type')}`, 'Function editor');
  await until("!!document.querySelector('.monaco-editor')", 'Source editor');
  await check(
    'Function output and typed arguments are visible',
    `!!${labeled('Input type n')} && document.body.textContent.includes('Try this block')`,
  );
  await click(button('Preview draft'));
  await until(
    "document.body.textContent.includes('Preview of this draft')",
    'Preview rendered',
  );
  if (previewRequest?.block.id !== id || previewRequest.kind !== 'block')
    throw Error('Wrong preview request');
  await check(
    'Preview response is rendered',
    "document.querySelector('[aria-label=\"Function result\"]')?.textContent.includes('6') && !document.querySelector('[aria-label=\"Preview result\"] details[open]')",
  );
  await check(
    'Function editor fits the viewport',
    'document.documentElement.scrollWidth<=innerWidth+1',
  );
  const { writeFile } = await import('node:fs/promises');
  await click(labeled('Function output type'));
  await key('Escape', 27);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    '/tmp/javascript-function-' + width + '.png',
    Buffer.from(shot.data, 'base64'),
  );
  await goto('/config/helpers/new');
  await until(`!!${labeled('Helper value source')}`, 'Helper editor');
  await pick(
    'Helper value source',
    'Computed value — read-only JavaScript calculation',
  );
  await until(`!!${labeled('Helper refresh seconds')}`, 'Computed controls');
  await type('Helper refresh seconds', '15');
  await pick(
    'Helper value source',
    'Manual value — changed by controls or routines',
  );
  await pick(
    'Helper value source',
    'Computed value — read-only JavaScript calculation',
  );
  await check(
    'Mode changes preserve the calculation draft',
    `${labeled('Helper refresh seconds')}.value==='15'`,
  );
  await type('Helper refresh seconds', '');
  await check(
    'Incomplete refresh input is preserved with validation',
    `${labeled('Helper refresh seconds')}.value==='' && ${labeled('Helper refresh seconds')}.getAttribute('aria-invalid')==='true'`,
  );
  await type('Helper refresh seconds', '20');
  await check(
    'Computed dependencies and preview are visible',
    "document.body.textContent.includes('Helper dependencies') && document.body.textContent.includes('Shared functions') && document.body.textContent.includes('Preview draft')",
  );
  await check(
    'Helper editor fits the viewport',
    'document.documentElement.scrollWidth<=innerWidth+1',
  );
  await click(button('Preview draft'));
  await until(
    "document.body.textContent.includes('Preview of this draft')",
    'Helper preview UI',
  );
  if (previewRequest?.helper.compute.refresh_ms !== 20000)
    throw Error('Incorrect serialized cadence');
  const helperShot = await cdp.send('Page.captureScreenshot', {
    format: 'png',
  });
  await writeFile(
    '/tmp/javascript-helper-' + width + '.png',
    Buffer.from(helperShot.data, 'base64'),
  );
  await cdp.send('Fetch.disable');
  await fetch(origin + '/api/v1/config/blocks/' + id, { method: 'DELETE' });
  return {
    passed: true,
    width,
    checks,
    preview: 'UI stub; real worker semantics verified by server tests',
  };
}
