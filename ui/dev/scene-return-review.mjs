import { writeFile } from 'node:fs/promises';
// All created records belong to this journey in the marked local fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/routines',
    sceneBase = origin + '/api/v1/config/scenes';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = 'return-routine-' + width + '-' + Date.now(),
    sceneId = id + '-scene',
    path = '/config/routines/' + id;
  const routineName = 'Evening routine ' + width,
    sceneName = 'Evening scene ' + width;
  let commands = 0;
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
    if (
      request.url.startsWith(base) &&
      ['POST', 'PUT'].includes(request.method)
    )
      writes++;
    if (
      request.method === 'POST' &&
      /\/(activate|force-trigger|trigger|commands)(\/|$)/.test(
        new URL(request.url).pathname,
      )
    )
      commands++;
  });
  cdp.on('Network.webSocketFrameSent', ({ response }) => {
    try {
      const message = JSON.parse(response.payloadData);
      if (message.DeviceCommand || message.SceneCommand || message.Action)
        commands++;
    } catch {}
  });
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/scene-return-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Fixture cleanup failed');
    await fetch(sceneBase + '/' + sceneId, { method: 'DELETE' });
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
    'document.querySelector(' +
    JSON.stringify('[data-node-id="' + id + '"]') +
    ')';

  const field = (name) =>
    'document.querySelector(' +
    JSON.stringify('[data-field="' + name + '"]') +
    ')';
  const edit = async (expr, text) => {
    await click(expr);
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (text) await cdp.send('Input.insertText', { text });
    await pause();
  };
  const link = (text) =>
    `[...document.querySelectorAll('a')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const menu = async (label, text) => {
    await click(button(label));
    await until("!!document.querySelector('[role=menuitem]')", 'Menu open');
    await click(
      "[...document.querySelectorAll('[role=menuitem]')].find(e=>e.textContent.trim()===" +
        JSON.stringify(text) +
        ')',
    );
  };
  const cmd = async (expr, text) => {
    await click(expr);
    await until("!!document.querySelector('[cmdk-item]')", 'Picker');
    await click(
      "[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes(" +
        JSON.stringify(text) +
        '))',
    );
  };
  const scenes = async () => (await (await fetch(sceneBase)).json()).data;
  try {
    await cdp.send('Page.navigate', { url: origin + '/config/routines/new' });
    await cdp.send('Page.bringToFront');
    await until('!!' + field('name'), 'Routine ready');
    await edit(field('name'), routineName);
    await edit(field('id'), id);
    await check(
      'New routine defaults to enabled',
      "[...document.querySelectorAll('label')].find(e=>e.textContent.includes('Enable after creating')).querySelector('input').checked",
    );
    await menu('Add start', 'Manual only');
    await menu('Add action', 'Activate scene');
    const nodeId = await evaluate(
        "document.querySelector('#then [data-node-id]').dataset.nodeId",
      ),
      action = node(nodeId);
    await click(link('Create a scene'));
    await until(
      "location.pathname==='/config/scenes/new' && !!" + field('name'),
      'Scene creation ready',
    );
    await check(
      'Scene creation retains the originating action ID',
      "new URLSearchParams(location.search).get('returnTo').includes(" +
        JSON.stringify('sceneNode=' + encodeURIComponent(nodeId)) +
        ')',
    );
    await edit(field('name'), sceneName);
    await edit(field('id'), sceneId);
    await click(button('Add groups'));
    await until("!!document.querySelector('[role=dialog]')", 'Targets ready');
    await click(
      "[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent.includes('Living room')).querySelector('input')",
    );
    await click(button('Done'));
    await click(link('Return to routine'));
    await until(
      "location.pathname==='/config/routines/new' && !!" + field('name'),
      'Returned without create',
    );
    await check(
      'Return link keeps the routine name and start/action drafts',
      field('name') +
        '.value===' +
        JSON.stringify(routineName) +
        ' && !!' +
        action,
    );
    assert(
      'Returning before Create writes neither entity',
      writes === 0 && !(await scenes()).some((s) => s.id === sceneId),
    );
    await click(link('Create a scene'));
    await until(
      "location.pathname==='/config/scenes/new' && !!" + field('name'),
      'Scene draft reopened',
    );
    await check(
      'Scene draft and selected target survive the round trip',
      field('name') +
        '.value===' +
        JSON.stringify(sceneName) +
        " && document.querySelector('#rooms').textContent.includes('Living room')",
    );
    await click(button('Create scene'));
    await until(
      "location.pathname==='/config/routines/new' && !!" +
        labeled('Scene to activate', 'button', action),
      'Created scene returned',
    );
    await until(
      'document.activeElement===' + action,
      'Focus returned to action',
    );
    await check(
      'Created scene is selected in the correct action',
      labeled('Scene to activate', 'button', action) +
        '.textContent.includes(' +
        JSON.stringify(sceneName) +
        ')',
    );
    await check(
      'Return consumes creation parameters and identifies the focused action',
      "new URLSearchParams(location.search).get('node')===" +
        JSON.stringify(nodeId) +
        " && !new URLSearchParams(location.search).has('scene') && !new URLSearchParams(location.search).has('sceneNode')",
    );
    assert(
      'Scene creation does not save the routine or command devices',
      writes === 0 && commands === 0 && !(await read()),
    );
    await check(
      'Scene return announces selection once',
      "[...document.querySelectorAll('[data-sonner-toast]')].filter(e=>e.textContent.includes('Created scene selected')).length===1",
    );
    await pause();
    await shot('selected');
    await click(button('Create routine'));
    await until(
      'location.pathname===' + JSON.stringify(path),
      'Routine created',
    );
    let saved = await read();
    assert(
      'Explicit routine Create saves the selected scene and enable choice',
      saved.enabled === true &&
        saved.definition_v2.program.steps[0].scene_id === sceneId &&
        saved.definition_v2.triggers[0].kind === 'manual',
    );
    const before = writes;
    await goto(
      path + '?scene=' + encodeURIComponent(sceneId) + '&sceneNode=removed',
    );
    await until(
      "document.body.textContent.includes('original action is no longer available')",
      'Missing action message',
    );
    await check(
      'Missing return action offers the created scene without claiming selection',
      link('Open created scene') +
        `.getAttribute('href').endsWith(${JSON.stringify(sceneId)})`,
    );
    assert(
      'Missing return action does not write or mutate the saved routine',
      writes === before &&
        (await read()).definition_v2.program.steps[0].scene_id === sceneId,
    );
    await until(
      "![...document.querySelectorAll('[data-sonner-toast]')].some(e=>e.textContent.includes('Created scene selected'))",
      'Previous selection announcement dismissed',
    );
    await shot('missing-action');
    await fetch(sceneBase + '/' + sceneId, { method: 'DELETE' });
    await reload();
    await check(
      'A removed selected scene stays visible as unavailable',
      labeled('Scene to activate', 'button', action) +
        ".textContent.includes('unavailable')",
    );
    await cmd(labeled('Scene to activate', 'button', action), 'Night');
    await click(labeled('Open scene details', 'a', action));
    await until(
      "location.pathname==='/config/scenes/night'",
      'Related scene opened',
    );
    await click(
      `[...document.querySelectorAll('[aria-label="Retained drafts"] a')].find(e=>e.getAttribute('href')===${JSON.stringify(path)})`,
    );
    await until(
      'location.pathname===' +
        JSON.stringify(path) +
        ' && !!' +
        labeled('Scene to activate', 'button', action),
      'Routine draft returned',
    );
    await check(
      'Repair selection survives related scene navigation',
      labeled('Scene to activate', 'button', action) +
        ".textContent.includes('Night')",
    );
    await save();
    assert(
      'Explicit Save repairs the unavailable reference',
      (await read()).definition_v2.program.steps[0].scene_id === 'night',
    );
    await check(
      'Linked editing fits the viewport',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    assert(
      'The entire linked editing journey issues no live command',
      commands === 0,
    );
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}
