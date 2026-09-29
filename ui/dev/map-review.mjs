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
    await until(`!!${button('Map review')}`, 'Floorplan tab available');
    await click(button('Map review'));
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
      `document.querySelectorAll('button[role="combobox"]').length===3 && !!document.querySelector('[aria-label="Open device or group"]')?.textContent.includes('Choose')`,
    );
    await pick('Device labels', 'All devices');
    await pick('Group filter', 'Living room');
    // Keep the explicitly created wide plan after verifying the group selector.
    await key('Escape', 27);
    await click(button('Map review'));
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
    await shot('map');
    return { checks, passed: checks.every((c) => c.passed), width };
  } finally {
    await fetch(`${base}/${id}`, { method: 'DELETE' });
  }
}
