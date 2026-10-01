import { writeFile } from 'node:fs/promises';

/** Native multi-touch continuity checks against the isolated fixture. */
export default async function (cdp, { width, url }) {
  const base = 'http://127.0.0.1:3021';
  if (
    !url.startsWith(base + '/') ||
    (await fetch(base + '/api/v1/config/floorplans')).headers.get(
      'x-homectl-fixture',
    ) !== 'true'
  )
    throw Error('Isolated fixture required');
  const id = 'pinch_review_' + Date.now(),
    name = 'Pinch review ' + id;
  const checks = [],
    transforms = [];
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
  const pause = (ms = 100) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression, label) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate(expression)) {
        checks.push(label);
        return;
      }
      await pause();
    }
    throw Error(label);
  };
  const view = () =>
    evaluate(
      '(()=>{const w=window.__pinchApps.find(a=>a.renderer?.canvas===document.querySelector("canvas"))?.stage.children[0];return w?{x:w.x,y:w.y,scale:w.scale.x}:null})()',
    );
  const touch = async (type, points) => {
    await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
    await pause();
  };
  const assertDelta = (before, after, dx, dy, label) => {
    transforms.push({ label, before, after, expectedDelta: { x: dx, y: dy } });
    if (
      Math.abs(after.x - before.x - dx) > 0.15 ||
      Math.abs(after.y - before.y - dy) > 0.15 ||
      Math.abs(after.scale - before.scale) > 0.0001
    )
      throw Error(label + ': ' + JSON.stringify(transforms.at(-1)));
    checks.push(label);
  };
  const controls =
    "document.querySelector('[aria-label=\"Floorplan inspector\"]')||document.querySelector('.radial-light-control')";
  const load = async () => {
    await cdp.send('Page.navigate', { url: base + '/map' });
    const button = `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(name)})`;
    await until(`!!${button}`, 'Fixture floorplan available');
    await evaluate(`${button}.click()`);
    await until(
      '!!document.querySelector("canvas")&&window.__pinchApps.some(a=>a.renderer?.canvas===document.querySelector("canvas")&&a.stage.children.length)',
      'Pixi world renders',
    );
    await pause(400);
  };
  const points = async () => {
    const v = await view();
    const box = await evaluate(
      '(()=>{const r=document.querySelector("canvas").getBoundingClientRect();return{x:r.left,y:r.top,width:r.width,height:r.height}})()',
    );
    // First contact starts on a light, so a pinch must cancel its pending hold.
    return [
      { id: 1, x: box.x + v.x + 176 * v.scale, y: box.y + v.y + 176 * v.scale },
      {
        id: 2,
        x: box.x + v.x + 176 * v.scale + 100,
        y: box.y + v.y + 176 * v.scale,
      },
    ];
  };
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
    source:
      'window.__pinchApps=[];window.__PIXI_APP_INIT__=app=>window.__pinchApps.push(app);',
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', {
    enabled: true,
    maxTouchPoints: 5,
  });
  const response = await fetch(
    `${base}/api/v1/config/floorplans/${id}/editor`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name,
        create_only: true,
        image: { kind: 'none' },
        grid_data: JSON.stringify({
          width: 20,
          height: 12,
          tileSize: 32,
          deviceScale: 1,
          labelMode: 'all',
          groups: {},
          tiles: Array.from({ length: 12 }, (_, y) =>
            Array.from({ length: 20 }, (_, x) =>
              x === 0 || y === 0 || x === 19 || y === 11 ? 'wall' : 'floor',
            ),
          ),
          devices: [
            {
              deviceKey: 'zigbee2mqtt/living_room_lamp',
              deviceName: 'Living room lamp',
              x: 5,
              y: 5,
            },
          ],
        }),
      }),
    },
  );
  if (!response.ok) throw Error(await response.text());
  try {
    for (const lifted of [1, 2]) {
      await load();
      const start = await points(),
        initial = await view();
      await touch('touchStart', [start[0]]);
      await touch('touchStart', start);
      const moved = start.map((p, i) => ({
        ...p,
        x: p.x + (i ? 40 : -35),
        y: p.y + (i ? 28 : 12),
      }));
      await touch('touchMove', moved);
      const pinched = await view();
      if (pinched.scale <= initial.scale * 1.2)
        throw Error('Pinch did not zoom');
      checks.push(`Pinch zooms before lifting finger ${lifted}`);
      // CDP touchEnd lists the contacts being lifted, not those left down.
      await touch(
        'touchEnd',
        moved.filter((p) => p.id === lifted),
      );
      assertDelta(
        pinched,
        await view(),
        0,
        0,
        `Lifting finger ${lifted} does not shift the canvas`,
      );
      const survivor = moved.find((p) => p.id !== lifted);
      await touch('touchMove', [survivor]);
      assertDelta(
        pinched,
        await view(),
        0,
        0,
        `Stationary surviving finger after ${lifted} does not snap`,
      );
      await pause(600);
      await until(
        `!(${controls})`,
        'Pinch never opens light details or long-press controls',
      );
      const next = { ...survivor, x: survivor.x + 12, y: survivor.y + 9 };
      await touch('touchMove', [next]);
      assertDelta(
        pinched,
        await view(),
        12,
        9,
        `Surviving finger after ${lifted} pans only its new movement`,
      );
      const panned = await view();
      await touch('touchEnd', []);
      assertDelta(
        panned,
        await view(),
        0,
        0,
        'Final release does not shift the canvas',
      );
      await until(
        `!(${controls})`,
        'Releasing a pinch does not activate a map target',
      );
    }
    await load();
    const pair = await points();
    const third = { id: 3, x: pair[1].x - 40, y: pair[1].y + 80 };
    await touch('touchStart', [pair[0]]);
    await touch('touchStart', pair);
    await touch('touchStart', [...pair, third]);
    const beforePairChange = await view();
    await touch('touchEnd', [pair[0]]);
    await touch('touchMove', [pair[1], third]);
    assertDelta(
      beforePairChange,
      await view(),
      0,
      0,
      'Three-to-two fingers rebase the pinch without a snap',
    );
    await touch('touchCancel', []);
    assertDelta(
      beforePairChange,
      await view(),
      0,
      0,
      'Canceled pinch does not shift the canvas',
    );
    await pause(600);
    await until(`!(${controls})`, 'Canceled pinch does not open controls');
    const fresh = { ...pair[0], id: 4 };
    await touch('touchStart', [fresh]);
    await touch('touchMove', [{ ...fresh, x: fresh.x + 25, y: fresh.y + 18 }]);
    assertDelta(
      beforePairChange,
      await view(),
      25,
      18,
      'A fresh one-finger pan still works after cancellation',
    );
    await touch('touchEnd', []);
    return { passed: true, width, checks, transforms };
  } catch (error) {
    console.error(JSON.stringify({ checks, transforms }));
    throw error;
  } finally {
    // Chromium rejects cancellation if the journey already released every contact.
    await cdp
      .send('Input.dispatchTouchEvent', {
        type: 'touchCancel',
        touchPoints: [],
      })
      .catch(() => {});
    await fetch(`${base}/api/v1/config/floorplans/${id}`, { method: 'DELETE' });
  }
}
