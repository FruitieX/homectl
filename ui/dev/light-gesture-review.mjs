import { writeFile } from 'node:fs/promises';

export default async function (cdp, { width, url }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Fixture required');
  const base = 'http://127.0.0.1:3021/api/v1/config/floorplans';
  const marker = await fetch(base);
  if (marker.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Marked fixture required');
  const id = `map_review_${Date.now()}`;
  const endpoint = `${base}/${id}/editor`;
  const grid = {
    width: 20,
    height: 12,
    tileSize: 32,
    deviceScale: 1,
    labelMode: 'all',
    tiles: Array.from({ length: 12 }, (_, y) =>
      Array.from({ length: 20 }, (_, x) =>
        x === 0 || y === 0 || x === 19 || y === 11 || (x === 11 && y < 8)
          ? 'wall'
          : 'floor',
      ),
    ),
    devices: [
      {
        deviceKey: 'zigbee2mqtt/living_room_lamp',
        deviceName: 'Living room lamp',
        x: 3,
        y: 3,
      },
      {
        deviceKey: 'zigbee2mqtt/living_room_floor_lamp',
        deviceName: 'Floor lamp',
        x: 8,
        y: 8,
      },
      {
        deviceKey: 'zigbee2mqtt/living_room_motion',
        deviceName: 'Living room motion',
        x: 6,
        y: 5,
      },
      {
        deviceKey: 'zigbee2mqtt/kitchen_ceiling',
        deviceName: 'Kitchen ceiling',
        x: 15,
        y: 4,
      },
    ],
    groups: {},
  };
  const saved = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      name: 'Map review',
      grid_data: JSON.stringify(grid),
      image: { kind: 'none' },
      create_only: true,
    }),
  });
  if (!saved.ok) throw Error(await saved.text());
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const pause = () => new Promise((r) => setTimeout(r, 160));
  const until = async (expression, message, count = 100) => {
    for (let i = 0; i < count; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const checks = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const click = async (expr) => {
    const point = await evaluate(
      `(()=>{const e=${expr}; if(!e) throw Error('Missing click target'); e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
  const key = async (key, code) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      windowsVirtualKeyCode: code,
      ...(key === 'Enter' ? { text: '\r' } : {}),
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
    await pause();
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const pick = async (label, text) => {
    const selector = `document.querySelector('button[aria-label="${label}"]')`;
    await evaluate(`${selector}.focus()`);
    await key('Enter', 13);
    await until(
      `!!document.querySelector('[role="option"]')`,
      'Picker opens with keyboard',
    );
    await click(
      `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const shot = async (suffix) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/map-review-${width}-${suffix}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const options = () =>
    click(`document.querySelector('[aria-label="Floorplan view options"]')`);
  try {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `const originalFetch=window.fetch.bind(window);window.mapReadAttempts=0;window.fetch=(input,init)=>{if(String(input).includes('/floorplans/${id}/editor')&&(!init?.method||init.method==='GET')&&++window.mapReadAttempts<=3)return Promise.resolve(new Response(JSON.stringify({success:false,error:'Temporary fixture outage'}),{status:503}));return originalFetch(input,init);};`,
    });
    await cdp.send('Page.navigate', { url: 'http://127.0.0.1:3021/map' });
    await cdp.send('Page.bringToFront');
    await until(
      width < 768
        ? '!!document.querySelector(\'[aria-label="Floorplan"]\')'
        : `!!${button('Map review')}`,
      'Floorplan selector available',
    );
    if (width < 768) await pick('Floorplan', 'Map review');
    else await click(button('Map review'));
    await until(
      `document.body.innerText.includes('The floorplan could not be loaded.')`,
      'Actionable read failure',
    );
    await check(
      'Read failure exposes device controls and retry',
      `!!${button('Retry map')} && !!document.querySelector('[aria-label="Adjust Living room lamp"]')`,
    );
    await click(button('Retry map'));
    await until(`!!document.querySelector('canvas')`, 'Retry renders map');
    await check(
      'Shared map read retries without nonexistent image requests',
      `window.mapReadAttempts===4 && !performance.getEntriesByType('resource').some(r=>r.name.includes('/floorplan/image?id=${id}'))`,
    );
    await options();
    await check(
      'View options use shared accessible selectors',
      `document.querySelectorAll('button[role="combobox"]').length===${width < 768 ? 4 : 3} && !!document.querySelector('[aria-label="Open device or group"]')?.textContent.includes('Choose')`,
    );
    await pick('Device labels', 'All devices');
    await pick('Group filter', 'Living room');
    // Keep the explicitly created wide plan after verifying the group selector.
    await key('Escape', 27);
    if (width < 768) await pick('Floorplan', 'Map review');
    else await click(button('Map review'));
    await options();
    await pick('Open device or group', 'Living room lamp');
    await until(
      `!!document.querySelector('[aria-label="Floorplan inspector"]')`,
      'Device inspector opens',
    );
    await check(
      'Device inspector retains related settings link',
      `!![...document.querySelectorAll('#floorplan-inspector a')].find(a=>a.textContent.trim()==='Device settings'&&decodeURIComponent(a.href).includes('living_room_lamp'))`,
    );
    await check(
      'Inspector fits the viewport',
      `(()=>{const r=document.querySelector('[aria-label="Floorplan inspector"]').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1})()`,
    );
    await shot('device');
    if (width < 700) {
      const resize = `document.querySelector('[aria-label="Resize device controls"]')`;
      const before = await evaluate(`${resize}.getAttribute('aria-valuenow')`);
      await evaluate(`${resize}.focus()`);
      await key('ArrowUp', 38);
      await check(
        'Phone inspector height is keyboard adjustable',
        `${resize}.getAttribute('aria-valuenow')>${JSON.stringify(before)}`,
      );
    }
    await evaluate(
      `document.querySelector('[aria-label="Close controls"]').focus()`,
    );
    await key('Escape', 27);
    await until(
      `!document.querySelector('[aria-label="Floorplan inspector"]')`,
      'Escape dismisses controls',
    );
    checks.push({ name: 'Keyboard Escape dismisses inspector', passed: true });
    await options();
    await pick('Open device or group', 'Living room lamp');
    await click(`document.querySelector('[aria-label="Close controls"]')`);
    await check(
      'Shared close button dismisses controls',
      `!document.querySelector('[aria-label="Floorplan inspector"]')`,
    );
    if (width < 768)
      await check(
        'Floorplan selector shares the AppBar immediately before the assistant',
        `(()=>{const selector=document.querySelector('[aria-label="Floorplan"]'), assistant=document.querySelector('[aria-label="Ask AI"]'), a=selector.getBoundingClientRect(), b=assistant.getBoundingClientRect();return Math.abs(a.top-b.top)<=6 && a.right<=b.left+1 && selector.closest('header').getBoundingClientRect().height<=65 && document.documentElement.scrollWidth<=innerWidth+1;})()`,
      );
    await shot('map');
    const commands = async () =>
      (
        await (
          await fetch('http://127.0.0.1:3021/api/__fixture/live-controls')
        ).json()
      ).commands;
    const before = (await commands()).length;
    const locate = () =>
      evaluate(
        `(()=>{const r=document.querySelector('canvas').getBoundingClientRect();const s=.86*Math.min(r.width/640,r.height/384);return {x:r.left+(r.width-640*s)/2+112*s,y:r.top+(r.height-384*s)/2+112*s}})()`,
      );
    let point = await locate();
    const pointer = async (type, p = point) =>
      width < 768
        ? cdp.send('Input.dispatchTouchEvent', {
            type: {
              down: 'touchStart',
              move: 'touchMove',
              up: 'touchEnd',
              cancel: 'touchCancel',
            }[type],
            touchPoints:
              type === 'up' || type === 'cancel' ? [] : [{ ...p, id: 1 }],
          })
        : cdp.send('Input.dispatchMouseEvent', {
            type: {
              down: 'mousePressed',
              move: 'mouseMoved',
              up: 'mouseReleased',
            }[type],
            ...p,
            button: 'left',
            buttons: type === 'up' ? 0 : 1,
            clickCount: 1,
          });
    const popover = `document.querySelector('[aria-label="Living room lamp quick controls"]')`;
    await pointer('down');
    await new Promise((r) => setTimeout(r, 650));
    await until(`!!${popover}`, 'Long hold opens quick controls');
    await shot('hold');
    if ((await commands()).length !== before)
      throw Error('Holding must not issue commands');
    await pointer('up');
    await pause();
    await check(
      'Hold and release selects without changing state',
      `document.body.innerText.includes('1 selected') && !${popover}`,
    );
    point = await locate();
    await pointer('down');
    await new Promise((r) => setTimeout(r, 650));
    await until(`!!${popover}`, 'Second hold reopens quick controls');
    await pointer('move', { x: point.x + 58, y: point.y });
    await pause();
    await check(
      'Outer ring previews brightness before release',
      `${popover}.innerText.includes('25%')`,
    );
    if ((await commands()).length !== before)
      throw Error('Drag preview must not issue commands');
    await pointer('up', { x: point.x + 58, y: point.y });
    await new Promise((r) => setTimeout(r, 300));
    const sent = await commands();
    if (
      sent.length !== before + 1 ||
      sent.at(-1).DeviceCommand?.brightness !== 0.25
    )
      throw Error(
        'Expected one quarter-brightness command: ' +
          JSON.stringify(sent.at(-1)),
      );
    await check(
      'Brightness release keeps selection and color popover',
      `document.body.innerText.includes('1 selected') && !!${popover} && !!document.querySelector('[aria-label="Living room lamp hue"]')`,
    );
    await check(
      'Quick popover stays inside phone and desktop viewport',
      `(()=>{const r=${popover}.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight+1;})()`,
    );
    await shot('quick');
    await click(
      `document.querySelector('[aria-label="Close quick controls"]')`,
    );
    if (width < 768) {
      point = await locate();
      await pointer('down');
      await new Promise((r) => setTimeout(r, 650));
      await until(`!!${popover}`, 'Cancellation hold opens');
      await pointer('move', { x: point.x, y: point.y + 58 });
      await pointer('cancel');
      await pause();
      await check(
        'Cancelled touch closes preview without selection or command',
        `!${popover} && document.body.innerText.includes('1 selected')`,
      );
      if ((await commands()).length !== before + 1)
        throw Error('Cancelled gesture sent command');
    }
    await pointer('down');
    await pointer('move', { x: point.x + 35, y: point.y + 10 });
    await new Promise((r) => setTimeout(r, 650));
    await check(
      'Movement before hold threshold pans without opening quick controls',
      `!${popover}`,
    );
    await pointer('up', { x: point.x + 35, y: point.y + 10 });

    return { checks, passed: checks.every((c) => c.passed), width };
  } finally {
    await fetch(`${base}/${id}`, { method: 'DELETE' });
  }
}
