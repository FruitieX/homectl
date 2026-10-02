import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Rendering and browser interaction checks. Preview execution is tested in Rust. */
export default async function (cdp, { width, url }) {
  const origin = new URL(url).origin;
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
    throw Error('Local fixture required');
  const marker = await fetch(origin + '/api/v1/config/groups');
  if (marker.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Fixture marker missing');
  const checks = [],
    requests = [],
    foreignRequests = [];
  const artifacts = process.env.SMOKE_ARTIFACTS;
  const pause = (ms = 60) => new Promise((done) => setTimeout(done, ms));
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
  const check = async (name, expression) => {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await evaluate(`Boolean(${expression})`)) {
        checks.push(name);
        return;
      }
      await pause();
    }
    throw Error(name);
  };
  const labeled = (label) =>
    `document.querySelector(${JSON.stringify(`[aria-label="${label}"]`)})`;
  const button = (label) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
  const click = async (expression) => {
    let point = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Missing target: '+${JSON.stringify(expression)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    // Radix/framer dialogs can exist before their opening transform settles.
    // Wait for stable hit-test geometry rather than tapping their old position.
    let stable = 0;
    const deadline = Date.now() + 5000;
    while (stable < 2 && Date.now() < deadline) {
      await pause();
      const next = await evaluate(
        `(()=>{const e=${expression};if(!e)return null;const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:e===hit||e.contains(hit)}})()`,
      );
      if (!next) throw Error('Click target disappeared: ' + expression);
      stable =
        next.hit &&
        Math.abs(next.x - point.x) < 0.5 &&
        Math.abs(next.y - point.y) < 0.5
          ? stable + 1
          : 0;
      point = { x: next.x, y: next.y };
    }
    if (stable < 2) throw Error('Click target is not hittable: ' + expression);
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
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
      });
  };
  const type = async (expression, text) => {
    await click(expression);
    await key('a', 65, 2);
    await key('Backspace', 8);
    await cdp.send('Input.insertText', { text });
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
  };
  const api = async (path, value, method = 'PUT') => {
    const response = await fetch(origin + '/api/v1/config/' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    });
    const body = await response.json();
    if (!response.ok || !body.success)
      throw Error(`Fixture ${path}: ${JSON.stringify(body)}`);
    return body.data;
  };
  const shot = async (name) => {
    if (!artifacts) return;
    if (name.endsWith('-preview')) {
      await evaluate(
        'document.querySelector(\'[aria-label="Preview result"], [aria-label="Routine preview result"]\')?.scrollIntoView({block:\'center\'})',
      );
      await pause();
    }
    const result = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      resolve(artifacts, `${width}-${name}.png`),
      Buffer.from(result.data, 'base64'),
    );
  };
  const fits = (name) =>
    check(name, 'document.documentElement.scrollWidth<=innerWidth+1');
  const truth = (value, extra = {}) => ({
    truth: value,
    trace: { truth: value, path: '/condition', evaluated: true, ...extra },
    ...extra,
  });
  const steps = [
    {
      action_id: 'preview/scene',
      kind: 'activate_scene',
      targets: ['normal', 'living_room'],
      references: [
        { entity: 'scene', entity_id: 'normal' },
        { entity: 'group', entity_id: 'living_room' },
      ],
      disposition: 'dispatched',
    },
    {
      action_id: 'preview/helper',
      kind: 'set_helper',
      targets: ['entryway_cooldown'],
      references: [{ entity: 'helper', entity_id: 'entryway_cooldown' }],
      disposition: 'dispatched',
    },
  ];
  const suppression = {
    action_id: 'preview/skipped',
    kind: 'dim',
    targets: [],
    disposition: 'suppressed',
    reason: 'No writable lights in this selection.',
  };
  let condition = truth('false'),
    action = {
      kind: 'action',
      steps,
      suppressions: [suppression],
      script_results: [],
      dispatched: false,
    };
  let value = 0,
    failPreview = false;
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: '*', requestStage: 'Request' }],
  });
  cdp.on('Fetch.requestPaused', async (event) => {
    try {
      const endpoint = new URL(event.request.url);
      if (
        !['127.0.0.1', 'localhost'].includes(endpoint.hostname) &&
        !['data:', 'blob:'].includes(endpoint.protocol)
      ) {
        foreignRequests.push(event.request.url);
        await cdp.send('Fetch.failRequest', {
          requestId: event.requestId,
          errorReason: 'BlockedByClient',
        });
        return;
      }
      if (
        endpoint.pathname.endsWith('/reuse-preview') ||
        endpoint.pathname.endsWith('/routines/preview')
      ) {
        const request = JSON.parse(event.request.postData);
        requests.push(request);
        const data = endpoint.pathname.endsWith('/routines/preview')
          ? {
              error: null,
              validation_errors: [],
              would_run: true,
              condition: truth('true'),
              steps: steps.map(({ action_id, kind, targets }) => ({
                id: action_id,
                kind,
                targets,
              })),
              suppressions: [],
              script_unsupported: false,
            }
          : request.kind === 'helper'
            ? { kind: 'helper', value: false }
            : request.block.kind === 'function'
              ? { kind: 'function', value }
              : request.block.kind === 'condition'
                ? { kind: 'condition', value: condition }
                : action;
        await cdp.send('Fetch.fulfillRequest', {
          requestId: event.requestId,
          responseCode: 200,
          responseHeaders: [
            { name: 'Content-Type', value: 'application/json' },
          ],
          body: Buffer.from(
            JSON.stringify(
              failPreview
                ? { success: false, error: 'Preview temporarily unavailable.' }
                : { success: true, data },
            ),
          ).toString('base64'),
        });
        return;
      }
      await cdp.send('Fetch.continueRequest', { requestId: event.requestId });
    } catch (error) {
      console.error(error);
      foreignRequests.push(String(error));
    }
  });
  const spec = {
    api_version: 1,
    source_body: 'return 0;',
    declarations: [],
    functions: [],
    limits_profile: 'default',
  };
  try {
    const preferences = await api('preferences', undefined, 'GET');
    await api('preferences', {
      ...preferences,
      show_advanced_details: false,
      expected: preferences,
    });
    for (const kind of ['function', 'condition', 'action'])
      await api(`blocks/smoke-${kind}`, {
        id: `smoke-${kind}`,
        name: `Smoke ${kind}`,
        kind,
        revision: 1,
        inputs: {},
        body: {
          kind: 'javascript',
          spec: {
            ...spec,
            source_body:
              kind === 'condition'
                ? 'return false;'
                : kind === 'action'
                  ? 'return {actions: []};'
                  : spec.source_body,
          },
          ...(kind === 'function' ? { output: { kind: 'json' } } : {}),
        },
      });
    await api('helpers/smoke-computed', {
      id: 'smoke-computed',
      name: 'Computed flag',
      kind: { kind: 'boolean' },
      initial_value: false,
      persistence: 'durable',
      compute: {
        enabled: true,
        revision: 1,
        refresh_ms: 1000,
        helpers: [],
        script: { ...spec, source_body: 'return false;' },
      },
    });
    await cdp.send('Page.navigate', {
      url: origin + '/config/groups/living_room',
    });
    const name = "document.querySelector('[data-field=name]')";
    await check('Group editor loads', `!!${name}`);
    await type(name, 'Living room smoke draft');
    await check(
      'Editing shows unsaved state',
      "document.querySelector('.settings-savebar')?.dataset.dirty==='true'",
    );
    await goto('/config/scenes');
    await check(
      'Scene list loads during retained edit',
      '!!document.querySelector(\'a[href="/config/scenes/normal"]\')',
    );
    await goto('/config/groups/living_room');
    await check(
      'Navigation retains group edits',
      `${name}?.value==='Living room smoke draft'`,
    );
    const groups = await api('groups', undefined, 'GET');
    if (
      groups.find((group) => group.id === 'living_room').name ===
      'Living room smoke draft'
    )
      throw Error('Draft persisted without Save');
    await click(button('Discard'));
    await check(
      'Discard restores saved values',
      `${name}?.value!=='Living room smoke draft'&&document.querySelector('.settings-savebar')?.dataset.dirty!=='true'`,
    );
    await fits('Group editor fits');

    await goto('/config/blocks/smoke-function');
    await check(
      'Function editor loads',
      `!!${labeled('Function output type')}`,
    );
    await click(button('Preview draft'));
    await check(
      'Zero is rendered as a function result',
      `${labeled('Function result')}?.textContent.includes('0')`,
    );
    await check(
      'Raw JSON is hidden without advanced details',
      "![...document.querySelectorAll('summary')].some(e=>e.textContent==='Inspect JSON')",
    );
    await type(name, 'Renamed function draft');
    await check(
      'A changed draft marks its result stale',
      "document.body.textContent.includes('Draft changed; preview again.')",
    );
    value = { ready: false, level: 0, label: '<b>literal text</b>', empty: '' };
    await click(button('Preview draft'));
    await check(
      'Structured values preserve false, zero, empty and literal text',
      `${labeled('Function result')}?.textContent.includes('False')&&${labeled('Function result')}?.textContent.includes('Empty text')&&${labeled('Function result')}?.textContent.includes('<b>literal text</b>')&&!${labeled('Function result')}?.querySelector('b')`,
    );
    await shot('function-preview');
    await fits('Structured preview fits');
    await click(button('Discard'));

    await goto('/config/blocks/smoke-condition');
    await check(
      'Condition editor loads',
      "document.body.textContent.includes('Smoke condition')",
    );
    await click(button('Preview draft'));
    await check(
      'False is a valid negative result',
      `${labeled('Condition result')}?.textContent.includes('Condition not met')`,
    );
    condition = truth('unknown', {
      unknown_reason: { kind: 'not_initialized', entity: 'occupancy' },
    });
    await click(button('Preview draft'));
    await check(
      'Unknown explains the missing input',
      `${labeled('Condition result')}?.textContent.includes('Condition unknown')&&${labeled('Condition result')}?.textContent.includes('occupancy')`,
    );
    condition = truth('true', { error: 'Calculation failed.' });
    await click(button('Preview draft'));
    await check(
      'Evaluation errors never appear as a passed condition',
      `${labeled('Condition result')}?.textContent.includes('Could not evaluate')&&!${labeled('Condition result')}?.textContent.includes('Condition met')`,
    );
    await shot('condition-preview');

    await goto('/config/blocks/smoke-action');
    await check(
      'Action editor loads',
      "document.body.textContent.includes('Smoke action')",
    );
    await click(button('Preview draft'));
    await check(
      'Planned actions have names and related links',
      `${labeled('Planned actions')}?.textContent.includes('2 planned actions')&&!!${labeled('Planned actions')}?.querySelector('a[href=\"/config/scenes/normal\"]')&&!!${labeled('Planned actions')}?.querySelector('a[href=\"/config/helpers/entryway_cooldown\"]')`,
    );
    await check(
      'Skipped actions explain the reason',
      `${labeled('Planned actions')}?.textContent.includes('No writable lights')`,
    );
    await check(
      'Preview never claims to have dispatched',
      `${labeled('Preview result')}?.textContent.includes('No actions were applied')&&!${labeled('Preview result')}?.textContent.includes('dispatched')`,
    );
    await shot('action-preview');
    await fits('Action preview fits');
    action = { ...action, steps: [], suppressions: [] };
    await click(button('Preview draft'));
    await check(
      'Empty action plans are explained',
      `${labeled('Planned actions')}?.textContent.includes('No actions planned')`,
    );
    failPreview = true;
    await click(button('Preview draft'));
    await check(
      'Preview errors offer retry without losing draft',
      "document.body.textContent.includes('Preview temporarily unavailable.')",
    );
    failPreview = false;
    await click(button('Preview draft'));
    await check(
      'Retry recovers the preview',
      `${labeled('Planned actions')}?.textContent.includes('No actions planned')&&!document.body.textContent.includes('Preview temporarily unavailable.')`,
    );

    await goto('/config/helpers/smoke-computed');
    await check(
      'Computed helper editor loads',
      `!!${labeled('Helper refresh seconds')}`,
    );
    await click(button('Preview draft'));
    await check(
      'False computed helper value is visible',
      `${labeled('Computed value')}?.textContent.includes('False')`,
    );
    await shot('helper-preview');

    const current = await api('preferences', undefined, 'GET');
    await api('preferences', {
      ...current,
      show_advanced_details: true,
      expected: current,
    });
    await cdp.send('Page.navigate', {
      url: origin + '/config/blocks/smoke-function',
    });
    await check(
      'Advanced preview editor loads',
      `!!${labeled('Function output type')}`,
    );
    await click(button('Preview draft'));
    const json =
      "[...document.querySelectorAll('summary')].find(e=>e.textContent==='Inspect JSON')";
    await check(
      'Advanced JSON is available and collapsed',
      `!!${json}&&!${json}.parentElement.open`,
    );
    await click(json);
    await check(
      'Advanced JSON expands on request',
      `${json}.parentElement.open&&${json}.parentElement.querySelector('pre').textContent.includes('false')`,
    );
    await fits('Expanded JSON is contained');

    await goto('/config/routines/motion_on');
    await check(
      'Routine editor loads',
      `${name}?.value==='Living room motion on'&&!!${button('Preview draft')}`,
    );
    await click(button('Preview draft'));
    await check('What-if preview opens', `!!${button('Preview result')}`);
    await click(button('Preview result'));
    await check(
      'Routine preview uses shared readable actions',
      `${labeled('Planned actions')}?.textContent.includes('Activate scene')&&document.body.textContent.includes('Would run')`,
    );
    await fits('Routine preview fits');
    await shot('routine-preview');

    const layout = await api(
      'dashboard/layouts',
      { id: 0, name: 'Smoke charts', is_default: false },
      'POST',
    );
    for (const [index, kind] of ['weather', 'spot_price'].entries())
      await api(
        'dashboard/widgets',
        {
          id: 0,
          layout_id: layout.id,
          widget_type: kind,
          config: { title: kind, options: { forecastHours: 24 } },
          grid_x: 0,
          grid_y: index * 5,
          grid_w: 16,
          grid_h: 5,
          sort_order: index,
        },
        'POST',
      );
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source:
        'window.__smokePixiApps=[];window.__PIXI_APP_INIT__=app=>window.__smokePixiApps.push(app);' +
        (await readFile(
          new URL('./widget-bodies-fixture.js', import.meta.url),
          'utf8',
        )),
    });
    await cdp.send('Page.navigate', { url: origin + '/?layout=' + layout.id });
    await check(
      'Weather and price charts load',
      "!!document.querySelector('.dashboard-weather-card svg[role=slider]')&&!!document.querySelector('.dashboard-spot-card svg[role=slider]')",
    );
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 2,
    });
    const touch = (type, point) =>
      cdp.send('Input.dispatchTouchEvent', {
        type,
        touchPoints: point ? [{ ...point, id: 1 }] : [],
      });
    const chartPoint = async (selector) => {
      await evaluate(
        `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
      );
      await pause();
      return evaluate(
        `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width*.6,y:r.y+r.height*.5}})()`,
      );
    };
    for (const [className, title] of [
      ['.dashboard-weather-card', 'Weather forecast'],
      ['.dashboard-spot-card', 'Electricity prices'],
    ]) {
      const point = await chartPoint(`${className} svg[role=slider]`);
      await touch('touchStart', point);
      await touch('touchEnd');
      await check(
        `${title}: chart tap opens details`,
        `document.querySelector('[role=dialog]')?.textContent.includes(${JSON.stringify(title)})`,
      );
      const detailsChart = '[role=dialog] svg[role=slider]';
      if (className === '.dashboard-weather-card')
        await click(
          "document.querySelector('[role=dialog] [role=tab][data-state=inactive]')",
        );
      await check(
        `${title}: dialog chart loads`,
        `!!document.querySelector(${JSON.stringify(detailsChart)})`,
      );
      const detailPoint = await chartPoint(detailsChart);
      await touch('touchStart', detailPoint);
      await touch('touchMove', { ...detailPoint, x: detailPoint.x - 40 });
      await check(
        `${title}: drag inspects values`,
        "!!document.querySelector('[data-chart-reading]')",
      );
      await touch('touchEnd');
      await check(
        `${title}: release clears reading`,
        "!document.querySelector('[data-chart-reading]')",
      );
      await click(labeled('Close'));
      await check(
        `${title}: dialog dismisses`,
        "!document.querySelector('[role=dialog]')",
      );
    }
    await fits('Dashboard fits');
    await cdp.send('Page.navigate', { url: origin + '/map' });
    await check(
      'Live floorplan renders',
      "document.querySelector('canvas')?.width>0&&window.__smokePixiApps?.some(a=>a.renderer?.canvas===document.querySelector('canvas')&&a.stage.children.length)",
    );
    // Observe the real Pixi world through its existing initialization hook;
    // no application state or gesture implementation is replaced.
    const world =
      "window.__smokePixiApps.find(a=>a.renderer?.canvas===document.querySelector('canvas')).stage.children[0]";
    const transform = () =>
      evaluate(
        `(()=>{const w=${world};return {x:w.x,y:w.y,scale:w.scale.x}})()`,
      );
    await pause(150);
    const box = await evaluate(
      "(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}})()",
    );
    const start = [
      { id: 1, x: box.x + box.width * 0.4, y: box.y + box.height * 0.55 },
      { id: 2, x: box.x + box.width * 0.4 + 70, y: box.y + box.height * 0.55 },
    ];
    const initial = await transform();
    const touches = async (type, touchPoints) => {
      await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
      await pause(100);
    };
    await touches('touchStart', [start[0]]);
    await touches('touchStart', start);
    const moved = start.map((point, i) => ({
      ...point,
      x: point.x + (i ? 35 : -35),
    }));
    await touches('touchMove', moved);
    await check(
      'Floorplan pinch changes zoom',
      `${world}.scale.x>(${initial.scale})*1.2`,
    );
    const pinched = await transform();
    await touches('touchEnd', [moved[1]]);
    await touches('touchMove', [moved[0]]);
    await check(
      'Lifting a pinch finger does not snap the map',
      `Math.abs(${world}.x-(${pinched.x}))<.5&&Math.abs(${world}.y-(${pinched.y}))<.5`,
    );
    await touches('touchMove', [
      { ...moved[0], x: moved[0].x + 15, y: moved[0].y + 10 },
    ]);
    await check(
      'The remaining finger pans from its current position',
      `Math.abs(${world}.x-(${pinched.x})-15)<.5&&Math.abs(${world}.y-(${pinched.y})-10)<.5&&Math.abs(${world}.scale.x-(${pinched.scale}))<.001`,
    );
    await touches('touchEnd', []);
    await shot('map');
    await fits('Map fits');
    await goto('/config/floorplan');
    await check(
      'Floorplan editor and tools render',
      `!!document.querySelector('canvas')&&!!${labeled('Walls tool')}`,
    );
    await click(labeled('Walls tool'));
    if (width < 900) await click(labeled('Close library'));
    await click(labeled('Fit entire floorplan'));
    await check(
      'Fit keeps the editor canvas within the viewport',
      "(()=>{const r=document.querySelector('canvas').getBoundingClientRect();return r.width>0&&r.height>0&&r.top>=0&&r.bottom<=innerHeight+1})()",
    );
    await fits('Floorplan editor fits');
    await shot('floorplan-editor');
    if (foreignRequests.length)
      throw Error('Unexpected external request: ' + foreignRequests.join(', '));
    if (
      requests.some(
        (request) =>
          !['block', 'helper'].includes(request.kind) && !request.definition,
      )
    )
      throw Error('Incorrect preview contract');
    return {
      passed: true,
      width,
      checks,
      preview:
        'Rendering fixtures; actual worker execution/no-dispatch verified by server tests.',
    };
  } catch (error) {
    await shot('failure');
    console.error(await evaluate('document.body.innerText.slice(-10000)'));
    throw error;
  } finally {
    await cdp.send('Fetch.disable');
  }
}
