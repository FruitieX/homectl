import { writeFile } from 'node:fs/promises';

/** Read-only preview sizing and shared-renderer regression on guarded fixtures. */
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  if (
    !url.startsWith(origin + '/') ||
    (await fetch(origin + '/api/v1/config/floorplans')).headers.get(
      'x-homectl-fixture',
    ) !== 'true'
  )
    throw Error('Isolated fixture required');
  const action = {
    actionId: 'sizing-action',
    summary: 'Preview warm evening lighting',
    createdAtMs: Date.now(),
    changes: [
      {
        deviceKey: 'zigbee2mqtt/living_room_lamp',
        name: 'Living room lamp',
        power: true,
        brightness: 0.65,
        color: { h: 35, s: 0.8 },
      },
      {
        deviceKey: 'zigbee2mqtt/living_room_floor_lamp',
        name: 'Living room floor lamp',
        power: true,
        brightness: 0.4,
      },
    ],
  };
  const plan = {
    planId: 'sizing-plan',
    summary: 'Review living room configuration',
    createdAtMs: Date.now(),
    operations: [
      {
        opId: 'rename',
        op: 'update',
        kind: 'group',
        targetId: 'living_room',
        label: 'Living room',
        before: { name: 'Living room' },
        after: { name: 'Living area' },
      },
    ],
  };
  const editor = await (
    await fetch(origin + '/api/v1/config/floorplans/ground_floor/editor')
  ).json();
  const grid = JSON.parse(editor.data.grid_data);
  grid.devices = [
    {
      deviceKey: action.changes[0].deviceKey,
      deviceName: 'Living room lamp',
      x: 2,
      y: 2,
    },
    {
      deviceKey: action.changes[1].deviceKey,
      deviceName: 'Living room floor lamp',
      x: 9,
      y: 6,
    },
  ];
  grid.devices.push({
    deviceKey: 'zigbee2mqtt/living_room_motion',
    deviceName: 'Living room motion',
    x: 6,
    y: 4,
  });
  grid.groups.living_room = Array.from({ length: 45 }, (_, i) => ({
    x: 1 + (i % 9),
    y: 1 + Math.floor(i / 9),
  }));
  editor.data.grid_data = JSON.stringify(grid);
  const errors = [];
  let writes = 0;
  const fulfill = (id, data) =>
    cdp.send('Fetch.fulfillRequest', {
      requestId: id,
      responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify(data)).toString('base64'),
    });
  await cdp.send('Fetch.enable', {
    patterns: [
      { urlPattern: origin + '/api/v1/config/assistant/threads*' },
      { urlPattern: origin + '/api/v1/config/floorplans/ground_floor/editor' },
    ],
  });
  cdp.on('Fetch.requestPaused', (e) => {
    void (async () => {
      const path = new URL(e.request.url).pathname;
      if (path.endsWith('/editor')) return fulfill(e.requestId, editor);
      if (path.endsWith('/threads'))
        return fulfill(e.requestId, {
          success: true,
          data: ['action', 'plan'].map((id) => ({
            id,
            name:
              id === 'action' ? 'Light preview review' : 'Plan preview review',
            updatedAtMs: Date.now(),
            messageCount: 1,
          })),
        });
      const kind = path.split('/').at(-1),
        proposal = kind === 'action' ? action : plan;
      return fulfill(e.requestId, {
        success: true,
        data: {
          id: kind,
          name:
            kind === 'action' ? 'Light preview review' : 'Plan preview review',
          createdAtMs: Date.now(),
          updatedAtMs: Date.now(),
          messages: [
            {
              role: 'assistant',
              content: proposal.summary,
              proposal: { kind, [kind]: proposal },
            },
          ],
        },
      });
    })().catch((e) => errors.push(e.message));
  });
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) writes++;
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
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (expr, label) => {
    for (let i = 0; i < 70; i++) {
      if (await evaluate(expr)) return;
      await pause(140);
    }
    throw Error(label);
  };
  const click = async (expr) => {
    const p = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing target');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        ...p,
        button: 'left',
        clickCount: 1,
      });
    await pause(180);
  };
  const button = (name) =>
    `[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(name)}))`;
  const reviews = [];
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      "for(const type of ['drawElements','drawArrays','drawElementsInstanced','drawArraysInstanced']){const original=WebGL2RenderingContext.prototype[type];WebGL2RenderingContext.prototype[type]=function(...args){this.canvas.__drawCalls=(this.canvas.__drawCalls??0)+1;return original.apply(this,args)}}",
  });
  await cdp.send('Page.reload');
  await until(
    '!!document.querySelector(\'[aria-label="Ask AI"]\')',
    'Map reload',
  );
  await until("!!document.querySelector('canvas')", 'Main map rendered');
  await evaluate(
    "window.__mainMapCanvas=document.querySelector('canvas');window.__mapLosses=0;window.__mainMapCanvas.addEventListener('webglcontextlost',()=>window.__mapLosses++)",
  );
  await click(`document.querySelector('[aria-label="Ask AI"]')`);
  await until(`!!${button('Light preview review')}`, 'Conversation list');
  await evaluate(
    "(async()=>{const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/deps/pixi__js.js')).name;const {GlobalResourceRegistry}=await import(url);window.__globalReleases=0;GlobalResourceRegistry.register({clear(){window.__globalReleases++}})})()",
  );
  for (const kind of ['action', 'plan']) {
    await click(
      button(
        kind === 'action' ? 'Light preview review' : 'Plan preview review',
      ),
    );
    await until(
      `!!document.querySelector('[role=dialog] canvas')`,
      'Floorplan rendered',
    );
    await pause(800);
    await evaluate(
      `document.querySelector('[role=dialog] canvas').scrollIntoView({block:'nearest'})`,
    );
    const sizes = await evaluate(
      `(()=>{const d=document.querySelector('[role=dialog]').getBoundingClientRect(),c=document.querySelector('[role=dialog] canvas').getBoundingClientRect(),t=document.querySelector('[role=dialog] textarea').getBoundingClientRect();return{dialog:{width:d.width,height:d.height,top:d.top,bottom:d.bottom},preview:{width:c.width,height:c.height},composer:{top:t.top,bottom:t.bottom},viewportHeight:innerHeight,noOverflow:document.documentElement.scrollWidth<=innerWidth+1}})()`,
    );
    if (
      !sizes.noOverflow ||
      sizes.dialog.bottom > sizes.viewportHeight + 1 ||
      sizes.dialog.top < 0 ||
      sizes.composer.bottom > sizes.viewportHeight + 1 ||
      sizes.preview.height < (width >= 768 ? 280 : 220)
    )
      throw Error('Bad layout ' + JSON.stringify(sizes));
    if (
      width >= 1440 &&
      (sizes.dialog.width < 1200 || sizes.dialog.height < 850)
    )
      throw Error('Desktop still small');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/assistant-sizing-${width}-${kind}.png`,
      Buffer.from(shot.data, 'base64'),
    );
    reviews.push({ kind, ...sizes });
    if (kind === 'action') {
      // The affected-devices detail starts collapsed and expands on demand.
      const accordion = `[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.trim().startsWith('Affected devices'))`;
      const expanded = await evaluate(
        `(()=>{const b=${accordion};return b?b.getAttribute('aria-expanded'):null})()`,
      );
      if (expanded !== 'false')
        throw Error('Affected devices must start collapsed: ' + expanded);
      const collapsedRows = await evaluate(
        `document.querySelectorAll('[role=dialog] [role=checkbox]').length`,
      );
      if (collapsedRows !== 0)
        throw Error(
          'Collapsed accordion still rendered device rows: ' + collapsedRows,
        );
      await click(accordion);
      await until(
        `document.querySelectorAll('[role=dialog] [role=checkbox]').length===2`,
        'Affected-device rows appear when expanded',
      );
      const rowLabels = await evaluate(
        `[...document.querySelectorAll('[role=dialog] [role=checkbox]')].map(e=>e.getAttribute('aria-label'))`,
      );
      if (
        !rowLabels.some((label) => (label ?? '').includes('Living room lamp'))
      )
        throw Error('Expanded rows must name their devices: ' + rowLabels);
      await click(accordion);
      await until(
        `document.querySelectorAll('[role=dialog] [role=checkbox]').length===0`,
        'Affected-device rows collapse again',
      );
      await click(
        `document.querySelector('[aria-label="Back to past conversations"]')`,
      );
      await until(`!!${button('Plan preview review')}`, 'Back to history');
    }
  }
  const beforeCloseDraws = await evaluate(
    'window.__mainMapCanvas.__drawCalls ?? 0',
  );
  await click(
    `document.querySelector('[role=dialog] button[aria-label="Close"]')`,
  );
  await until("!document.querySelector('[role=dialog]')", 'Assistant closes');
  await pause(700);
  const map = await evaluate(
    "({sameCanvas:document.querySelector('canvas')===window.__mainMapCanvas,connected:window.__mainMapCanvas.isConnected,contextLost:window.__mainMapCanvas.getContext('webgl2').isContextLost(),lossEvents:window.__mapLosses,drawCalls:window.__mainMapCanvas.__drawCalls,globalReleases:window.__globalReleases})",
  );
  const closed = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    `/tmp/assistant-sizing-${width}-map-after.png`,
    Buffer.from(closed.data, 'base64'),
  );
  reviews.push({ map });
  if (
    !map.sameCanvas ||
    !map.connected ||
    map.contextLost ||
    map.lossEvents ||
    map.globalReleases ||
    map.drawCalls <= beforeCloseDraws
  )
    throw Error('Main map broke: ' + JSON.stringify(map));
  if (errors.length || writes) throw Error(JSON.stringify({ errors, writes }));
  return { passed: true, width, writes, reviews };
}
