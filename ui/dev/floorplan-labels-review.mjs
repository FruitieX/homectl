/** Labels, saved defaults and settings navigation against loopback fixtures. */
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
  const id = 'labels_review_' + Date.now(),
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
  const until = async (expression, name) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate(expression)) {
        checks.push(name);
        return;
      }
      await pause();
    }
    throw Error(name);
  };
  const click = async (expression) => {
    const p = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Missing target');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...p,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await pause();
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/floorplan-labels-${width}-${name}.png`,
      Buffer.from(r.data, 'base64'),
    );
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
  const rect = (w, h, x, y) =>
    Array.from({ length: h }, (_, dy) =>
      Array.from({ length: w }, (_, dx) => ({ x: x + dx, y: y + dy })),
    ).flat();
  const grid = {
    width: 16,
    height: 12,
    tileSize: 32,
    deviceScale: 1,
    labelMode: 'all',
    tiles: Array.from({ length: 12 }, () => Array(16).fill('floor')),
    devices: [
      {
        deviceKey: 'zigbee2mqtt/living_room_lamp',
        deviceName: 'Living room lamp',
        x: 3,
        y: 7,
      },
      {
        deviceKey: 'zigbee2mqtt/living_room_motion',
        deviceName: 'Living room motion',
        x: 11,
        y: 7,
      },
    ],
    groups: { [id]: [...rect(4, 2, 1, 1), ...rect(7, 7, 1, 3)] },
  };
  await request('/api/v1/config/groups', {
    id,
    name: 'Living room and reading corner by the upstairs window and bookcase',
    hidden: false,
    devices: [{ integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' }],
    linked_groups: [],
  });
  await request(
    `/api/v1/config/floorplans/${id}/editor`,
    {
      id,
      name: 'Label wrapping review',
      grid_data: JSON.stringify(grid),
      image: { kind: 'none' },
      create_only: true,
    },
    'PUT',
  );
  try {
    await cdp.send('Page.bringToFront');
    await cdp.send('Page.navigate', { url: base + '/config' });
    await until(
      `!!document.querySelector('a[href="/config/groups"]')`,
      'Settings categories loaded',
    );
    await until(
      `(()=>{const links=[...document.querySelectorAll('.settings-section-list a[href^="/config/"]')].filter(a=>a.querySelector('.text-sm.font-medium'));return links.length===18&&links.every(a=>a.querySelector('svg[aria-hidden]'))})()`,
      'Every settings landing category has an icon',
    );
    if (width < 1024) {
      await click(
        `document.querySelector('button[aria-label="Open navigation"]')`,
      );
    }
    await until(
      `(()=>{const nav=[...document.querySelectorAll('nav[aria-label="Settings categories"]')].find(n=>n.getBoundingClientRect().width>0);return nav&&nav.querySelectorAll('a').length===19&&[...nav.querySelectorAll('a')].every(a=>a.querySelector('svg[aria-hidden]'))})()`,
      'Every settings sidebar/mobile menu item has an icon',
    );
    if (width < 1024)
      await evaluate(
        `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
      );
    await shot('settings-icons');
    await cdp.send('Page.navigate', {
      url: base + '/config/floorplan?id=' + id,
    });
    await until(
      `!!document.querySelector('canvas')`,
      'Label fixture loaded in editor',
    );
    await shot('editor-wrapped');
    await click(`document.querySelector('[aria-label="Layout tool"]')`);
    const row = `document.querySelector('[aria-label="Editor library"] [role="group"][aria-label="Labels"]')`;
    const toggle = (name) =>
      `[...${row}.querySelectorAll('button')].find(b=>b.textContent.trim()==='${name}')`;
    await until(
      `!!${row}`,
      'Editor offers independent labels for lights, sensors and groups',
    );
    for (const name of ['Lights', 'Groups']) await click(toggle(name));
    await click(button('Save'));
    await until(
      `document.querySelector('.settings-savebar').dataset.dirty==='false'`,
      'Label defaults saved',
    );
    const saved = (
      await (
        await fetch(base + `/api/v1/config/floorplans/${id}/editor`)
      ).json()
    ).data;
    const labels = JSON.parse(saved.grid_data).labelVisibility;
    if (
      labels.lights !== false ||
      labels.sensors !== true ||
      labels.groups !== false
    )
      throw Error('Saved labels lost independent values');
    checks.push(
      'Editor stores the independent defaults through the floorplan API',
    );
    await cdp.send('Page.reload');
    await pause(500);
    await until(`!!document.querySelector('canvas')`, 'Saved editor reopened');
    await click(`document.querySelector('[aria-label="Layout tool"]')`);
    await until(
      `${toggle('Lights')}.getAttribute('aria-pressed')==='false'&&${toggle('Sensors')}.getAttribute('aria-pressed')==='true'&&${toggle('Groups')}.getAttribute('aria-pressed')==='false'`,
      'Reload preserves all three label defaults',
    );
    await click(toggle('Groups'));
    await click(button('Save'));
    await until(
      `document.querySelector('.settings-savebar').dataset.dirty==='false'`,
      'Group labels enabled and saved',
    );
    if (width < 900)
      await click(`document.querySelector('[aria-label="Close library"]')`);
    await shot('editor-defaults');
    await cdp.send('Page.navigate', { url: base + '/map' });
    await until(
      `!!${button('Label wrapping review')}`,
      'New floorplan appears in map tabs',
    );
    await click(button('Label wrapping review'));
    await until(
      `!!document.querySelector('canvas')`,
      'Map displays wrapped room label',
    );
    await pause(400);
    await shot('map-wrapped');
    await click(
      `document.querySelector('[aria-label="Floorplan view options"]')`,
    );
    const labelsRow = `document.querySelector('[role="group"][aria-label="Labels"]')`;
    await until(
      `(()=>{const b=[...${labelsRow}.querySelectorAll('button')];return b[0].getAttribute('aria-pressed')==='false'&&b[1].getAttribute('aria-pressed')==='true'&&b[2].getAttribute('aria-pressed')==='true'})()`,
      'Map inherits saved light, sensor and group label defaults',
    );
    const visibleRow = `document.querySelector('[role="group"][aria-label="Show on floorplan"]')`;
    await click(
      `[...${visibleRow}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Groups')`,
    );
    await until(
      `!!${visibleRow}&&${visibleRow}.querySelectorAll('button')[2].getAttribute('aria-pressed')==='false'&&${labelsRow}.querySelectorAll('button')[2].getAttribute('aria-pressed')==='true'`,
      'Hiding groups preserves their separate label preference and keeps options open',
    );
    await shot('map-options');
    return { passed: true, width, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await fetch(base + `/api/v1/config/floorplans/${id}`, { method: 'DELETE' });
    await fetch(base + `/api/v1/config/groups/${id}`, { method: 'DELETE' });
  }
}
