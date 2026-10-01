import { readFile, writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const base = 'http://127.0.0.1:3021/api/v1/config';
  if (
    !url.startsWith('http://127.0.0.1:3021/') ||
    (await fetch(base + '/dashboard/layouts')).headers.get(
      'x-homectl-fixture',
    ) !== 'true'
  )
    throw Error('Isolated fixture required');
  const write = async (path, value) => {
    const r = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!r.ok) throw Error(await r.text());
    return (await r.json()).data;
  };
  const layout = await write('/dashboard/layouts', {
    id: 0,
    name: 'Compact widget review',
    is_default: false,
  });
  const definitions = [
    ['clock', 'Today', 2, 3, {}],
    ['train_schedule', 'Next departures', 3, 3, {}],
    [
      'helper_mode',
      'Entryway cooldown',
      3,
      3,
      { helperId: 'entryway_cooldown' },
    ],
    ['spot_price', 'Electricity', 4, 4, {}],
    [
      'weather',
      'Weather',
      4,
      4,
      { showWidgetForecast: true, forecastHours: 24 },
    ],
    ['controls', 'Lights', 4, 3, { groupId: 'living_room' }],
    ['sensors', 'Indoor climate', 4, 3, {}],
  ];
  const ids = [];
  try {
    for (const [
      i,
      [widget_type, title, grid_w, grid_h, options],
    ] of definitions.entries())
      ids.push(
        (
          await write('/dashboard/widgets', {
            id: 0,
            layout_id: layout.id,
            widget_type,
            config: { title, options },
            grid_x: 0,
            grid_y: i * 3,
            grid_w,
            grid_h,
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
    await cdp.send('Page.navigate', {
      url: 'http://127.0.0.1:3021/?layout=' + layout.id,
    });
    await cdp.send('Page.bringToFront');
    await new Promise((r) => setTimeout(r, 2300));
    const evaluate = async (expression) =>
      (await cdp.send('Runtime.evaluate', { expression, returnByValue: true }))
        .result.value;
    const check = await evaluate(
      `({cards:document.querySelectorAll('.dashboard-widget-container').length,overflow:document.documentElement.scrollWidth>innerWidth+1,text:document.body.innerText})`,
    );
    if (check.cards !== definitions.length || check.overflow)
      throw Error(JSON.stringify(check));
    const shot = async (suffix) => {
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
      });
      await writeFile(
        '/tmp/chart-refinement-' + width + '-' + suffix + '.png',
        Buffer.from(data, 'base64'),
      );
    };
    await shot('top');
    for (const name of ['spot', 'weather', 'controls', 'sensors']) {
      await evaluate(
        `document.querySelector('.dashboard-${name === 'controls' ? 'controls-title' : name + '-card'}')?.scrollIntoView({block:'start'})`,
      );
      await new Promise((r) => setTimeout(r, 180));
      await shot(name);
    }
    const checks = [];
    const key = async (key, code) => {
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key,
        code: key,
        windowsVirtualKeyCode: code,
        ...(key === 'Enter' ? { text: '\r' } : {}),
      });
      await cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key,
        code: key,
        windowsVirtualKeyCode: code,
      });
      await new Promise((r) => setTimeout(r, 180));
    };
    const indicator = `document.querySelector('[aria-label="Quick controls for Living room lamp"]')`;
    const commandCount = async () =>
      (
        await (
          await fetch('http://127.0.0.1:3021/api/__fixture/live-controls')
        ).json()
      ).commands.length;
    const before = await commandCount();
    await evaluate(
      `${indicator}.scrollIntoView({block:'center'});${indicator}.focus()`,
    );
    await key('Enter', 13);
    if (
      !(await evaluate(
        `!!document.querySelector('[aria-label="Living room lamp quick controls"]')`,
      ))
    )
      throw Error('Keyboard quick controls');
    if ((await commandCount()) !== before)
      throw Error('Opening quick controls issued command');
    checks.push('Keyboard opens shared quick controls without writes');
    await shot('quick');
    await evaluate(
      `document.querySelector('[aria-label="Living room lamp quick controls"] [aria-label="Living room lamp brightness"][role="slider"]').focus()`,
    );
    await key('ArrowRight', 39);
    if ((await commandCount()) !== before + 1)
      throw Error('Keyboard brightness command missing or duplicated');
    checks.push('Keyboard brightness uses one acknowledged command');
    await key('Escape', 27);
    if (!(await evaluate(`document.activeElement===${indicator}`)))
      throw Error('Focus not restored');
    checks.push('Escape closes quick controls and restores focus');

    await evaluate(
      `(()=>{const e=document.querySelector('.dashboard-spot-card').closest('.dashboard-widget-container');e.style.setProperty('height','170px','important');e.scrollIntoView({block:'center'});})()`,
    );
    await new Promise((r) => setTimeout(r, 400));
    const priceGeometry = await evaluate(
      `(()=>{const card=document.querySelector('.dashboard-spot-card').getBoundingClientRect(),svg=document.querySelector('svg[aria-label="Electricity prices"]'),r=svg.getBoundingClientRect();return{cardHeight:card.height,chartHeight:r.height,axisInside:r.bottom<=card.bottom-3};})()`,
    );
    if (
      priceGeometry.cardHeight !== 170 ||
      priceGeometry.chartHeight < 110 ||
      !priceGeometry.axisInside
    )
      throw Error('170px price chart: ' + JSON.stringify(priceGeometry));
    checks.push('170px price card has readable chart and unclipped axis');
    await evaluate(
      `document.querySelector('svg[aria-label="Electricity prices"]').focus()`,
    );
    await key('ArrowRight', 39);
    if (
      !(await evaluate(
        `(()=>{const svg=document.querySelector('svg[aria-label="Electricity prices"]'),r=svg.querySelector('rect.fill-background'),plot=svg.querySelector('clipPath rect');return r&&plot&&Number(r.getAttribute('height'))===Number(plot.getAttribute('height'));})()`,
      ))
    )
      throw Error('Full plot height highlight');
    checks.push('Bar inspection highlights the full plot height');
    await shot('price-170');
    await evaluate(
      `document.querySelector('.dashboard-weather-card').scrollIntoView({block:'center'});`,
    );
    await new Promise((r) => setTimeout(r, 250));
    if (
      !(await evaluate(
        `(()=>{const labels=[...document.querySelectorAll('.dashboard-weather-card [data-axis="y"] title')];return labels.length===2&&labels[0].textContent.includes('Low')&&labels[1].textContent.includes('High')&&labels.every(e=>e.textContent.includes(' · '));})()`,
      ))
    )
      throw Error('Weather extremes');
    checks.push('Weather forecast shows low/high temperatures and times');
    await evaluate(
      `document.querySelector('svg[aria-label="Weather forecast temperature"]').focus()`,
    );
    await key('ArrowRight', 39);
    if (
      !(await evaluate(
        `document.querySelector('svg[aria-label="Weather forecast temperature"]').getAttribute('aria-valuetext').includes('Temperature:')&&!document.querySelector('[role="dialog"]')`,
      ))
    )
      throw Error('Inline weather inspection');
    checks.push('Inline forecast keyboard inspection does not open details');
    const weatherPoint = await evaluate(
      `(()=>{const r=document.querySelector('svg[aria-label="Weather forecast temperature"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...weatherPoint,
    });
    await new Promise((r) => setTimeout(r, 150));
    if (
      !(await evaluate(
        `document.querySelector('svg[aria-label="Weather forecast temperature"]').getAttribute('aria-valuetext').includes('Temperature:')&&!document.querySelector('[role="dialog"]')`,
      ))
    )
      throw Error('Forecast hover inspection');
    checks.push('Native hover inspects inline forecast');
    if (width < 768) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...weatherPoint, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: weatherPoint.x + 20, y: weatherPoint.y, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await new Promise((r) => setTimeout(r, 150));
      if (
        !(await evaluate(
          `!document.querySelector('[data-chart-reading]')&&!document.querySelector('[role="dialog"]')`,
        ))
      )
        throw Error('Forecast touch inspection');
      checks.push(
        'Native touch drag clears weather reading on release without opening details',
      );
    }

    await shot('weather-inspect');
    await evaluate(
      `document.querySelector('[aria-label="Open weather details"]').focus()`,
    );
    await key('Enter', 13);
    await new Promise((r) => setTimeout(r, 300));
    const tabsFit = await evaluate(
      `(()=>{const row=document.querySelector('[role="tablist"]');return row&&[...row.children].every(e=>{const r=e.getBoundingClientRect(),p=row.getBoundingClientRect();return r.top>=p.top&&r.bottom<=p.bottom;});})()`,
    );
    if (!tabsFit) throw Error('Weather tabs exceed track');
    checks.push('Weather tabs fit their track');
    await evaluate(
      `[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Charts').focus()`,
    );
    await key('Enter', 13);
    await shot('weather-tabs');
    return { passed: true, checks, priceGeometry, ...check };
  } finally {
    for (const id of ids)
      await fetch(base + '/dashboard/widgets/' + id, { method: 'DELETE' });
    await fetch(base + '/dashboard/layouts/' + layout.id, { method: 'DELETE' });
  }
}
