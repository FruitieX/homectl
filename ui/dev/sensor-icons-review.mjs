/** Visual review against the isolated loopback fixture only. */
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
  const id = 'sensor_icons_' + Date.now(),
    checks = [];
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
  const pause = (ms = 180) => new Promise((r) => setTimeout(r, ms));
  const until = async (expr, message) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate(`Boolean(${expr})`)) {
        checks.push(message);
        return;
      }
      await pause();
    }
    throw Error(message);
  };
  const request = async (path, value, method = 'POST') => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!response.ok) throw Error(await response.text());
    return response.json();
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const pointer = (type, p) =>
    width < 768
      ? cdp.send('Input.dispatchTouchEvent', {
          type: type === 'down' ? 'touchStart' : 'touchEnd',
          touchPoints: type === 'down' ? [{ ...p, id: 1 }] : [],
        })
      : cdp.send('Input.dispatchMouseEvent', {
          type: type === 'down' ? 'mousePressed' : 'mouseReleased',
          ...p,
          button: 'left',
          buttons: type === 'down' ? 1 : 0,
          clickCount: 1,
        });
  const click = async (expr) => {
    const p = await evaluate(
      `(()=>{const r=(${expr}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await pointer('down', p);
    await pointer('up', p);
    await pause();
  };
  const shot = async (suffix) => {
    await pause(400);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/sensor-icons-${width}-${suffix}.png`,
      Buffer.from(r.data, 'base64'),
    );
  };
  const cases = [
    ['On/off', true, 'boolean', 2, 2],
    ['Push button', 'off', 'button_events', 6, 2],
    ['Dimmer', 'off_press', 'hue_dimmer', 10, 2],
    ['Number input', 21.5, 'number', 13, 2],
    ['Text event', 'custom', 'text', 2, 6],
    ['Color state', null, 'state', 7, 6],
    ['Switch buttons', 'on', 'on_off_buttons', 12, 6],
  ];
  const previousConfigs = (
    await (await fetch(base + '/api/v1/config/device-sensor-configs')).json()
  ).data;
  const devices = cases.map(([name, value, kind], i) => ({
    id: id + '_' + i,
    name,
    integration_id: 'dummy',
    data: {
      Sensor:
        kind === 'state'
          ? { power: true, brightness: 0.5, color: null, transition: null }
          : { value },
    },
    raw: null,
  }));
  const configs = cases.map(([, , interaction_kind], i) => ({
    device_ref: 'dummy/' + devices[i].id,
    interaction_kind,
    config: {},
  }));
  const grid = {
    width: 16,
    height: 10,
    tileSize: 32,
    deviceScale: 1,
    labelMode: 'all',
    tiles: Array.from({ length: 10 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) =>
        x === 0 || y === 0 || x === 15 || y === 9 ? 'wall' : 'floor',
      ),
    ),
    devices: cases.map(([deviceName, , , x, y], i) => ({
      deviceKey: 'dummy/' + devices[i].id,
      deviceName,
      x,
      y,
    })),
    groups: {},
  };
  await request('/api/__fixture/sensor-history', {
    devices,
    configs: [...previousConfigs, ...configs],
  });
  await request('/api/v1/config/groups', {
    id,
    name: 'Sensor icon review',
    hidden: false,
    devices: devices.map((device) => ({
      integration_id: 'dummy',
      device_id: device.id,
    })),
    linked_groups: [],
  });
  await request(
    `/api/v1/config/floorplans/${id}/editor`,
    {
      id,
      name: 'Sensor icons',
      grid_data: JSON.stringify(grid),
      image: { kind: 'none' },
      create_only: true,
    },
    'PUT',
  );
  try {
    await cdp.send('Page.navigate', { url: base + '/map' });
    await until(`!!${button('Sensor icons')}`, 'Sensor floorplan available');
    await click(button('Sensor icons'));
    await until(`!!document.querySelector('canvas')`, 'Sensor map renders');
    await pause(700);
    await shot('map');
    const p = await evaluate(
      `(()=>{const r=document.querySelector('canvas').getBoundingClientRect(),s=.86*Math.min(r.width/512,r.height/320);return{x:r.left+(r.width-512*s)/2+(6*32+16)*s,y:r.top+(r.height-320*s)/2+(2*32+16)*s}})()`,
    );
    await pointer('down', p);
    await pause(650);
    await pointer('up', p);
    await until(
      `!!document.querySelector('[aria-label="Push button sensor quick controls"]')`,
      'Button icon retains long-press quick controls',
    );
    await until(
      `!!document.querySelector('[aria-label="Send Press sensor event"]')`,
      'Saved button mapping remains available when current event is off',
    );
    await shot('quick');
    await click(
      `document.querySelector('[aria-label="Close sensor quick controls"]')`,
    );
    await cdp.send('Page.navigate', {
      url: base + '/config/floorplan?id=' + id,
    });
    await until(
      `!!document.querySelector('canvas[data-zoom]')`,
      'Editor renders matching sensor glyphs',
    );
    await shot('editor');
    await cdp.send('Page.navigate', { url: base + '/groups/' + id });
    await until(
      `document.querySelectorAll('svg[role="img"] g[stroke="#d7eee6"]').length===7`,
      'Room preview renders seven matching vector icons',
    );
    await shot('preview');
    return { passed: true, width, checks };
  } finally {
    await request('/api/__fixture/sensor-history', {
      configs: previousConfigs,
    });
    await fetch(base + `/api/v1/config/groups/${id}`, { method: 'DELETE' });
    await fetch(base + `/api/v1/config/floorplans/${id}`, { method: 'DELETE' });
  }
}
