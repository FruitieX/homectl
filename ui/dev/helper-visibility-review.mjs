import { writeFile } from 'node:fs/promises';
export default async function (cdp, { url, width }) {
  const origin = 'http://127.0.0.1:3021',
    api = origin + '/api/v1/config/',
    dash = api + 'dashboard';
  const marker = await fetch(api + 'helpers');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked isolated fixture required');
  const id = `visibility-${width}-${Date.now()}`,
    helperIds = [id, id + '-hidden', id + '-visible'],
    widgetIds = [];
  const request = async (path, method, body) => {
    const r = await fetch(api + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await r.json();
    if (!r.ok || !result.success)
      throw Error('Fixture ' + JSON.stringify(result));
    return result.data;
  };
  for (const [index, key] of helperIds.entries())
    await request('helpers/' + key, 'PUT', {
      id: key,
      name: [
        'Visibility target',
        'Visibility other hidden',
        'Visibility visible',
      ][index],
      kind: { kind: 'enum', options: ['home', 'away'] },
      initial_value: 'home',
      persistence: 'durable',
      hidden: index === 1,
    });
  const layout = await request('dashboard/layouts', 'POST', {
    id: 0,
    name: 'Visibility second layout',
    is_default: false,
  });
  for (const [index, layoutId] of [1, layout.id].entries()) {
    const widget = await request('dashboard/widgets', 'POST', {
      id: 0,
      layout_id: layoutId,
      widget_type: 'helper_mode',
      config:
        index === 0
          ? { title: 'Visibility flat widget', helperId: id }
          : {
              title: 'Visibility nested widget',
              options: { helperId: id, future: false },
            },
      grid_x: 0,
      grid_y: 0,
      grid_w: 4,
      grid_h: 3,
      sort_order: 99,
    });
    widgetIds.push(widget.id);
  }
  let failWidgets = true,
    failHelpers = false,
    writes = 0,
    commands = 0;
  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method !== 'GET' && request.url.startsWith(api)) writes++;
    if (
      /\/helpers\/[^/]+\/value$/.test(request.url) &&
      request.method !== 'GET'
    )
      commands++;
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    try {
      const v = JSON.parse(response.payloadData);
      if (v.DeviceCommand || v.SceneCommand || v.Action) commands++;
    } catch {}
  });
  cdp.on('Fetch.requestPaused', async (e) => {
    const fail =
      e.request.method === 'GET' &&
      ((e.request.url === dash + '/layouts/' + layout.id + '/widgets' &&
        failWidgets) ||
        (e.request.url === api + 'helpers' && failHelpers));
    if (!fail)
      return cdp.send('Fetch.continueRequest', { requestId: e.requestId });
    await cdp.send('Fetch.fulfillRequest', {
      requestId: e.requestId,
      responseCode: 503,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(
        JSON.stringify({ success: false, error: 'Fixture catalog failure' }),
      ).toString('base64'),
    });
  });
  await cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: dash + '/layouts/' + layout.id + '/widgets' },
      { urlPattern: api + 'helpers' },
    ],
  });
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
  const until = async (expr, message) => {
    for (let i = 0; i < 140; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const labeled = (label) =>
    `document.querySelector(${JSON.stringify('[aria-label="' + label + '"]')})`;
  const hidden =
    "[...document.querySelectorAll('label')].find(e=>e.textContent.trim().startsWith('Hidden'))?.querySelector('input[type=checkbox]')";
  const click = async (expr) => {
    const p = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing control '+${JSON.stringify(expr)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', {
        type,
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
  const type = async (expr, text) => {
    await click(expr);
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (text) await cdp.send('Input.insertText', { text });
    await pause();
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const checks = [];
  const assert = (name, ok) => {
    if (!ok) throw Error(name);
    checks.push({ name, passed: true });
  };
  const check = async (name, expr) => assert(name, await evaluate(expr));
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/helper-visibility-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const readHelper = async () =>
    (await (await fetch(api + 'helpers')).json()).data.find((h) => h.id === id);
  const save = async () => {
    await click(button('Save changes'));
    await until(`!${button('Discard')}`, 'Saved');
  };
  try {
    await cdp.send('Page.navigate', { url: origin + '/config/helpers/' + id });
    await until(
      "document.body.textContent.includes('Could not refresh widgets for Visibility second layout')",
      'Widget failure rendered',
    );
    await type(labeled('Helper name'), 'Retained visibility name');
    await check(
      'A failed layout does not hide known widget references',
      `!!document.querySelector('a[href="/config/dashboard/1/widgets/${widgetIds[0]}"]')`,
    );
    await evaluate(
      "document.querySelector('#usage').scrollIntoView({block:'center'})",
    );
    await shot('partial-failure');
    failWidgets = false;
    await click(
      labeled('Retry widget references for Visibility second layout'),
    );
    await until(
      `!!document.querySelector('a[href="/config/dashboard/${layout.id}/widgets/${widgetIds[1]}"]')`,
      'Second layout recovered',
    );
    await check(
      'Widget Retry preserves helper draft',
      `${labeled('Helper name')}.value==='Retained visibility name'`,
    );
    await click(hidden);
    assert(
      'Visibility and name changes are staged until Save',
      writes === 0 && (await readHelper()).hidden === false,
    );
    await click(button('Discard'));
    await check(
      'Discard restores visibility and name',
      `!(${hidden}).checked && ${labeled('Helper name')}.value==='Visibility target'`,
    );
    await click(hidden);
    await save();
    assert(
      'Explicit Save persists hidden without changing initial value',
      (await readHelper()).hidden === true &&
        (await readHelper()).initial_value === 'home',
    );
    await click(
      `document.querySelector('a[href="/config/dashboard/${layout.id}/widgets/${widgetIds[1]}"]')`,
    );
    await until(`!!${labeled('Helper')}`, 'Widget editor');
    await check(
      'Existing widget retains its hidden helper with explanation',
      `${labeled('Helper')}.textContent.includes('Visibility target') && document.body.textContent.includes('hidden from new selections')`,
    );
    await click(labeled('Helper'));
    await cdp.send('Input.insertText', { text: 'Visibility' });
    await until(
      "document.querySelectorAll('[cmdk-item]').length>0",
      'Picker options',
    );
    await check(
      'Picker keeps selected hidden helper but excludes other hidden helpers',
      "(()=>{const t=[...document.querySelectorAll('[cmdk-item]')].map(e=>e.textContent).join(' ');return t.includes('Visibility target')&&t.includes('Visibility visible')&&!t.includes('Visibility other hidden')})()",
    );
    await key('Escape', 27);
    await evaluate(
      "document.querySelector('#widget-options').scrollIntoView({block:'center'})",
    );
    await shot('selected-hidden');
    await goto('/config/dashboard/1/widgets/new');
    await until(
      '!!document.querySelector(\'[aria-label="Widget type"]\')',
      'New widget gallery',
    );
    await click(
      "[...document.querySelectorAll('[aria-label=\"Widget type\"] button')].find(e=>e.textContent.includes('Mode / helper'))",
    );
    await click(labeled('Helper'));
    await cdp.send('Input.insertText', { text: 'Visibility' });
    await until(
      "document.querySelectorAll('[cmdk-item]').length>0",
      'New helper choices',
    );
    await check(
      'New widget excludes every hidden helper',
      "(()=>{const t=[...document.querySelectorAll('[cmdk-item]')].map(e=>e.textContent).join(' ');return t.includes('Visibility visible')&&!t.includes('Visibility target')&&!t.includes('Visibility other hidden')})()",
    );
    await click(
      "[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes('Visibility visible'))",
    );
    await type(
      "document.querySelector('input[data-field=title]')",
      'Retained widget name',
    );
    await goto('/config/dashboard');
    failHelpers = true;
    await new Promise((resolve) => setTimeout(resolve, 16000));
    await goto('/config/dashboard/1/widgets/new');
    await until(
      "document.body.textContent.includes('Could not refresh helpers')",
      'Helper catalog error',
    );
    await check(
      'Helper read failure preserves selected helper and widget draft',
      `${labeled('Helper')}.textContent.includes('Visibility visible') && document.querySelector('input[data-field=title]').value==='Retained widget name'`,
    );
    await evaluate(
      "document.querySelector('#widget-options').scrollIntoView({block:'center'})",
    );
    await shot('picker-recovery');
    failHelpers = false;
    await click(button('Retry helpers'));
    await until(
      "!document.body.textContent.includes('Could not refresh helpers')",
      'Helper Retry',
    );
    await check(
      'Helper Retry preserves widget draft',
      "document.querySelector('input[data-field=title]').value==='Retained widget name'",
    );
    await click(button('Discard'));
    await goto('/config/helpers/' + id);
    await until(`!!${hidden}`, 'Helper returns');
    await check(
      'Hidden helper remains editable in settings',
      `(${hidden}).checked && ${labeled('Helper name')}.value==='Visibility target'`,
    );
    await click(hidden);
    await save();
    assert(
      'Unhide removes the optional flag instead of saving a false default',
      !Object.hasOwn(await readHelper(), 'hidden'),
    );
    assert(
      'Only explicit visibility saves write; previews and reference reads issue no commands',
      writes === 2 && commands === 0,
    );
    assert('No page exceptions', exceptions.length === 0);
    await check(
      'No horizontal overflow',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    return {
      passed: true,
      checks,
      scope:
        'Temporary fixture helpers/widgets/layout, injected catalog failures, no household changes',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await goto('/config');
    await cdp.send('Fetch.disable');
    for (const widget of widgetIds)
      await request('dashboard/widgets/' + widget, 'DELETE');
    await request('dashboard/layouts/' + layout.id, 'DELETE');
    for (const key of helperIds) await request('helpers/' + key, 'DELETE');
  }
}
