import { writeFile } from 'node:fs/promises';

/** Shared list and preference controls, using only the marked local fixture. */
export default async function (cdp, { url, width }) {
  const origin = 'http://127.0.0.1:3021';
  const marker = await fetch(origin + '/api/v1/config/sensors/catalog');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked isolated fixture required');
  let writes = 0;
  const exceptions = [],
    checks = [];
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.method !== 'GET' && request.url.startsWith(origin + '/api/'))
      writes++;
  });
  cdp.on('Fetch.requestPaused', async (e) => {
    if (e.request.method === 'GET')
      return cdp.send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify({
            success: true,
            data: {
              sensors: [
                {
                  id: 'unknown',
                  name: 'Unknown source',
                  source: 'future',
                  enabled: true,
                },
                {
                  id: 'empty',
                  name: 'Missing source',
                  source: '',
                  enabled: true,
                },
              ],
              groups: [],
            },
          }),
        ).toString('base64'),
      });
    await cdp.send('Fetch.continueRequest', { requestId: e.requestId });
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: origin + '/api/v1/config/sensors/catalog' }],
  });
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const pause = () => new Promise((r) => setTimeout(r, 150));
  const until = async (expr, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(message);
  };
  const label = (name) =>
    `document.querySelector(${JSON.stringify('[aria-label="' + name + '"]')})`;
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const key = async (name) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key: name,
        ...(name === 'Enter'
          ? {
              windowsVirtualKeyCode: 13,
              ...(type === 'keyDown' ? { text: '\r' } : {}),
            }
          : {}),
      });
  };
  const activate = async (expr) => {
    await evaluate(`(${expr}).focus()`);
    await key('Enter');
    await pause();
  };
  const select = async (name, text) => {
    await activate(label(name));
    await until("!!document.querySelector('[role=option]')", 'Options open');
    const item = `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(text)}))`;
    await until(`!!(${item})`, 'Named option');
    // Radix items receive keyboard focus; cmdk uses the active descendant.
    if (await evaluate(`(${item}).hasAttribute('cmdk-item')`)) {
      await evaluate(`document.querySelector('[cmdk-input]').focus()`);
      await cdp.send('Input.insertText', { text });
      await pause();
      await key('ArrowDown');
      await key('Enter');
    } else await activate(item);
    await until("!document.querySelector('[role=option]')", 'Selection closes');
    await pause();
  };
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const shot = async (name) => {
    await evaluate(
      name === 'preferences'
        ? `${label('Resize snap')}.scrollIntoView({block:'center'})`
        : 'window.scrollTo(0,0)',
    );
    await pause();
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/shared-list-controls-${width}-${name}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  try {
    await cdp.send('Page.navigate', { url: origin + '/config/devices' });
    await until(`!!${label('Device type')}`, 'Devices loaded');
    await select('Device type', 'Sensors');
    await check(
      'Device kind updates its URL',
      "new URLSearchParams(location.search).get('type')==='sensor'",
    );
    await select('Integration', 'zigbee2mqtt');
    await check(
      'Searchable integration retains other filters',
      "new URLSearchParams(location.search).get('integration')==='zigbee2mqtt' && new URLSearchParams(location.search).get('type')==='sensor'",
    );
    await select('Room or group', 'Living room');
    await check(
      'Room picker uses exact group identity',
      "new URLSearchParams(location.search).get('group')==='living_room'",
    );
    await select('Room or group', 'Clear selection');
    await check(
      'Clearing a room preserves the other filters',
      "!new URLSearchParams(location.search).has('group') && new URLSearchParams(location.search).get('integration')==='zigbee2mqtt'",
    );
    await shot('devices');
    await goto('/config/routines');
    await until(`!!${label('Filter routines')}`, 'Routines loaded');
    await select('Filter routines', 'Disabled');
    await check(
      'Routine status updates its URL',
      "new URLSearchParams(location.search).get('filter')==='disabled'",
    );
    await goto('/config/floorplan');
    await until(`!!${label('Select floorplan')}`, 'Floorplans loaded');
    await select('Select floorplan', 'Ground floor');
    await check(
      'Floorplan picker selects the exact ID',
      "new URLSearchParams(location.search).get('id')==='ground_floor'",
    );
    await goto('/config/floorplan?id=unavailable-floor');
    await until(
      `${label('Select floorplan')}?.textContent.includes('unavailable-floor')`,
      'Missing floorplan visible',
    );
    await check(
      'Unavailable floorplan selection is kept',
      `${label('Select floorplan')}.textContent.includes('(unavailable)')`,
    );
    await goto('/config/dashboard/1');
    await until(`!!${label('Resize snap')}`, 'Dashboard preferences');
    const before = await evaluate(
      "localStorage.getItem('homectl-dashboard-editing-settings')",
    );
    await select('Resize snap', 'Whole columns (1)');
    await select('Screen preview', 'Phone');
    await check(
      'Preference changes remain drafts',
      `localStorage.getItem('homectl-dashboard-editing-settings')===${JSON.stringify(before)} && !!${button('Discard')}`,
    );
    await goto('/config/routines');
    await goto('/config/dashboard/1');
    await until(
      `${label('Screen preview')}?.textContent.includes('Phone')`,
      'Retained preferences',
    );
    await check(
      'Preference draft survives navigation',
      `${label('Resize snap')}.textContent.includes('Whole columns')`,
    );
    await shot('preferences');
    await activate(button('Discard'));
    await until(`!${button('Discard')}`, 'Preference discard');
    await check(
      'Discard leaves saved browser preferences intact',
      `localStorage.getItem('homectl-dashboard-editing-settings')===${JSON.stringify(before)}`,
    );
    await goto('/config/devices/detail/zigbee2mqtt/bedroom_switch');
    await until(`!!${label('Sensor controls')}`, 'Sensor editor');
    const sensorBefore = await evaluate(
      `${label('Sensor controls')}.textContent`,
    );
    await select('Sensor controls', 'On / Off buttons');
    await check(
      'Sensor control choice makes a draft',
      `!!${button('Discard')}`,
    );
    await activate(button('Discard'));
    await until(
      `${label('Sensor controls')}?.textContent===${JSON.stringify(sensorBefore)}`,
      'Sensor discarded',
    );
    await goto('/config/sensors');
    await until(`!!${label('Source for Missing source')}`, 'Catalog loaded');
    await check(
      'Unknown and empty sensor sources remain visible',
      `${label('Source for Unknown source')}.textContent.includes('future') && ${label('Source for Missing source')}.textContent.includes('missing source')`,
    );
    await select('Source for Missing source', 'InfluxDB');
    await check(
      'Explicit source repair creates a draft',
      `!!${button('Discard')} && !${label('Source for Missing source')}`,
    );
    await activate(button('Discard'));
    await until(`!!${label('Source for Missing source')}`, 'Source discarded');
    await check(
      'Discard restores the original missing source',
      `${label('Source for Missing source')}.textContent.includes('missing source')`,
    );
    await shot('sensors');
    await check(
      'Touched page has no native dropdowns',
      "document.querySelectorAll('select').length===0",
    );
    await check(
      'Narrow layout has no page overflow',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    if (writes || exceptions.length)
      throw Error(JSON.stringify({ writes, exceptions }));
    checks.push({
      name: 'No configuration writes or page exceptions',
      passed: true,
    });
    return {
      passed: true,
      checks,
      scope: 'Local fixture; all configuration/preference drafts discarded',
    };
  } catch (e) {
    await shot('failure');
    throw e;
  } finally {
    await goto('/config');
    await cdp.send('Fetch.disable');
  }
}
