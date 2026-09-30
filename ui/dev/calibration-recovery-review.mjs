import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    endpoint = origin + '/api/v1/config/calibration-editor';
  const response = await fetch(endpoint);
  if (
    !url.startsWith(origin + '/') ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked isolated fixture required');
  const catalog = (await response.json()).data;
  const devices = (await (await fetch(origin + '/api/v1/devices')).json())
    .devices;
  const template = devices.find((d) => d.id === 'living_room_lamp');
  const reference = (id, flags = {}) => ({
    ...structuredClone(template),
    id,
    name: 'Review ' + id,
    integration_id: 'review',
    data: {
      Controllable: {
        ...structuredClone(template.data.Controllable),
        ...flags,
      },
    },
  });
  const refs = [
    reference('writable'),
    reference('readonly', { managed: 'FullReadOnly' }),
    reference('disabled', { disabled: true }),
    reference('dimmer', {
      capabilities: {
        brightness: true,
        hs: false,
        xy: false,
        rgb: false,
        ct: null,
      },
    }),
    reference('coloronly', {
      capabilities: {
        brightness: false,
        hs: true,
        xy: false,
        rgb: false,
        ct: null,
      },
    }),
    reference('switch', {
      capabilities: {
        brightness: false,
        hs: false,
        xy: false,
        rgb: false,
        ct: null,
      },
    }),
  ];
  let failCatalog = true,
    removeReference = false,
    writes = 0;
  const sessions = new Set(),
    requests = [],
    exceptions = [];
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === endpoint && request.method === 'PUT') writes++;
    if (
      /\/calibration(-brightness)?-sessions\//.test(request.url) &&
      !request.url.endsWith('/heartbeat')
    ) {
      requests.push({ method: request.method, url: request.url });
      const id = request.url.split('/').at(-1);
      if (request.method === 'POST') sessions.add(id);
      if (request.method === 'DELETE') sessions.delete(id);
    }
  });
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Fetch.requestPaused', async (e) => {
    if (e.request.method !== 'GET') {
      await cdp.send('Fetch.continueRequest', { requestId: e.requestId });
      return;
    }
    const isCatalog = e.request.url === endpoint;
    const body = isCatalog
      ? failCatalog
        ? { success: false, error: 'Fixture catalog refresh failed' }
        : { success: true, data: catalog }
      : {
          devices: [
            ...devices,
            ...refs.filter(
              (d) =>
                !removeReference || !['writable', 'coloronly'].includes(d.id),
            ),
          ],
        };
    await cdp.send('Fetch.fulfillRequest', {
      requestId: e.requestId,
      responseCode: isCatalog && failCatalog ? 503 : 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(body)).toString('base64'),
    });
  });
  await cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: endpoint },
      { urlPattern: origin + '/api/v1/devices' },
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
  const until = async (expr, name) => {
    for (let i = 0; i < 160; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(name);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const labeled = (label) =>
    `document.querySelector(${JSON.stringify('[aria-label="' + label + '"]')})`;
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
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        modifiers,
        ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}),
      });
  };
  const type = async (expr, text) => {
    await click(expr);
    await key('a', 65, 2);
    await key('Backspace', 8);
    await cdp.send('Input.insertText', { text });
    await pause();
  };
  const pick = async (label, text) => {
    await click(labeled(label));
    await cdp.send('Input.insertText', { text });
    await until(
      "document.querySelectorAll('[cmdk-item]').length>0",
      'Reference options',
    );
    await key('End', 35);
    await key('Enter', 13);
    await until(`!document.querySelector('[cmdk-input]')`, 'Picker closes');
  };
  const checks = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const assert = (name, ok) => {
    if (!ok) throw Error(name);
    checks.push({ name, passed: true });
  };
  const noServerSessions = async () =>
    Object.keys(
      (await (await fetch(origin + '/api/__fixture/calibration')).json()).data
        .sessions,
    ).length === 0;
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/calibration-recovery-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const path = '/config/devices/detail/zigbee2mqtt/living_room_lamp';
  try {
    await cdp.send('Page.navigate', {
      url: origin + path + '?calibration=brightness',
    });
    await until(
      "document.body.textContent.includes('Could not load calibration profiles.')",
      'Initial catalog error',
    );
    assert(
      'Failed initial catalog read starts no preview or configuration write',
      requests.length === 0 && writes === 0,
    );
    failCatalog = false;
    await click(button('Retry calibration profiles'));
    await until(
      `!!${labeled('Brightness reference light')}`,
      'Brightness form recovered',
    );
    await click(labeled('Brightness reference light'));
    await cdp.send('Input.insertText', { text: 'Review' });
    await check(
      'Brightness choices exclude read-only, disabled, switch and color-only devices',
      "(()=>{const t=[...document.querySelectorAll('[cmdk-item]')].map(e=>e.textContent).join(' ');return t.includes('Review writable')&&t.includes('Review dimmer')&&!/Review (readonly|disabled|switch|coloronly)/.test(t)})()",
    );
    await key('Escape', 27);
    await pick('Brightness reference light', 'Review writable');
    await click(button('Continue'));
    await type(labeled('Target output for point 1'), '97');
    await click(button('Preview this point'));
    await until(
      "document.body.textContent.includes('Live preview active')",
      'Preview active',
    );
    removeReference = true;
    await until(
      "document.body.textContent.includes('Choose an available, writable reference light that supports dimming') && document.body.textContent.includes('Preview stopped')",
      'Missing reference stops preview',
    );
    assert(
      'Missing brightness reference stops its session',
      sessions.size === 0 && (await noServerSessions()),
    );
    await check(
      'Missing brightness reference keeps edits and blocks previews',
      `${labeled('Target output for point 1')}.value==='97' && [...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Preview this point').every(b=>b.disabled)`,
    );
    await evaluate(
      "[...document.querySelectorAll('[role=status]')].find(e=>e.textContent.includes('Choose an available')).scrollIntoView({block:'center'})",
    );
    await shot('missing-brightness');
    await click(button('Back'));
    await check(
      'Unavailable reference stays identifiable and cannot continue',
      `${labeled('Brightness reference light')}.textContent.includes('review/writable (unavailable)') && ${button('Continue')}.disabled`,
    );
    await pick('Brightness reference light', 'Review dimmer');
    await click(button('Continue'));
    await check(
      'Replacing the reference keeps the edited curve',
      `${labeled('Target output for point 1')}.value==='97'`,
    );
    await click(button('Close calibration'));
    failCatalog = true;
    // The shared configuration cache remains fresh for 15 seconds.
    await new Promise((resolve) => setTimeout(resolve, 16000));
    await click(button('Calibrate brightness'));
    await until(
      "document.body.textContent.includes('Could not refresh calibration profiles.')",
      'Cached catalog error',
    );
    await check(
      'Cached catalog failure keeps the editor and numeric draft',
      `${labeled('Target output for point 1')}.value==='97'`,
    );
    await evaluate(
      "[...document.querySelectorAll('[role=alert]')].find(e=>e.textContent.includes('Could not refresh calibration profiles')).scrollIntoView({block:'center'})",
    );
    await shot('cached-failure');
    failCatalog = false;
    await click(button('Retry calibration profiles'));
    await until(
      "!document.body.textContent.includes('Could not refresh calibration profiles.')",
      'Catalog retry',
    );
    await check(
      'Catalog recovery keeps numeric draft',
      `${labeled('Target output for point 1')}.value==='97'`,
    );
    await click(button('Discard'));
    await click(button('Close calibration'));
    removeReference = false;
    await click(button('Calibrate color'));
    await until(`!!${labeled('Color reference light')}`, 'Color form');
    // Wait for the normal device query refresh to restore the synthetic references.
    await click(labeled('Color reference light'));
    await cdp.send('Input.insertText', { text: 'Review' });
    await until(
      "[...document.querySelectorAll('[cmdk-item]')].some(e=>e.textContent.includes('Review coloronly'))",
      'Reference returns',
    );
    await check(
      'Color choices exclude dimmers, switches and unwritable devices',
      "(()=>{const t=[...document.querySelectorAll('[cmdk-item]')].map(e=>e.textContent).join(' ');return t.includes('Review coloronly')&&!/Review (readonly|disabled|switch|dimmer)/.test(t)})()",
    );
    await key('Escape', 27);
    await pick('Color reference light', 'Review coloronly');
    await click(
      "[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Start matching'))",
    );
    await until(`!!${labeled('Lamp hue in degrees')}`, 'Color matching');
    await type(labeled('Lamp hue in degrees'), '42');
    removeReference = true;
    await until(
      `!!${button('Change reference')} && document.body.textContent.includes('Preview is stopped')`,
      'Missing color reference stops preview',
    );
    assert(
      'Missing color reference stops its session',
      sessions.size === 0 && (await noServerSessions()),
    );
    await check(
      'Color points survive missing reference and resume is blocked',
      `${labeled('Lamp hue in degrees')}.value==='42' && ${button('Resume live preview')}.disabled`,
    );
    await check(
      'Stopped color preview does not claim to be sending',
      "!document.body.textContent.includes('Sending adjustment')",
    );
    await evaluate(
      "[...document.querySelectorAll('[role=status]')].find(e=>e.textContent.includes('Choose an available')).scrollIntoView({block:'center'})",
    );
    await shot('missing-color');
    await click(button('Change reference'));
    await check(
      'Color repair returns to setup with unavailable ID preserved',
      `${labeled('Color reference light')}.textContent.includes('review/coloronly (unavailable)')`,
    );
    assert(
      'Review and preview never save calibration implicitly',
      writes === 0,
    );
    assert('No page exceptions', exceptions.length === 0);
    await click(button('Close calibration'));
    return {
      passed: true,
      checks,
      scope:
        'Synthetic REST catalog and calibration read failures; previews acknowledged by isolated fixture only',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await evaluate(
      "history.pushState({}, '', '/config'); dispatchEvent(new PopStateEvent('popstate'))",
    ).catch(() => {});
    await cdp.send('Fetch.disable');
    for (const id of sessions)
      await fetch(origin + '/api/v1/config/calibration-sessions/' + id, {
        method: 'DELETE',
      });
  }
}
