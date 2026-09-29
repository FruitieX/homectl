export default async function (cdp, { width, height, url }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Fixture required');
  const base = 'http://127.0.0.1:3021/api/v1/config/floorplans';
  const marker = await fetch(base);
  if (marker.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Marked fixture required');
  const id = `placement_${Date.now()}`,
    endpoint = `${base}/${id}/editor`;
  const grid = {
    width: 24,
    height: 32,
    tileSize: 32,
    deviceScale: 1,
    labelMode: 'all',
    tiles: Array.from({ length: 32 }, (_, y) =>
      Array.from({ length: 24 }, (_, x) =>
        x === 0 || y === 0 || x === 23 || y === 31 ? 'wall' : 'floor',
      ),
    ),
    devices: [
      {
        deviceKey: 'zigbee2mqtt/living_room_lamp',
        deviceName: 'Living room lamp',
        x: 3,
        y: 3,
      },
    ],
    groups: {},
    future: { keep: true },
  };
  const created = await fetch(endpoint, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id,
      name: 'Placement review',
      grid_data: JSON.stringify(grid),
      image: { kind: 'none' },
      create_only: true,
    }),
  });
  if (!created.ok) throw Error(await created.text());
  const original = (await created.json()).data;
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
  const pause = () => new Promise((r) => setTimeout(r, 180));
  const until = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = async (text) => {
    await evaluate(`${button(text)}.click()`);
    await pause();
  };
  const saved = async () => (await (await fetch(endpoint)).json()).data;
  const checks = [];
  const fit = async () => {
    await click('Fit');
    const fits = await evaluate(
      `(()=>{const c=document.querySelector('canvas'),p=c.parentElement,r=c.getBoundingClientRect(); return p.scrollWidth<=p.clientWidth+1 && p.scrollHeight<=p.clientHeight+1 && c.width>=r.width && c.height>=r.height})()`,
    );
    if (!fits)
      throw Error(
        'Fit must show the whole drawing with a sharp backing surface',
      );
  };
  const positionText = () =>
    evaluate(
      `(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Bedroom lampColumn'));return b?.textContent ?? ''})()`,
    );
  const place = async (x, y, cancel = false) => {
    const point = await evaluate(
      `(()=>{const c=document.querySelector('canvas'),p=c.parentElement;p.scrollIntoView({block:'center'}); p.scrollLeft=((${x}+.5)/24)*c.getBoundingClientRect().width-p.clientWidth/2;p.scrollTop=((${y}+.5)/32)*c.getBoundingClientRect().height-p.clientHeight/2;const r=c.getBoundingClientRect();return {x:r.x+((${x}+.5)/24)*r.width,y:r.y+((${y}+.5)/32)*r.height}})()`,
    );
    await cdp.send('Page.bringToFront');
    if (width < 700) {
      await cdp.send('Emulation.setTouchEmulationEnabled', {
        enabled: true,
        maxTouchPoints: 1,
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [point],
      });
      await pause();
      await cdp.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
    } else {
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
    }
    await pause();
  };
  try {
    await cdp.send('Page.navigate', {
      url: `http://127.0.0.1:3021/config/floorplan?id=${id}`,
    });
    await until(`!!document.querySelector('canvas')`, 'Floorplan loaded');
    await fit();
    checks.push(
      'Fit shows a tall floorplan without canvas scrolling or undersized backing pixels',
    );
    await click('Zoom out');
    await click('Zoom out');
    if (!(await evaluate(`${button('Zoom out')}.disabled`)))
      throw Error('Expected 50% zoom limit');
    checks.push('Zoom-out reaches 50% of Fit');
    await fit();
    await click('Devices');
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim().startsWith('Bedroom lampSelect,')).click()`,
    );
    await pause();
    if (width < 700) {
      await place(5, 6, true);
      if (await positionText()) throw Error('Cancelled placement remains');
      checks.push('Cancelled native touch placement restores the draft');
    }
    await place(5, 6);
    await evaluate(
      `[...document.querySelectorAll('[aria-label="Device placements"] button')].find(b=>b.textContent.startsWith('Placed')).click()`,
    );
    await pause();
    if (!(await positionText()).includes('Column 6 · Row 7'))
      throw Error('Placement used the wrong cell');
    checks.push('Native input places the selected light in the exact cell');
    if ((await saved()).revision_token !== original.revision_token)
      throw Error('Placement wrote before Save');
    checks.push('Placement remains an unsaved draft');
    const points = await evaluate(
      `(()=>{const c=document.querySelector('canvas');c.parentElement.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return [{x:r.x+5.5/24*r.width,y:r.y+6.5/32*r.height},{x:r.x+8.5/24*r.width,y:r.y+9.5/32*r.height}]})()`,
    );
    await cdp.send('Page.bringToFront');
    if (width < 700) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [points[0]],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [points[1]],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...points[0],
        button: 'left',
        buttons: 1,
        clickCount: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...points[1],
        button: 'left',
        buttons: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...points[1],
        button: 'left',
        clickCount: 1,
      });
    }
    await pause();
    if (!(await positionText()).includes('Column 9 · Row 10'))
      throw Error('Native dragging used wrong coordinates');
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Undo')).click()`,
    );
    await pause();
    if (!(await positionText()).includes('Column 6 · Row 7'))
      throw Error('Undo native dragging failed');
    checks.push(
      'Native dragging moves a placed light and Undo restores its cell',
    );
    await click('Zoom in');
    await click('Zoom in');
    await place(10, 12);
    if (!(await positionText()).includes('Column 11 · Row 13'))
      throw Error('Zoomed placement uses wrong coordinates');
    checks.push('Moving at 200% zoom preserves grid coordinates');
    await evaluate(
      `document.querySelector('[aria-label="Remove placement for Bedroom lamp"]').click()`,
    );
    await pause();
    if (await positionText()) throw Error('Removal did not remove placement');
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Undo')).click()`,
    );
    await pause();
    if (!(await positionText()).includes('Column 11 · Row 13'))
      throw Error('Undo removal failed');
    await evaluate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Undo')).click()`,
    );
    await pause();
    if (!(await positionText()).includes('Column 6 · Row 7'))
      throw Error('Undo move failed');
    checks.push('Remove and consecutive Undo restore exact placements');
    await click('Save changes');
    await until(`!${button('Save changes')}`, 'Save completed');
    const result = JSON.parse((await saved()).grid_data),
      placement = result.devices.find(
        (d) => d.deviceKey === 'zigbee2mqtt/bedroom_lamp',
      );
    if (
      placement?.x !== 5 ||
      placement?.y !== 6 ||
      result.devices.length !== 2 ||
      !result.future.keep
    )
      throw Error('Save changed scope or lost coordinates/extensions');
    checks.push(
      'Explicit Save persists the placement and preserves other devices/extensions',
    );
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: width < 700 ? 430 : 1024,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    });
    await pause();
    await fit();
    checks.push('Fit recomputes after viewport resizing');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 700,
    });
    await pause();
    await fit();
    await evaluate(
      `document.querySelector('canvas').parentElement.scrollIntoView({block:'center'})`,
    );
    if (
      !(await evaluate('document.documentElement.scrollWidth <= innerWidth+1'))
    )
      throw Error('Page overflow');
    checks.push('Canvas and placement controls remain within the page');
    return { passed: true, checks, width };
  } finally {
    const current = await saved();
    await fetch(endpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expected: current.revision_token }),
    });
  }
}
