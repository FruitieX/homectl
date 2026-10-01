/**
 * Quick-control dismissal review.
 *
 * Tapping past a light or sensor quick-control popover must only dismiss it:
 * the dismissing tap must not also open the light, sensor or room it landed
 * on. A later tap on the same target must still work normally.
 *
 * Runs against the marked isolated fixture on port 3021, e.g.
 *
 *   CDP_PORT=9337 node ui/dev/cdp-probe.mjs \
 *     --url http://127.0.0.1:3021/map --width 430 --height 932 \
 *     --driver-file ui/dev/quick-dismiss-review.mjs
 */
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
  const id = 'quick_dismiss_' + Date.now();
  const name = 'Quick dismiss ' + id;
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
      if (await evaluate(`Boolean(${expression})`)) {
        checks.push(message);
        return;
      }
      await pause();
    }
    console.error(
      'Review failure',
      message,
      await evaluate(
        `({text:document.body.innerText.slice(0,1500),popovers:[...document.querySelectorAll('[aria-label$="quick controls"]')].map(e=>e.getAttribute('aria-label'))})`,
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
  const keyEscape = async () => {
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
      windowsVirtualKeyCode: 27,
    });
    await pause();
  };
  const shot = async (suffix) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/quick-dismiss-${width}-${suffix}.png`,
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
      ['living_room_lamp', 3, 2],
      ['living_room_floor_lamp', 16, 9],
      ['living_room_motion', 6, 5],
    ].map(([key, x, y]) => ({
      deviceKey: 'zigbee2mqtt/' + key,
      deviceName: key,
      x,
      y,
    })),
    // A room mask far from the anchor light, so its area can be tapped on its
    // own without landing under the open popover.
    groups: {
      living_room: [2, 3, 4].flatMap((y) =>
        [13, 14, 15, 16].map((x) => ({ x, y })),
      ),
    },
  };
  await request(
    `/api/v1/config/floorplans/${id}/editor`,
    {
      id,
      name,
      grid_data: JSON.stringify(grid),
      image: { kind: 'none' },
      create_only: true,
    },
    'PUT',
  );

  const commands = async () =>
    (await (await fetch(base + '/api/__fixture/live-controls')).json())
      .commands;

  await cdp.send('Page.navigate', { url: base + '/map' });
  await cdp.send('Page.bringToFront');
  await until(`!!${button(name)}`, 'Floorplan tab available');
  await click(button(name));
  await until(`!!document.querySelector('canvas')`, 'Map renders');

  // Scene -> screen location of a grid cell, following the renderer's fit.
  const point = async (x = 3, y = 3) => {
    await pause(350);
    return evaluate(
      `(()=>{const r=document.querySelector('canvas').getBoundingClientRect(),s=.86*Math.min(r.width/640,r.height/384);return{x:r.left+(r.width-640*s)/2+(${x}*32+16)*s,y:r.top+(r.height-384*s)/2+(${y}*32+16)*s};})()`,
    );
  };
  const lightPop = `document.querySelector('[aria-label="Living room lamp quick controls"]')`;
  const otherPop = `document.querySelector('[aria-label="Floor lamp quick controls"]')`;
  const sensorPop = `document.querySelector('[aria-label="Living room motion sensor quick controls"]')`;
  const inspector = `document.querySelector('[aria-label="Floorplan inspector"]')`;
  const inspectorTitle = `(document.querySelector('[aria-label="Floorplan inspector"] h2')?.textContent??'')`;
  // The dismissing tap has to land on the map, never on the popover itself.
  const assertClearOfPopover = async (p, popSelector, label) => {
    const overlap = await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(popSelector)});if(!e)return false;const r=e.getBoundingClientRect(),t=r.top-84,m=8;return ${p.x}>=r.left-m&&${p.x}<=r.right+m&&${p.y}>=t-m&&${p.y}<=r.bottom+m;})()`,
    );
    if (overlap)
      throw Error(
        `${label} overlaps the open popover: ${JSON.stringify({ p, popSelector })}`,
      );
  };
  const expectAbsent = async (expression, message) => {
    await pause(500);
    if (await evaluate(`Boolean(${expression})`))
      throw Error(
        `${message}: ${await evaluate(`JSON.stringify({text:document.body.innerText.slice(0,600),title:document.querySelector('[aria-label="Floorplan inspector"] h2')?.textContent})`)}`,
      );
    checks.push(message);
  };
  const holdLight = async (x, y, pop, label) => {
    const p = await point(x, y);
    await pointer('down', p);
    await pause(620);
    await until(`!!${pop}`, `Hold opens ${label}`);
    await pointer('up', p);
    await pause(120);
  };
  const closeInspector = async () => {
    await click(
      `document.querySelector('[aria-label="Floorplan inspector"] button[aria-label="Close controls"]')`,
    );
    await until(`!${inspector}`, 'Panel closes again');
  };

  const commandsBefore = (await commands()).length;

  // 1. Tapping past the popover on another light must only dismiss it.
  await holdLight(3, 2, lightPop, 'the light quick controls');
  await shot('light-open');
  let q = await point(16, 9);
  await assertClearOfPopover(
    q,
    '[aria-label="Living room lamp quick controls"]',
    'Light tap target',
  );
  await pointer('down', q);
  await pointer('up', q);
  await until(`!${lightPop}`, 'Tap past the light controls dismisses them');
  await expectAbsent(
    inspector,
    'Dismissing tap did not open the light it landed on',
  );
  await shot('light-dismissed');
  // The same tap target still works on the next tap.
  q = await point(16, 9);
  await pointer('down', q);
  await pointer('up', q);
  await until(
    `!!${inspector}&&${inspectorTitle}==='Floor lamp'`,
    'A later tap still opens that light',
  );
  await shot('light-reopened');
  await closeInspector();

  // 2. Tapping a room area past the popover must only dismiss it.
  await holdLight(3, 2, lightPop, 'the light quick controls');
  q = await point(15, 3);
  await assertClearOfPopover(
    q,
    '[aria-label="Living room lamp quick controls"]',
    'Room tap target',
  );
  await pointer('down', q);
  await pointer('up', q);
  await until(`!${lightPop}`, 'Tap past the light controls dismisses them');
  await expectAbsent(
    inspector,
    'Dismissing tap did not open the room it landed on',
  );
  q = await point(15, 3);
  await pointer('down', q);
  await pointer('up', q);
  await until(
    `!!${inspector}&&${inspectorTitle}==='Living room'`,
    'A later tap still opens that room',
  );
  await closeInspector();

  // 3. Plain floor stays a no-op either way.
  await holdLight(3, 2, lightPop, 'the light quick controls');
  q = await point(17, 10);
  await assertClearOfPopover(
    q,
    '[aria-label="Living room lamp quick controls"]',
    'Floor tap target',
  );
  await pointer('down', q);
  await pointer('up', q);
  await until(`!${lightPop}`, 'Tap past the light controls dismisses them');
  await expectAbsent(inspector, 'Dismissing tap on plain floor opened nothing');
  checks.push('Tap on plain floor still only dismisses');

  // 4. Holding another light while controls are open still switches to it.
  await holdLight(3, 2, lightPop, 'the light quick controls');
  await holdLight(16, 9, otherPop, 'the second light quick controls');
  await until(
    `!${lightPop}`,
    'Switching to the held light closes the first popover',
  );
  await keyEscape();
  await until(`!${otherPop}`, 'Escape closes the held light controls');

  // 5. The same rule holds for the sensor quick controls.
  let s = await point(6, 5);
  await pointer('down', s);
  await pause(620);
  await until(`!!${sensorPop}`, 'Hold opens the sensor quick controls');
  await pointer('up', s);
  await pause(200);
  q = await point(16, 9);
  await assertClearOfPopover(
    q,
    '[aria-label="Living room motion sensor quick controls"]',
    'Sensor dismissal tap target',
  );
  await pointer('down', q);
  await pointer('up', q);
  await until(
    `!${sensorPop}`,
    'Tap past the sensor quick controls dismisses them',
  );
  await expectAbsent(
    inspector,
    'Sensor dismissal tap did not open the light it landed on',
  );
  q = await point(16, 9);
  await pointer('down', q);
  await pointer('up', q);
  await until(
    `!!${inspector}&&${inspectorTitle}==='Floor lamp'`,
    'A later tap still opens that light',
  );
  await closeInspector();

  const commandsAfter = (await commands()).length;
  if (commandsAfter !== commandsBefore)
    throw Error(
      `Dismissing taps sent device commands: ${JSON.stringify({ commandsBefore, commandsAfter })}`,
    );
  checks.push('No device command was sent while dismissing the popovers');

  return { passed: true, viewport: { width }, checks };
}
