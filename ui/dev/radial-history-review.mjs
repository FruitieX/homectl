import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const base = 'http://127.0.0.1:3021';
  if (
    !url.startsWith(base + '/') ||
    (await fetch(base + '/api/v1/config/floorplans')).headers.get(
      'x-homectl-fixture',
    ) !== 'true'
  )
    throw Error('Isolated fixture required');
  const id = 'radial_review_' + Date.now();
  const checks = [];
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
  const pause = (ms) => new Promise((r) => setTimeout(r, ms ?? 180));
  const until = async (expression, message) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate(expression)) {
        checks.push(message);
        return;
      }
      await pause();
    }
    console.error(
      'Review failure',
      message,
      await evaluate(
        `({text:document.body.innerText,canvas:document.querySelector('canvas')?.getBoundingClientRect().toJSON(),parent:document.querySelector('canvas')?.parentElement.getBoundingClientRect().toJSON()})`,
      ),
    );
    throw Error(message);
  };
  const request = async (path, value, method = 'POST') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!r.ok) throw Error(await r.text());
    return r.json();
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = async (expr, modifiers = 0) => {
    const p = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing target');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2};})()`,
    );
    await pointer('down', p, modifiers, true);
    await pointer('up', p, modifiers, true);
    await pause();
  };
  const pointer = async (type, p, modifiers = 0, mouse = false) =>
    width < 768 && !mouse
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
          modifiers,
          button: 'left',
          buttons: type === 'up' ? 0 : 1,
          clickCount: 1,
        });
  const key = async (key, code) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: key,
      windowsVirtualKeyCode: code,
    });
    await pause();
  };
  const shot = async (suffix) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/radial-history-${width}-${suffix}.png`,
      Buffer.from(r.data, 'base64'),
    );
  };
  const grid = {
    width: 20,
    height: 12,
    tileSize: 32,
    deviceScale: 1,
    labelMode: 'all',
    tiles: Array.from({ length: 12 }, (_, y) =>
      Array.from({ length: 20 }, (_, x) =>
        x === 0 || y === 0 || x === 19 || y === 11 ? 'wall' : 'floor',
      ),
    ),
    devices: [
      ['living_room_lamp', 3, 3],
      ['living_room_floor_lamp', 8, 8],
      ['living_room_motion', 6, 5],
    ].map(([key, x, y]) => ({
      deviceKey: 'zigbee2mqtt/' + key,
      deviceName: key,
      x,
      y,
    })),
    groups: {},
  };
  grid.devices.push(
    {
      deviceKey: 'dummy/review_number',
      deviceName: 'Review number',
      x: 12,
      y: 3,
    },
    {
      deviceKey: 'dummy/review_dimmer',
      deviceName: 'Review dimmer',
      x: 15,
      y: 8,
    },
  );
  await request(
    `/api/v1/config/floorplans/${id}/editor`,
    {
      id,
      name: 'Radial review',
      grid_data: JSON.stringify(grid),
      image: { kind: 'none' },
      create_only: true,
    },
    'PUT',
  );
  const now = Date.now();
  const motion = (
    await (await fetch(base + '/api/v1/devices')).json()
  ).devices.find((d) => d.id === 'living_room_motion');
  await request('/api/__fixture/sensor-history', {
    devices: [
      { ...motion, data: { Sensor: { value: false } } },
      {
        id: 'review_number',
        name: 'Review number',
        integration_id: 'dummy',
        data: { Sensor: { value: 21.5 } },
        raw: null,
      },
      {
        id: 'review_dimmer',
        name: 'Review dimmer',
        integration_id: 'dummy',
        data: { Sensor: { value: 'off_press' } },
        raw: null,
      },
    ],
    configs: [
      {
        device_ref: 'dummy/review_dimmer',
        interaction_kind: 'hue_dimmer',
        config: { up_value: 'raise', down_value: 'lower' },
      },
    ],
    entries: Array.from({ length: 12 }, (_, i) => ({
      id: i + 1,
      source_key: i % 2 ? 'zigbee2mqtt/living_room_motion' : 'fixture/climate',
      changed_at_ms: now - (12 - i) * 60000,
      value:
        i % 2
          ? Boolean(i % 4 === 1)
          : { temperature: 20 + i / 4, humidity: 40 + i },
    })),
  });
  try {
    await cdp.send('Page.navigate', { url: base + '/map' });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${button('Radial review')}`,
      'Scrolling floorplan tabs available',
    );
    await click(button('Radial review'));
    await until(`!!document.querySelector('canvas')`, 'Map renders');
    const sameRow = await evaluate(
      `(()=>{const a=document.getElementById('floorplan-tabs').getBoundingClientRect(),b=document.querySelector('[aria-label="Ask AI"]').getBoundingClientRect();return Math.abs(a.top-b.top)<8&&a.right<=b.left+1&&document.documentElement.scrollWidth<=innerWidth+1;})()`,
    );
    if (!sameRow) throw Error('Tabs must share AppBar before assistant');
    checks.push('Tabs share AppBar before assistant without overflow');
    const point = async (x = 3, y = 3) => {
      await pause(350);
      return evaluate(
        `(()=>{const r=document.querySelector('canvas').getBoundingClientRect(),s=.86*Math.min(r.width/640,r.height/384);return{x:r.left+(r.width-640*s)/2+(${x}*32+16)*s,y:r.top+(r.height-384*s)/2+(${y}*32+16)*s};})()`,
      );
    };
    const commands = async () =>
      (await (await fetch(base + '/api/__fixture/live-controls')).json())
        .commands;
    const before = (await commands()).length;
    const pop = `document.querySelector('[aria-label="Living room lamp quick controls"]')`;
    let p = await point();
    await pointer('down', p);
    await pause(620);
    await until(`!!${pop}`, 'Hold opens radial control');
    await pointer('up', p);
    await until(
      `!!${pop}&&!document.body.innerText.includes('1 selected')`,
      'Release keeps radial open without selection',
    );
    if ((await commands()).length !== before)
      throw Error('Opening sent a command');
    await pause(250);
    const center = await evaluate(
      `(()=>{const r=${pop}.querySelector('.relative.rounded-full').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await shot('light');

    if (
      !(await evaluate(
        `(()=>{const title=${pop}.querySelector('p'),arc=${pop}.querySelector('[data-brightness-arc]'),power=${pop}.querySelector('button[aria-label^="Turn "]');return getComputedStyle(title).backgroundColor!=='rgba(0, 0, 0, 0)'&&!${pop}.textContent.includes('Inner circle:')&&getComputedStyle(arc).color===getComputedStyle(power).backgroundColor})()`,
      ))
    )
      throw Error('Radial title or shared light color');
    checks.push(
      'Title has a background; brightness ring and power button use the light color',
    );

    await request('/api/__fixture/live-controls', { delay: 400 });
    const liveBefore = (await commands()).length;
    await pointer('down', { x: center.x + 119, y: center.y });
    await pause(180);
    if ((await commands()).length !== liveBefore + 1)
      throw Error('Brightness must apply while held');
    await pointer('move', { x: center.x, y: center.y + 119 });
    await pause(70);
    await pointer('move', { x: center.x - 119, y: center.y });
    await evaluate(
      `window.__radialLevels=[];window.__radialLevelTimer=setInterval(()=>window.__radialLevels.push(${pop}.querySelector('[aria-label="Living room lamp brightness"]').getAttribute('aria-valuenow')),16)`,
    );
    await pointer('up', { x: center.x - 119, y: center.y });
    await pause(900);
    const liveBrightness = await evaluate(
      `(()=>{clearInterval(window.__radialLevelTimer);return window.__radialLevels.every(v=>v==='75')})()`,
    );
    if (
      !liveBrightness ||
      (await commands()).at(-1)?.DeviceCommand?.brightness !== 0.75 ||
      (await commands()).length !== liveBefore + 2
    )
      throw Error('Live brightness coalescing or stale acknowledgement jump');
    checks.push(
      'Held brightness applies immediately and coalesces a slow acknowledgement into the latest value',
    );
    checks.push(
      'Brightness remains steady across release and delayed older acknowledgements',
    );
    await request('/api/__fixture/live-controls', { delay: 0 });

    await pointer('down', { x: center.x, y: center.y - 119 });
    await pointer('move', { x: center.x + 119, y: center.y });
    await pointer('up', { x: center.x + 119, y: center.y });
    await pause(300);
    if ((await commands()).at(-1)?.DeviceCommand?.brightness !== 0.25)
      throw Error('Radial brightness commit');
    checks.push('Outer ring flushes the final brightness on release');
    await click(`document.querySelector('[aria-label="Hue and saturation"]')`);
    await pointer('down', { x: center.x + 70, y: center.y });
    await pointer('up', { x: center.x + 70, y: center.y });
    await pause(300);
    const color = (await commands()).at(-1)?.DeviceCommand?.color;
    if (!color || !('h' in color) || color.s < 0.5)
      throw Error('Hue saturation command');
    checks.push('Inner circle controls hue and saturation');
    await shot('color');

    for (const density of ['compact', 'comfortable']) {
      await evaluate(
        `document.documentElement.dataset.density=${JSON.stringify(density)}`,
      );
      await pause();
      for (const angle of [45, 135, 225, 315]) {
        const radians = (angle * Math.PI) / 180 - Math.PI / 2;
        const position = {
          x: center.x + Math.cos(radians) * 84,
          y: center.y + Math.sin(radians) * 84,
        };
        await pointer('down', position);
        await pointer('up', position);
        await pause();
        const geometry = await evaluate(
          `(()=>{const wheel=${pop}.querySelector('[aria-label="Living room lamp hue and saturation"]').getBoundingClientRect(),dot=${pop}.querySelector('[data-color-indicator]').getBoundingClientRect();return {diameter:wheel.width,center:Math.hypot(wheel.x+wheel.width/2-${center.x},wheel.y+wheel.height/2-${center.y}),extent:Math.hypot(dot.x+dot.width/2-wheel.x-wheel.width/2,dot.y+dot.height/2-wheel.y-wheel.height/2)+dot.width/2}})()`,
        );
        if (
          Math.abs(geometry.diameter - 192) > 0.5 ||
          geometry.center > 0.5 ||
          geometry.extent > 92.5
        )
          throw Error(
            'Hue geometry ' + density + ': ' + JSON.stringify(geometry),
          );
      }
      checks.push(
        density +
          ' density: centered 192 px hue wheel and indicator within its color surface in all four quadrants',
      );
    }
    await evaluate(`document.documentElement.dataset.density='compact'`);
    await request('/api/__fixture/live-controls', { delay: 400 });
    const colorBefore = (await commands()).length;
    await pointer('down', { x: center.x + 84, y: center.y });
    await pause(180);
    if ((await commands()).length !== colorBefore + 1)
      throw Error('Color must apply while held');
    const dot = await evaluate(
      `${pop}.querySelector('[data-color-indicator]').style.cssText`,
    );
    await pointer('up', { x: center.x + 84, y: center.y });
    await pause(70);
    if (
      (await evaluate(
        `${pop}.querySelector('[data-color-indicator]').style.cssText`,
      )) !== dot
    )
      throw Error('Color jumped before acknowledgement');
    await pause(450);
    if (
      (await evaluate(
        `${pop}.querySelector('[data-color-indicator]').style.cssText`,
      )) !== dot
    )
      throw Error('Color jumped after acknowledgement');
    if (
      !(await evaluate(
        `(()=>{const dot=${pop}.querySelector('[data-color-indicator]'),arc=${pop}.querySelector('[data-brightness-arc]'),power=${pop}.querySelector('button[aria-label^="Turn "]');return getComputedStyle(dot).backgroundColor===getComputedStyle(arc).color&&getComputedStyle(arc).color===getComputedStyle(power).backgroundColor})()`,
      ))
    )
      throw Error('Selected color is not shared');
    checks.push(
      'Hue applies while held and stays steady across release and acknowledgement',
    );
    checks.push(
      'Selected hue immediately colors the indicator, brightness arc and power button',
    );
    await shot('live-color');
    await request('/api/__fixture/live-controls', { delay: 0 });
    await pointer('down', { x: center.x, y: center.y + 84 });
    await pause(220);
    await pointer('up', { x: center.x, y: center.y + 84 });
    await pause();
    const updatedDevice = (
      await (await fetch(base + '/api/v1/devices')).json()
    ).devices.find((device) => device.id === 'living_room_lamp');
    updatedDevice.data.Controllable.state.color = { h: 240, s: 0.5 };
    updatedDevice.data.Controllable.state.brightness = 0.55;
    await request('/api/v1/devices/living_room_lamp', updatedDevice, 'PUT');
    await until(
      `${pop}.querySelector('[aria-label="Living room lamp hue and saturation"]').getAttribute('aria-valuenow')==='240'&&${pop}.querySelector('[aria-label="Living room lamp brightness"]').getAttribute('aria-valuenow')==='55'`,
      'After a held value is confirmed, later device updates remain visible',
    );
    await click(`document.querySelector('[aria-label="Color temperature"]')`);
    await evaluate(
      `document.querySelector('[aria-label="Living room lamp color temperature"]').focus()`,
    );
    await key('ArrowRight', 39);
    if (!('ct' in ((await commands()).at(-1)?.DeviceCommand?.color ?? {})))
      throw Error('Temperature command');
    checks.push('Color temperature mode and keyboard adjustment');
    await shot('temperature');
    await pointer('down', { x: width - 5, y: 100 });
    await pointer('up', { x: width - 5, y: 100 });
    await until(`!${pop}`, 'Outside tap dismisses radial');
    p = await point();
    await pointer('down', p);
    await pause(850);
    await until(`!!${pop}`, 'Direct hold drag reopens radial');
    await pointer('move', { x: center.x + 119, y: center.y });
    await pointer('up', { x: center.x + 119, y: center.y });
    await pause(300);
    if ((await commands()).at(-1)?.DeviceCommand?.brightness !== 0.25)
      throw Error('Direct hold drag brightness');
    checks.push('Hold and drag commits brightness and stays open');
    if (width < 768) {
      const count = (await commands()).length;
      await pointer('down', { x: center.x + 119, y: center.y });
      await pointer('move', { x: center.x, y: center.y + 119 });
      await pointer('cancel', center);
      await pause();
      if ((await commands()).length !== count)
        throw Error('Cancelled gesture sent command');
      checks.push('Cancelled touch discards brightness draft');
    }
    await key('Escape', 27);
    await until(`!${pop}`, 'Escape dismisses radial');
    p = await point();
    await pointer('down', p);
    await pointer('up', p);
    await until(
      `!!document.querySelector('[aria-label="Floorplan inspector"]')`,
      'Tap opens full device sheet',
    );
    p = await point(8, 8);
    await pointer('down', p);
    await pause(620);
    await pointer('up', p);
    await until(
      `document.body.innerText.includes('2 selected')&&!${pop}`,
      'Hold with sheet enters selection and preserves first light',
    );
    p = await point();
    await pointer('down', p);
    await pointer('up', p);
    await until(
      `document.body.innerText.includes('1 selected')`,
      'Tap deselects in selection mode',
    );
    p = await point(8, 8);
    await pointer('down', p);
    await pointer('up', p);
    await until(
      `!document.querySelector('[aria-label="Floorplan inspector"]')&&!document.body.innerText.includes('1 selected')`,
      'Last deselection exits mode',
    );
    if (width >= 768) {
      p = await point();
      await pointer('down', p, 2);
      await pointer('up', p, 2);
      await until(
        `document.body.innerText.includes('1 selected')`,
        'Ctrl click immediately selects',
      );
      await pointer('down', await point(), 2);
      await pointer('up', await point(), 2);
      await pause();
    }
    p = await point(12, 3);
    await pointer('down', p);
    await pause(620);
    await pointer('up', p);
    await until(
      `!!document.querySelector('[aria-label="Sensor numeric value"]')`,
      'Numeric sensor quick control opens',
    );
    await click(
      `document.querySelector('[aria-label="Increase sensor value"]')`,
    );
    await pause(200);
    if (
      (await (await fetch(base + '/api/v1/devices')).json()).devices.find(
        (d) => d.id === 'review_number',
      ).data.Sensor.value !== 22.5
    )
      throw Error('Numeric sensor event');
    checks.push('Numeric stepper sends an unrestricted numeric event');
    await shot('sensor-number');
    await click(
      `document.querySelector('[aria-label="Close sensor quick controls"]')`,
    );
    p = await point(15, 8);
    await pointer('down', p);
    await pause(620);
    await pointer('up', p);
    await until(
      `!!document.querySelector('[aria-label="Send up sensor event"]')`,
      'Dimmer vertical quick controls open',
    );
    await click(
      `document.querySelector('[aria-label="Send up sensor event"]')`,
    );
    await pause(200);
    if (
      (await (await fetch(base + '/api/v1/devices')).json()).devices.find(
        (d) => d.id === 'review_dimmer',
      ).data.Sensor.value !== 'raise'
    )
      throw Error('Configured dimmer event');
    checks.push('Dimmer uses configured event values');
    await shot('sensor-dimmer');
    await click(
      `document.querySelector('[aria-label="Close sensor quick controls"]')`,
    );
    p = await point(6, 5);
    await pointer('down', p);
    await pause(620);
    await pointer('up', p);
    await until(
      `!!document.querySelector('[aria-label="Living room motion sensor quick controls"]')`,
      'Sensor hold opens quick controls',
    );
    await shot('sensor');
    await click(
      `document.querySelector('[aria-label="Set Living room motion on"]')`,
    );
    await pause(300);
    await until(
      `!document.querySelector('[role="alert"]')`,
      'Sensor simulated event accepted',
    );
    await click(button('Sensor details'));
    await until(
      `document.body.innerText.includes('Last changed')&&!!document.querySelector('svg[aria-label="Value history"]')`,
      'Sensor sheet shows persisted boolean step history',
    );
    await shot('history-sheet');
    await cdp.send('Page.navigate', {
      url: base + '/config/sensor-history?sensor=fixture%2Fclimate',
    });
    await until(
      `!!document.querySelector('svg[aria-label="temperature history"]')&&!!document.querySelector('svg[aria-label="humidity history"]')`,
      'Filtered history shows multiple sensor values',
    );
    if (await evaluate(`document.documentElement.scrollWidth>innerWidth+1`))
      throw Error('History horizontal overflow');
    await shot('history');
    await cdp.send('Page.navigate', { url: base + '/config' });
    await until(
      `document.querySelectorAll('.settings-section-list').length===4`,
      'Settings landing uses flat navigation lists',
    );
    await shot('settings');
    await evaluate(
      `document.querySelector('.settings-section-list').scrollIntoView({block:'start'})`,
    );
    await pause();
    await shot('settings-lists');
    return { passed: true, width, checks };
  } catch (e) {
    await shot('failure');
    throw e;
  } finally {
    await request('/api/__fixture/live-controls', { delay: 0, reject: false });
    await fetch(base + `/api/v1/config/floorplans/${id}`, { method: 'DELETE' });
  }
}
