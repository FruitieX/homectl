import { writeFile } from 'node:fs/promises';
export default async function (cdp, { url, width }) {
  const origin = 'http://127.0.0.1:3021',
    api = origin + '/api/v1/config/';
  const marker = await fetch(api + 'sources');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked isolated fixture required');
  const id = `usage-${width}-${Date.now()}`;
  const preset = (await (await fetch(api + 'source-presets')).json()).data[0];
  const source = {
    id,
    name: 'Usage source',
    enabled: false,
    revision: 1,
    timezone: 'Europe/Helsinki',
    refresh_interval_ms: 60000,
    aliases: ['legacy/' + id],
    compute: {
      kind: 'script',
      preset: { id: 'circadian', version: 1 },
      params: preset.default_params,
    },
  };
  const helper = {
    id,
    name: 'Usage helper',
    kind: { kind: 'enum', options: ['day', 'night'] },
    initial_value: 'day',
    persistence: 'durable',
  };
  const request = async (kind, method, body) => {
    const r = await fetch(api + kind + '/' + id, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) throw Error('Fixture ' + r.status);
    return r.json();
  };
  await request('sources', 'PUT', source);
  await request('helpers', 'PUT', helper);
  const bodies = {};
  for (const kind of ['scenes', 'groups', 'routines'])
    bodies[kind] = await (await fetch(api + kind)).json();
  bodies.scenes.data.push({
    id,
    name: 'Alias scene',
    hidden: false,
    device_states: { same: null, bad: false },
    group_states: { same: { integration_id: 'legacy', device_id: id } },
  });
  bodies.groups.data.push({
    id,
    name: 'Source room',
    hidden: false,
    devices: [{ integration_id: 'computed', device_id: id }],
    linked_groups: [],
    device_keys: ['computed/' + id],
  });
  const native = {
    id,
    name: 'Selected scene routine',
    enabled: false,
    rules: [],
    actions: [],
    semantics_version: 2,
    definition_v2: {
      triggers: [{ id: 'manual', kind: 'manual' }],
      condition: {
        kind: 'comparison',
        source: { kind: 'computed_source', source: id, path: '/value' },
        operator: 'eq',
        value: false,
      },
      program: {
        kind: 'native',
        steps: [
          {
            id: 'scene',
            action: 'activate_scene',
            select: {
              kind: 'helper_enum',
              helper: id,
              mapping: { day: 'normal' },
              fallback_scene_id: 'normal',
            },
            targets: { devices: [], groups: [] },
            use_scene_transition: true,
          },
        ],
      },
    },
  };
  bodies.routines.data.push(native, {
    ...native,
    id: id + '-fake',
    name: 'JSON lookalike routine',
    definition_v2: {
      condition: {
        kind: 'comparison',
        source: { kind: 'helper', helper: 'unrelated' },
        operator: 'eq',
        value: { kind: 'helper', helper: id },
      },
      program: { kind: 'native', steps: [] },
    },
  });
  let failGroups = true,
    writes = 0;
  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method !== 'GET' && request.url.startsWith(api)) writes++;
  });
  cdp.on('Fetch.requestPaused', async (e) => {
    const kind = e.request.url.slice(api.length);
    if (e.request.method !== 'GET' || !bodies[kind])
      return cdp.send('Fetch.continueRequest', { requestId: e.requestId });
    const fail = kind === 'groups' && failGroups;
    await cdp.send('Fetch.fulfillRequest', {
      requestId: e.requestId,
      responseCode: fail ? 503 : 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(
        JSON.stringify(
          fail
            ? { success: false, error: 'Fixture reference read failed' }
            : bodies[kind],
        ),
      ).toString('base64'),
    });
  });
  await cdp.send('Fetch.enable', {
    patterns: Object.keys(bodies).map((kind) => ({ urlPattern: api + kind })),
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
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const input = "document.querySelector('input[data-field=name]')";
  const click = async (expr) => {
    const p = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
  const type = async (expr, text) => {
    await click(expr);
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key: 'a',
        windowsVirtualKeyCode: 65,
        modifiers: 2,
      });
    await cdp.send('Input.insertText', { text });
    await pause();
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const checks = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/config-usage-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const usage = "document.querySelector('#usage')";
  try {
    await cdp.send('Page.navigate', { url: origin + '/config/sources/' + id });
    await until(
      `!!${usage} && document.body.textContent.includes('Could not load references')`,
      'Source reference failure',
    );
    await type(input, 'Retained source name');
    await check(
      'Malformed scene target does not hide alias scene reference',
      `${usage}.textContent.includes('Alias scene')`,
    );
    await check(
      'Direct computed-source routine reference is linked',
      `!!${usage}.querySelector('a[href="/config/routines/${id}"]')`,
    );
    await check(
      'Group failure leaves other reference families visible',
      `${usage}.textContent.includes('Could not load references') && ${usage}.textContent.includes('Selected scene routine')`,
    );
    await evaluate(usage + ".scrollIntoView({block:'center'})");
    await shot('failed-group');
    failGroups = false;
    await click(
      'document.querySelector(\'[aria-label="Retry rooms & groups references"]\')',
    );
    await until(
      `${usage}.textContent.includes('Source room')`,
      'Group references recovered',
    );
    await check(
      'Reference Retry preserves source draft',
      `${input}.value==='Retained source name'`,
    );
    await check(
      'Canonical room destination is used',
      `!!${usage}.querySelector('a[href="/config/groups/${id}"]')`,
    );
    await evaluate(usage + ".scrollIntoView({block:'center'})");
    await shot('source');
    await click(`${usage}.querySelector('a[href="/config/routines/${id}"]')`);
    await until(
      "location.pathname.startsWith('/config/routines/')",
      'Routine opens',
    );
    await goto('/config/sources/' + id);
    await until(`!!${input}`, 'Source return');
    await check(
      'Related-page navigation retains source edits',
      `${input}.value==='Retained source name'`,
    );
    await click(button('Discard'));
    await goto('/config/helpers/' + id);
    await until(`!!${usage}`, 'Helper usage');
    await check(
      'Helper scene-selection dependency is linked',
      `!!${usage}.querySelector('a[href="/config/routines/${id}"]')`,
    );
    await check(
      'JSON operands do not invent helper dependencies',
      `!${usage}.textContent.includes('JSON lookalike routine')`,
    );
    await evaluate(usage + ".scrollIntoView({block:'center'})");
    await shot('helper');
    await check(
      'Script uncertainty remains explicit',
      `${usage}.textContent.includes('Scripts may also read this helper')`,
    );
    if (writes !== 0 || exceptions.length)
      throw Error(
        'Unexpected mutation or page exception ' +
          JSON.stringify({ writes, exceptions }),
      );
    checks.push({
      name: 'Read, repair and related navigation cause no configuration writes or page exceptions',
      passed: true,
    });
    await check(
      'No horizontal overflow',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    return {
      passed: true,
      checks,
      scope:
        'Owned helper/source and intercepted reference catalogs in isolated fixture; no execution or household writes',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await goto('/config');
    await cdp.send('Fetch.disable');
    await request('sources', 'DELETE');
    await request('helpers', 'DELETE');
  }
}
