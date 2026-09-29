import { writeFile } from 'node:fs/promises';

export default async function (cdp, { width, height, url }) {
  const captureOnly = process.env.ROOM_REVIEW_CAPTURE_ONLY === '1';
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Fixture required');
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config';
  const marker = await fetch(base + '/groups');
  if (marker.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Marked fixture required');
  const id = 'preview_' + Date.now(),
    child = id + '_child',
    empty = id + '_empty';
  const devices = (await (await fetch(origin + '/api/v1/devices')).json())
    .devices;
  const changed = devices.filter((d) =>
    [
      'bedroom_lamp',
      'living_room_floor_lamp',
      'living_room_motion',
      'living_room_lamp',
    ].includes(d.id),
  );
  const request = async (path, body, method = 'POST') => {
    const r = await fetch(origin + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw Error(await r.text());
    return (await r.json()).data;
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
  const pause = () => new Promise((r) => setTimeout(r, 160));
  const until = async (expression, message) => {
    for (let i = 0; i < 300; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = async (expression) => {
    await evaluate(`(${expression}).click()`);
    await pause();
  };
  const capture = async (name) => {
    await pause();
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/room-review-${width}-${name}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const svg = `document.querySelector('svg[aria-label="Review room floorplan"]')`;
  const previewAt = (x) =>
    `!!${svg}?.querySelector('g[transform="translate(${x} 112)"]')`;
  const checks = [];
  let layout, created;
  const grid = {
    width: 16,
    height: 10,
    tileSize: 32,
    deviceScale: 1,
    labelMode: 'all',
    tiles: Array.from({ length: 10 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) =>
        x === 0 || y === 0 || x === 15 || y === 9 || (x === 8 && y !== 5)
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
        x: 5,
        y: 3,
      },
      {
        deviceKey: 'zigbee2mqtt/bedroom_lamp',
        deviceName: 'Bedroom lamp',
        x: 6,
        y: 6,
      },
      {
        deviceKey: 'zigbee2mqtt/living_room_motion',
        deviceName: 'Living room climate',
        x: 3,
        y: 6,
      },
      {
        deviceKey: 'zigbee2mqtt/kitchen_counter',
        deviceName: 'Outside scope',
        x: 12,
        y: 3,
      },
    ],
    groups: {
      [id]: [
        { x: 2, y: 2 },
        { x: 6, y: 7 },
      ],
    },
  };
  try {
    for (const device of changed) {
      const next = structuredClone(device);
      if (next.id === 'bedroom_lamp') {
        next.data.Controllable.disabled = true;
        next.data.Controllable.state.power = true;
      }
      if (next.id === 'living_room_floor_lamp') {
        next.data.Controllable.managed = 'FullReadOnly';
        next.data.Controllable.state.power = true;
      }
      if (next.id === 'living_room_lamp')
        next.data.Controllable.state.power = true;
      if (next.id === 'living_room_motion') {
        next.name = 'Living room climate';
        next.data = { Sensor: { value: 21.4 } };
      }
      await request('/api/v1/devices/' + device.id, next, 'PUT');
    }
    await request('/api/v1/config/groups', {
      id: child,
      name: 'Review child',
      hidden: true,
      devices: [
        'living_room_lamp',
        'living_room_floor_lamp',
        'bedroom_lamp',
        'living_room_motion',
      ].map((device_id) => ({ integration_id: 'zigbee2mqtt', device_id })),
      linked_groups: [],
    });
    await request('/api/v1/config/groups', {
      id,
      name: 'Review room',
      hidden: false,
      devices: [
        { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' },
        { integration_id: 'dummy', device_id: 'missing_review' },
      ],
      linked_groups: [child],
    });
    await request('/api/v1/config/groups', {
      id: empty,
      name: 'Unplaced review',
      hidden: false,
      devices: [],
      linked_groups: [],
    });
    created = await request(
      `/api/v1/config/floorplans/${id}/editor`,
      {
        id,
        name: 'Review floorplan',
        grid_data: JSON.stringify(grid),
        image: { kind: 'none' },
        create_only: true,
      },
      'PUT',
    );
    layout = await request('/api/v1/config/dashboard/layouts', {
      id: 0,
      name: 'Room review',
      is_default: false,
    });
    for (const [i, [widget_type, title, options]] of [
      [
        'rooms',
        'Rooms',
        {
          roomSelection: 'selected',
          groupIds: [id, empty],
          showFloorplan: true,
          showPower: true,
          showAttention: true,
        },
      ],
      [
        'scenes',
        'Scenes',
        {
          sceneSelection: 'selected',
          sceneIds: ['normal', 'night'],
          scope: 'group',
          groupId: id,
        },
      ],
      [
        'indoor_climate',
        'Indoor climate',
        {
          temperatureSensorId: 'render_living',
          humiditySensorId: 'render_living',
        },
      ],
    ].entries())
      await request('/api/v1/config/dashboard/widgets', {
        id: 0,
        layout_id: layout.id,
        widget_type,
        config: { title, options },
        grid_x: i * 4,
        grid_y: 0,
        grid_w: 4,
        grid_h: 4,
        sort_order: i,
      });
    await request('/api/v1/config/dashboard/widgets', {
      id: 0,
      layout_id: layout.id,
      widget_type: 'rooms',
      config: {
        title: 'Compact rooms',
        options: {
          roomSelection: 'selected',
          groupIds: [id],
          showFloorplan: true,
          showPower: true,
          showAttention: false,
        },
      },
      grid_x: 4,
      grid_y: 4,
      grid_w: 2,
      grid_h: 2,
      sort_order: 3,
    });
    // History explicitly identifies units and full source identity. An unrelated
    // integration has the same device ID with an extreme value to expose leaks.
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(()=>{const original=window.fetch;window.__previewAttempts=0;window.__metadataAttempts=0;window.__climateFail=false;window.fetch=async function(input,init){const u=String(input instanceof Request?input.url:input);if(${width < 700}&&u.endsWith('/api/v1/config/floorplans')&&++window.__metadataAttempts<3)throw new TypeError('Fixture catalog temporarily unavailable');if(u.includes('/floorplans/')&&u.includes('/editor')&&u.includes(${JSON.stringify(id)})&&++window.__previewAttempts<${width < 700 ? 3 : 4})throw new TypeError('Fixture transient map failure');if(u.includes('/api/influxdb/temp-sensors')){if(window.__climateFail)throw new TypeError('Fixture readings unavailable');return new Response(JSON.stringify([
      {integration_id:'zigbee2mqtt',device_id:'living_room_motion',_field:'tempc',_value:21.4,_time:new Date().toISOString()},
      {integration_id:'zigbee2mqtt',device_id:'living_room_motion',_field:'tempc',_value:21.1,_time:new Date(Date.now()-600000).toISOString()},
      {integration_id:'other',device_id:'living_room_motion',_field:'hum',_value:99,_time:new Date().toISOString()},
      {integration_id:'other',device_id:'living_room_motion',_field:'tempc',_value:99,_time:new Date().toISOString()},
      {integration_id:'influxdb',device_id:'render_living',_field:'tempc',_value:21.4,_time:new Date().toISOString()},
      {integration_id:'influxdb',device_id:'render_living',_field:'tempc',_value:21.1,_time:new Date(Date.now()-600000).toISOString()}
    ]),{headers:{'Content-Type':'application/json'}});}return original.call(this,input,init);}})()`,
    });
    if (captureOnly)
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
        source: 'window.__previewAttempts=100;window.__metadataAttempts=100;',
      });
    await cdp.send('Page.navigate', { url: origin + '/groups/' + id });
    await until(previewAt(112), 'Nested room preview recovered');
    if ((await evaluate('window.__previewAttempts')) < 3)
      throw Error('Recovery not exercised');
    if (width < 700 && (await evaluate('window.__metadataAttempts')) < 3)
      throw Error('Catalog recovery not exercised');
    checks.push(
      width < 700
        ? 'Exhausted floorplan catalog retries recover through background polling without focus or reload'
        : 'Exhausted preview retries recover through background polling without focus or reload',
    );
    if (
      !(await evaluate(
        `${svg}.querySelectorAll('g[transform]').length===4 && !${svg}.textContent.includes('kitchen')`,
      ))
    )
      throw Error('Preview member scope');
    checks.push(
      'Nested members are deduplicated and unrelated lights stay out of the preview',
    );
    if (
      !(await evaluate(
        `${svg}.textContent.includes('Disabled') && !!${svg}.querySelector('path')`,
      ))
    )
      throw Error('Disabled preview state');
    checks.push('Disabled preview has a distinct label and slash');
    const conditions = `document.querySelector('[aria-label="Room conditions"]')`;
    await until(`${conditions}?.textContent.includes('21.4')`, 'Room climate');
    if (
      !(await evaluate(
        `${conditions}.textContent.includes('No reading') && !${conditions}.textContent.includes('99') && ${conditions}.querySelectorAll('time').length===1`,
      ))
    )
      throw Error('Climate scope or freshness');
    checks.push(
      'Conditions use the latest exact-source sample, retain its timestamp and leave missing humidity empty',
    );
    const chart = `${conditions}.querySelector('[role="slider"]')`;
    await until(`!!${chart}`, 'Room history chart');
    await evaluate(`${chart}.focus({preventScroll:true})`);
    await cdp.send('Page.bringToFront');
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'End',
      code: 'End',
      windowsVirtualKeyCode: 35,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'End',
      code: 'End',
    });
    if (
      !(await evaluate(
        `${chart}.getAttribute('aria-valuetext').includes('21.4')`,
      ))
    )
      throw Error('Room chart keyboard reading');
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
    });
    checks.push(
      'Room history supports precise keyboard inspection and Escape dismissal',
    );
    if (
      !(await evaluate(
        `document.body.textContent.includes('2 of 2 on') && document.body.textContent.includes('1 unavailable') && document.querySelector('[aria-label="Turn Bedroom lamp off"]').disabled && document.querySelector('[aria-label="Turn Floor lamp off"]').disabled`,
      ))
    )
      throw Error('Disabled/read-only summary');
    checks.push(
      'Room summary excludes disabled power; missing and read-only members remain visible',
    );
    await capture('detail');
    if (width < 700) {
      await evaluate(`${conditions}.scrollIntoView({block:'center'})`);
      await capture('conditions');
    }
    await goto('/groups');
    await until(previewAt(112), 'Rooms list preview');
    if (
      !(await evaluate(
        `!document.querySelector('svg[aria-label="Unplaced review floorplan"]')`,
      ))
    )
      throw Error('Invented unplaced preview');
    await evaluate(
      `(()=>{const e=document.querySelector('[aria-label="Search rooms or devices"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'review');e.dispatchEvent(new Event('input',{bubbles:true}));})()`,
    );
    await pause();
    const attention =
      'document.querySelector(\'[aria-label="Devices needing attention"]\')';
    if (await evaluate(`!!${attention}?.querySelector('button')`)) {
      const count = await evaluate(
        `Number(${attention}.textContent.trim().match(/^([0-9]+)/)[1])`,
      );
      if ((await evaluate(`${attention}.querySelectorAll('li').length`)) !== 1)
        throw Error('Attention summary is unbounded');
      await click(`${attention}.querySelector('button')`);
      if (
        (await evaluate(`${attention}.querySelectorAll('li').length`)) !== count
      )
        throw Error('Attention expansion lost scope');
      await click(`${attention}.querySelector('button')`);
      checks.push(
        'Attention keeps the count and first issue glanceable; expanding reveals the remaining scoped issues',
      );
    }
    await capture('list');
    if (
      !(await evaluate(
        `document.querySelector('section:has(svg[aria-label="Review room floorplan"])').textContent.includes('21.4 °C')`,
      ))
    )
      throw Error('Room card climate summary');
    checks.push(
      'Room list shows the placed preview and sourced climate summary, without an empty map for unplaced rooms',
    );
    await goto('/groups/' + empty);
    await until(
      `document.body.textContent.includes('No sensors assigned to this room.')`,
      'Empty room conditions',
    );
    if (
      await evaluate(
        `!!document.querySelector('svg[aria-label="Unplaced review floorplan"]') || !!document.querySelector('a[aria-label="Open Unplaced review floorplan"]')`,
      )
    )
      throw Error('Empty room map');
    checks.push(
      'An empty room keeps controls-first recovery with no fictional readings or empty floorplan',
    );
    await goto('/?layout=' + layout.id);
    await until(previewAt(112), 'Dashboard preview');
    if (
      !(await evaluate(
        `document.body.textContent.includes('1 disabled') && document.body.textContent.includes('Activation scope: Review room')`,
      ))
    )
      throw Error('Dashboard summary or scene scope');
    if (!(await evaluate('document.documentElement.scrollWidth<=innerWidth+1')))
      throw Error('Dashboard overflow');
    await capture('dashboard');
    const compact = `[...document.querySelectorAll('.dashboard-widget-container')].find(e=>e.querySelector('h2')?.textContent==='Compact rooms')`;
    if (
      !(await evaluate(
        `(()=>{const card=${compact},link=card?.querySelector('.dashboard-room-link'),name=link?.querySelector('strong'),preview=link?.querySelector('svg[aria-label="Review room floorplan"]');return !!(name && preview && name.clientWidth>=30 && preview.getBoundingClientRect().width>=40 && preview.getBoundingClientRect().bottom<=card.getBoundingClientRect().bottom && card.scrollWidth<=card.clientWidth+1)})()`,
      ))
    )
      throw Error('Compact room widget hides its name or preview');
    if (width < 700) {
      await evaluate(`${compact}.scrollIntoView({block:'center'})`);
      await capture('compact-widget');
    }
    checks.push(
      'Compact room widget keeps its name, preview and power control inside the card',
    );
    checks.push(
      'Dashboard room widget contains the same scoped preview and disabled count at its configured size',
    );
    if (captureOnly) return { captured: true, width };
    await goto('/config/floorplan?id=' + id);
    await until(`!!document.querySelector('canvas')`, 'Editor loaded');
    await click(button('Fit'));
    if (
      !(await evaluate(
        `(()=>{const c=document.querySelector('canvas'),p=c.parentElement;return p.scrollWidth<=p.clientWidth+1 && p.scrollHeight<=p.clientHeight+1 && document.documentElement.scrollWidth<=innerWidth+1})()`,
      ))
    )
      throw Error('Wide floorplan does not fit');
    checks.push(
      'Wide floorplan fits the phone/desktop editor without expanding its grid column',
    );
    await click(button('Devices'));
    await click(
      `[...document.querySelectorAll('[aria-label="Device placements"] button')].find(b=>b.textContent.startsWith('Placed'))`,
    );
    await click(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.startsWith('Living room lampColumn'))`,
    );
    const point = await evaluate(
      `(()=>{const c=document.querySelector('canvas');c.parentElement.scrollIntoView({block:'center'});const r=c.getBoundingClientRect();return {x:r.x+9.5/16*r.width,y:r.y+3.5/10*r.height}})()`,
    );
    await cdp.send('Page.bringToFront');
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
    if (
      (await (await fetch(base + `/floorplans/${id}/editor`)).json()).data
        .revision_token !== created.revision_token
    )
      throw Error('Map wrote before save');
    await click(button('Save changes'));
    await until(`!${button('Save changes')}`, 'Map save');
    await goto('/groups/' + id);
    await until(previewAt(304), 'Saved preview refresh');
    checks.push(
      'Explicit map Save refreshes room preview coordinates in the existing page session',
    );
    await goto('/groups');
    await until(previewAt(304), 'List saved preview');
    await goto('/?layout=' + layout.id);
    await until(previewAt(304), 'Dashboard saved preview');
    checks.push(
      'Saved placement refresh reaches both rooms list and dashboard',
    );
    await evaluate('window.__climateFail=true');
    await goto('/groups/' + id);
    await until(
      `document.querySelector('[aria-label="Room conditions"]')?.textContent.includes('could not be refreshed')`,
      'Readings failure state',
    );
    if (
      !(await evaluate(
        `${conditions}.textContent.includes('21.4') && ${conditions}.querySelector('time')!==null`,
      ))
    )
      throw Error('Cached samples lost on error');
    await evaluate('window.__climateFail=false');
    await click(button('Retry readings'));
    await until(
      `!${conditions}.textContent.includes('could not be refreshed')`,
      'Readings recovered',
    );
    checks.push('History refresh failure keeps dated samples; Retry recovers');
    await request('/api/__fixture/live-controls', {
      clear: true,
      reject: false,
      delay: 500,
    });
    await click(
      `document.querySelector('[aria-label="Turn Review room off"]')`,
    );
    await until(
      `!!document.querySelector('[aria-label="Turn Review room on"]')`,
      'Room command acknowledged',
    );
    const commands = (
      await (await fetch(origin + '/api/__fixture/live-controls')).json()
    ).commands;
    if (
      commands.length !== 1 ||
      commands[0].DeviceCommand?.device_key !== 'zigbee2mqtt/living_room_lamp'
    )
      throw Error('Room command scope ' + JSON.stringify(commands));
    checks.push(
      'Room power sends only one writable member command, excluding disabled/read-only/missing members',
    );
    return { passed: true, checks, width, layout: layout.id };
  } catch (error) {
    console.log(
      await evaluate(
        `JSON.stringify({path:location.pathname,attempts:window.__previewAttempts,text:document.body.innerText.slice(0,3000),svgs:[...document.querySelectorAll('svg[role="img"]')].map(s=>s.outerHTML.slice(0,500)),positions:[...document.querySelectorAll('svg[role="img"] g[transform]')].map(g=>g.getAttribute('transform'))})`,
      ),
    );
    await capture('failure');
    throw error;
  } finally {
    await request('/api/__fixture/live-controls', { reject: false, delay: 0 });
    for (const device of changed)
      await request('/api/v1/devices/' + device.id, device, 'PUT');
    if (layout)
      await request(
        '/api/v1/config/dashboard/layouts/' + layout.id,
        undefined,
        'DELETE',
      );
    for (const groupId of [id, child, empty])
      await request('/api/v1/config/groups/' + groupId, undefined, 'DELETE');
    if (created) {
      const current = (
        await (await fetch(base + `/floorplans/${id}/editor`)).json()
      ).data;
      await request(
        `/api/v1/config/floorplans/${id}/editor`,
        { expected: current.revision_token },
        'DELETE',
      );
    }
  }
}
