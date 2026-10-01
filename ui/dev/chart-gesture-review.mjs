import { readFile, writeFile } from 'node:fs/promises';

/** Native taps, drags, cancellation and hover, using isolated fixture data. */
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config';
  const marker = await fetch(base + '/sensors/catalog');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Isolated fixture required');
  const saved = (await marker.json()).data;
  const request = async (path, body, method = 'POST') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw Error(await r.text());
    return (await r.json()).data;
  };
  let layout;
  const ids = [],
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
  const until = async (expr, label) => {
    for (let i = 0; i < 70; i++) {
      if (await evaluate(expr)) {
        checks.push(label);
        return;
      }
      await pause();
    }
    throw Error(label);
  };
  const reading = "document.querySelector('[data-chart-reading]')",
    dialog = "document.querySelector('[role=dialog]')";
  const point = async (selector) => {
    await evaluate(
      `document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center'})`,
    );
    await pause();
    return evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width*.6,y:r.y+r.height*.55}})()`,
    );
  };
  const mouse = async (type, p, buttons = 0) =>
    cdp.send('Input.dispatchMouseEvent', {
      type,
      ...p,
      button: buttons ? 'left' : 'none',
      buttons,
      clickCount: type === 'mouseMoved' ? 0 : 1,
    });
  const click = async (selector) => {
    const p = await point(selector);
    await mouse('mousePressed', p, 1);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await pause();
  };
  const touch = async (type, p) => {
    await cdp.send('Input.dispatchTouchEvent', {
      type,
      touchPoints: p ? [{ ...p, id: 1 }] : [],
    });
    await pause();
  };
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/chart-gesture-${width}-${name}.png`,
      Buffer.from(r.data, 'base64'),
    );
  };
  const close = async () => {
    await click('[role=dialog] [aria-label="Close"]');
    await until(`!${dialog}`, 'Details dismiss');
  };
  const inspectTouch = async (selector, name) => {
    const p = await point(selector);
    await touch('touchStart', p);
    await until(`!!${reading}`, name + ' shows reading while held');
    const start = await evaluate(`${reading}.textContent`);
    await touch('touchMove', { x: p.x - 40, y: p.y });
    await until(
      `${reading}&&${reading}.textContent!==${JSON.stringify(start)}`,
      name + ' drag changes reading',
    );
    const geometry = await evaluate(
      `(()=>{const r=${reading}.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,pointerEvents:getComputedStyle(${reading}).pointerEvents}})()`,
    );
    if (
      geometry.left < 0 ||
      geometry.right > width + 1 ||
      geometry.top < 0 ||
      geometry.bottom > (await evaluate('innerHeight')) ||
      geometry.pointerEvents !== 'none'
    )
      throw Error(
        'Tooltip outside viewport or intercepts input: ' +
          JSON.stringify(geometry),
      );
    await shot(name);
    await touch('touchEnd');
    await until(`!${reading}`, name + ' clears reading on release');
    return p;
  };
  try {
    await request(
      '/sensors/catalog',
      {
        expected: saved,
        sensors: [
          ...saved.sensors,
          ...['render_living', 'render_bedroom'].map((id, i) => ({
            id,
            name: i ? 'Bedroom climate' : 'Living climate',
            source: 'influxdb',
            enabled: true,
          })),
        ],
        groups: saved.groups,
      },
      'PUT',
    );
    layout = await request('/dashboard/layouts', {
      id: 0,
      name: 'Chart gesture review',
      is_default: false,
    });
    for (const [i, type] of [
      'weather',
      'spot_price',
      'indoor_climate',
      'sensors',
    ].entries())
      ids.push(
        (
          await request('/dashboard/widgets', {
            id: 0,
            layout_id: layout.id,
            widget_type: type,
            config: {
              title: type === 'indoor_climate' ? 'Climate' : 'Chart ' + type,
              options: {
                forecastHours: 24,
                temperatureSensorId: 'render_living',
                humiditySensorId: 'render_living',
              },
            },
            grid_x: 0,
            grid_y: i * 5,
            grid_w: 16,
            grid_h: 5,
            sort_order: i,
          })
        ).id,
      );
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: await readFile(
        new URL('./widget-bodies-fixture.js', import.meta.url),
        'utf8',
      ),
    });
    await cdp.send('Page.navigate', { url: origin + '/?layout=' + layout.id });
    await until(
      "document.querySelectorAll('.dashboard-widget-container').length===4&&!!document.querySelector('.dashboard-spot-card svg[role=slider]')",
      'Widget charts load',
    );
    await cdp.send('Emulation.setTouchEmulationEnabled', {
      enabled: true,
      maxTouchPoints: 1,
    });
    for (const [name, selector, title] of [
      [
        'weather',
        '.dashboard-weather-card svg[role=slider]',
        'Weather forecast',
      ],
      ['price', '.dashboard-spot-card svg[role=slider]', 'Electricity prices'],
    ]) {
      await inspectTouch(selector, name + '-widget');
      await until(`!${dialog}`, name + ' chart drag does not open details');
      let p = await point(selector);
      await touch('touchStart', p);
      await pause(500);
      await touch('touchEnd');
      await until(
        `!${reading}&&!${dialog}`,
        name + ' hold inspects without opening details',
      );
      if (name === 'weather' && width < 768) {
        const before = await evaluate(
          `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top`,
        );
        await touch('touchStart', p);
        await touch('touchMove', { x: p.x, y: p.y - 100 });
        await touch('touchEnd');
        await until(
          `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().top<${before - 20}&&!${reading}&&!${dialog}`,
          'Vertical touch gesture scrolls the page and clears inspection',
        );
        p = await point(selector);
      }
      await touch('touchStart', p);
      await touch('touchEnd');
      await until(
        `${dialog}?.textContent.includes(${JSON.stringify(title)})`,
        name + ' chart tap opens widget details',
      );
      await until(
        `!${reading}`,
        name + ' opening details leaves no stale tooltip',
      );
      if (name === 'weather')
        await click('[role=dialog] [role=tab][data-state="inactive"]');
      await until(
        "!!document.querySelector('[role=dialog] svg[role=slider]')",
        name + ' detail plot loads',
      );
      await inspectTouch('[role=dialog] svg[role=slider]', name + '-detail');
      await until(`!!${dialog}`, name + ' detail drag keeps dialog open');
      const cancelPoint = await point('[role=dialog] svg[role=slider]');
      await touch('touchStart', cancelPoint);
      await touch('touchCancel');
      await until(`!${reading}`, name + ' touch cancellation clears reading');
      await close();
    }
    const climate =
      '.dashboard-widget-container svg[aria-label="Living climate history"]';
    await until(
      `!!document.querySelector(${JSON.stringify(climate)})`,
      'Climate chart loads',
    );
    await inspectTouch(climate, 'climate-widget');
    await until(`!${dialog}`, 'Climate drag does not open details');
    const p = await point(climate);
    await touch('touchStart', p);
    await touch('touchEnd');
    await until(
      `${dialog}?.textContent.includes('Climate')`,
      'Climate chart tap opens details',
    );
    await inspectTouch('[role=dialog] svg[role=slider]', 'climate-detail');
    await close();
    await click('[aria-label="Open all climate sensors"]');
    await until(
      "!!document.querySelector('[role=dialog] svg[role=slider]')",
      'Multi-series sensor details load',
    );
    await inspectTouch('[role=dialog] svg[role=slider]', 'sensor-detail');
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    const s = '[role=dialog] svg[role=slider]';
    const h = await point(s);
    await mouse('mouseMoved', h);
    await until(`!!${reading}`, 'Mouse hover shows floating reading');
    await mouse('mouseMoved', { x: 10, y: 10 });
    await until(`!${reading}`, 'Mouse leave clears reading');
    await mouse('mousePressed', h, 1);
    await mouse('mouseMoved', { x: h.x + 25, y: h.y }, 1);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: h.x + 25,
      y: h.y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await pause();
    await until(`!${reading}`, 'Mouse release clears reading');
    await mouse('mousePressed', h, 1);
    await mouse('mouseMoved', { x: 10, y: 10 }, 1);
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: 10,
      y: 10,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await until(
      `!${reading}&&!!${dialog}`,
      'Release outside the plot clears reading without dismissing details',
    );
    await mouse('mouseMoved', h);
    await until(`!!${reading}`, 'Reading can reopen after release outside');
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      ...h,
      deltaX: 0,
      deltaY: 150,
    });
    await until(`!${reading}`, 'Scrolling clears floating reading');
    await evaluate(`document.querySelector(${JSON.stringify(s)}).focus()`);
    for (const key of ['Home', 'End']) {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        windowsVirtualKeyCode: key === 'Home' ? 36 : 35,
      });
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key });
      await pause();
      await until(
        `!!${reading}`,
        key + ' keyboard inspection remains available',
      );
    }
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
    await pause();
    await until(
      `!${reading}&&!!${dialog}`,
      'Escape clears reading before dismissing details',
    );
    await close();
    await click('.dashboard-spot-card svg[role=slider]');
    await until(
      `${dialog}?.textContent.includes('Electricity prices')`,
      'Mouse chart click opens widget details',
    );
    await close();
    return { passed: true, width, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    for (const id of ids)
      await request('/dashboard/widgets/' + id, undefined, 'DELETE');
    if (layout)
      await request('/dashboard/layouts/' + layout.id, undefined, 'DELETE');
    const current = await (await fetch(base + '/sensors/catalog')).json();
    await request(
      '/sensors/catalog',
      { expected: current.data, ...saved },
      'PUT',
    );
  }
}
