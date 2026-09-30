import { writeFile } from 'node:fs/promises';

export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  if (!url.startsWith(origin + '/')) throw Error('Fixture required');
  const marker = await fetch(origin + '/api/v1/config/groups');
  if (marker.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Marked fixture required');
  const id = 'map_group_' + Date.now(),
    child = id + '_child';
  const state = (await (await fetch(origin + '/api/v1/devices')).json())
    .devices;
  const changed = state.filter((d) =>
    ['living_room_lamp', 'living_room_floor_lamp', 'bedroom_lamp'].includes(
      d.id,
    ),
  );
  const request = async (path, body, method = 'POST') => {
    const r = await fetch(origin + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw Error(await r.text());
    return r.json();
  };
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
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(name);
  };
  const checks = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = async (expr) => {
    const p = await evaluate(
      `(()=>{const e=${expr};e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      clickCount: 1,
    });
    await pause();
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/map-group-${width}-${name}.png`,
      Buffer.from(r.data, 'base64'),
    );
  };
  const commands = async () =>
    (await (await fetch(origin + '/api/__fixture/live-controls')).json())
      .commands;
  const canvas = `document.querySelector('canvas')`;
  try {
    for (const d of changed) {
      const next = structuredClone(d);
      if (d.id === 'bedroom_lamp') next.data.Controllable.disabled = true;
      if (d.id === 'living_room_floor_lamp')
        next.data.Controllable.managed = 'FullReadOnly';
      next.data.Controllable.state.power = true;
      await request('/api/v1/devices/' + d.id, next, 'PUT');
    }
    await request('/api/v1/config/groups', {
      id: child,
      name: 'Map child',
      hidden: true,
      devices: changed.map((d) => ({
        integration_id: d.integration_id,
        device_id: d.id,
      })),
      linked_groups: [],
    });
    await request('/api/v1/config/groups', {
      id,
      name: 'Map review room',
      hidden: false,
      devices: [
        { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' },
        { integration_id: 'dummy', device_id: 'missing_review' },
      ],
      linked_groups: [child],
    });
    const grid = {
      width: 20,
      height: 12,
      tileSize: 32,
      deviceScale: 1,
      labelMode: 'all',
      tiles: Array.from({ length: 12 }, (_, y) =>
        Array.from({ length: 20 }, (_, x) =>
          !x || !y || x === 19 || y === 11 ? 'wall' : 'floor',
        ),
      ),
      devices: [
        ...changed.map((d, i) => ({
          deviceKey: d.integration_id + '/' + d.id,
          deviceName: d.name,
          x: 3 + i * 6,
          y: 4 + i * 2,
        })),
        {
          deviceKey: 'zigbee2mqtt/kitchen_ceiling',
          deviceName: 'Outside room',
          x: 12,
          y: 3,
        },
      ],
      groups: { [id]: [{ x: 1, y: 1 }] },
    };
    await request(
      `/api/v1/config/floorplans/${id}/editor`,
      {
        id,
        name: 'Map group review',
        grid_data: JSON.stringify(grid),
        image: { kind: 'none' },
        create_only: true,
      },
      'PUT',
    );
    // Health is injected into this browser only; the shared evaluator's contract is unchanged.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `const mapFetch=window.fetch.bind(window);window.fetch=async(input,init)=>{const r=await mapFetch(input,init);if(String(input).endsWith('/config/device-health')){const j=await r.clone().json();j.data.devices['zigbee2mqtt/living_room_floor_lamp'].status='offline';return new Response(JSON.stringify(j),{status:r.status,headers:r.headers});}return r;};`,
    });
    await cdp.send('Page.navigate', {
      url: origin + `/groups/${id}?view=floorplan`,
    });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${canvas} && !!document.querySelector('[aria-label="Floorplan inspector"]')`,
      'Group map ready',
    );
    await check(
      'Nested group inspector shows scope and unavailable member',
      `document.querySelector('#floorplan-inspector').textContent.includes('Map review room') && document.querySelector('#floorplan-inspector').textContent.includes('missing_review') && document.querySelector('#floorplan-inspector').textContent.includes('2 disabled or read-only')`,
    );
    await check(
      'Related room controls and settings links preserve group identity',
      `[...document.querySelectorAll('#floorplan-inspector a')].some(a=>a.textContent==='Room details'&&a.pathname==='/groups/${id}') && [...document.querySelectorAll('#floorplan-inspector a')].some(a=>a.textContent==='Room settings'&&a.href.includes('${id}'))`,
    );
    await check(
      'Group inspector has no unrelated kitchen controls',
      `!document.querySelector('#floorplan-inspector').textContent.includes('Kitchen')`,
    );
    await check(
      'Floorplan tabs do not overlap the room breadcrumb',
      `(()=>{const a=document.querySelector('nav[aria-label="Breadcrumb"]').getBoundingClientRect(),b=document.querySelector('#floorplan-tabs').getBoundingClientRect();return a.bottom<=b.top+1||a.right<=b.left+1})()`,
    );
    await shot('group');
    await request('/api/__fixture/live-controls', {
      clear: true,
      reject: false,
      delay: 700,
    });
    await click(button('Off'));
    await check(
      'Group command remains pending until acknowledged',
      `${button('Off')}.disabled && ${button('Off')}.getAttribute('aria-busy')==='true'`,
    );
    await until(`!${button('Off')}.disabled`, 'Group acknowledgment');
    let sent = await commands();
    if (
      sent.length !== 1 ||
      sent[0].DeviceCommand?.device_key !== 'zigbee2mqtt/living_room_lamp' ||
      sent[0].DeviceCommand?.power !== false
    )
      throw Error('Group scope incorrect');
    checks.push({
      name: 'Group commands deduplicate nested members and exclude unavailable, disabled and read-only devices',
      passed: true,
    });
    await click(`document.querySelector('[aria-label="Close controls"]')`);
    await check(
      'Room inspector closes without leaving map',
      `!document.querySelector('[aria-label="Floorplan inspector"]') && location.pathname==='/groups/${id}'`,
    );
    await shot('markers');
    await cdp.send('Page.navigate', { url: origin + '/map' });
    await until(
      `!!${button('Map group review')}`,
      'Main floorplan tabs loaded',
    );
    await click(button('Map group review'));
    await until(`!!${canvas}`, 'Main floorplan canvas loaded');
    await pause();
    const groupPoint = async () =>
      evaluate(
        `(()=>{const r=${canvas}.getBoundingClientRect(),s=.86*Math.min(r.width/640,r.height/384);return{x:r.left+(r.width-640*s)/2+48*s,y:r.top+(r.height-384*s)/2+48*s}})()`,
      );
    const groupGesture = async (hold = false) => {
      const p = await groupPoint();
      if (width < 768) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchStart',
          touchPoints: [{ ...p, id: 1 }],
        });
        if (hold) await new Promise((r) => setTimeout(r, 650));
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchEnd',
          touchPoints: [],
        });
      } else {
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mousePressed',
          ...p,
          button: 'left',
          buttons: 1,
          clickCount: 1,
        });
        if (hold) await new Promise((r) => setTimeout(r, 650));
        await cdp.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          ...p,
          button: 'left',
          buttons: 0,
          clickCount: 1,
        });
      }
      await pause();
    };
    const commandsBeforeGroupTap = (await commands()).length;
    await groupGesture();
    await until(
      `!!document.querySelector('[aria-label="Floorplan inspector"]')`,
      'Group tap opens controls',
    );
    await check(
      'Group tap keeps the main map route and opens room controls',
      `location.pathname==='/map'&&document.querySelector('#floorplan-inspector').textContent.includes('Map review room')`,
    );
    await check(
      'Group tap exposes nested members and a direct Room details link',
      `document.querySelector('#floorplan-inspector').textContent.includes('missing_review')&&[...document.querySelectorAll('#floorplan-inspector a')].some(a=>a.textContent==='Room details'&&a.pathname==='/groups/${id}')`,
    );
    if ((await commands()).length !== commandsBeforeGroupTap)
      throw Error('Opening group must not command devices');
    checks.push({
      name: 'Opening group controls sends no device commands',
      passed: true,
    });
    await shot('tap-group');
    await groupGesture(true);
    await until(
      `document.body.innerText.includes('4 selected')`,
      'Group hold selects nested members',
    );
    await check(
      'Long press selects group devices without navigating or leaving the group panel open',
      `location.pathname==='/map'&&![...document.querySelectorAll('#floorplan-inspector a')].some(a=>a.textContent==='Room details')`,
    );
    await shot('group-selection');
    await click(button('Done'));
    await until(
      `!document.body.innerText.includes('4 selected')`,
      'Group selection finished',
    );
    await groupGesture();
    await until(
      `document.querySelector('#floorplan-inspector').textContent.includes('Map review room')`,
      'Group panel reopens after selection',
    );
    await check(
      'Ending selection restores ordinary tap-to-open behavior',
      `location.pathname==='/map'`,
    );
    await click(`document.querySelector('[aria-label="Close controls"]')`);
    await check(
      'Group controls close while retaining the main floorplan',
      `location.pathname==='/map'&&!document.querySelector('[aria-label="Floorplan inspector"]')`,
    );
    await groupGesture();
    await until(
      `!!document.querySelector('#floorplan-inspector a[href="/groups/${id}"]')`,
      'Room details link available',
    );
    await click(
      `document.querySelector('#floorplan-inspector a[href="/groups/${id}"]')`,
    );
    await until(
      `location.pathname==='/groups/${id}'&&!location.search.includes('floorplan')`,
      'Room details navigation',
    );
    await check(
      'Room details navigation requires the explicit panel link',
      `location.pathname==='/groups/${id}'`,
    );
    // Restore the room-specific route for the existing fallback scope checks.
    await cdp.send('Page.navigate', {
      url: origin + `/groups/${id}?view=floorplan`,
    });
    await until(
      `!!${canvas}&&!!document.querySelector('[aria-label="Floorplan inspector"]')`,
      'Room floorplan reopened',
    );
    await click(`document.querySelector('[aria-label="Close controls"]')`);
    // Exercise the actual browser event handler used after a GPU reset.
    await evaluate(
      `${canvas}.dispatchEvent(new Event('webglcontextlost',{cancelable:true}))`,
    );
    await until(
      `document.body.innerText.includes('The graphics connection was lost.')`,
      'Graphics fallback',
    );
    await check(
      'Fallback preserves room scope and disabled controls',
      `!!document.querySelector('[aria-label="Adjust Living room lamp"]') && !document.querySelector('[aria-label="Adjust Kitchen ceiling"]') && document.querySelector('[aria-label="Turn Bedroom lamp off"]').disabled && document.querySelector('[aria-label="Turn Floor lamp off"]').disabled`,
    );
    await request('/api/__fixture/live-controls', {
      clear: true,
      reject: true,
      delay: 400,
    });
    await click(
      `document.querySelector('[aria-label="Turn Living room lamp on"]')`,
    );
    await until(
      `document.body.innerText.includes('Fixture runtime rejected this command.')`,
      'Fallback rejection',
    );
    await check(
      'Rejected fallback command retains reported state',
      `!!document.querySelector('[aria-label="Turn Living room lamp on"]')`,
    );
    sent = await commands();
    if (
      sent.length !== 1 ||
      sent[0].DeviceCommand?.device_key !== 'zigbee2mqtt/living_room_lamp'
    )
      throw Error('Fallback scope incorrect');
    checks.push({
      name: 'Fallback command targets only the selected device',
      passed: true,
    });
    await request('/api/__fixture/live-controls', {
      clear: true,
      reject: false,
      delay: 500,
    });
    await click(
      `document.querySelector('[aria-label="Turn Living room lamp on"]')`,
    );
    await check(
      'Fallback command visibly waits for acknowledgment',
      `document.querySelector('[aria-label="Turn Living room lamp on"]').disabled`,
    );
    await until(
      `!!document.querySelector('[aria-label="Turn Living room lamp off"]')`,
      'Fallback successful command',
    );
    await shot('fallback');
    await click(button('Retry map'));
    await until(`!!${canvas}`, 'Map retry after context loss');
    await check(
      'Retry restores the map without navigating away',
      `!document.body.innerText.includes('The graphics connection was lost.') && location.pathname==='/groups/${id}'`,
    );
    await check(
      'No horizontal overflow',
      `document.documentElement.scrollWidth<=innerWidth+1`,
    );
    return { passed: true, checks, width };
  } finally {
    await request('/api/__fixture/live-controls', { reject: false, delay: 0 });
    for (const d of changed) await request('/api/v1/devices/' + d.id, d, 'PUT');
    for (const group of [id, child])
      await request('/api/v1/config/groups/' + group, undefined, 'DELETE');
    await request('/api/v1/config/floorplans/' + id, undefined, 'DELETE');
  }
}
