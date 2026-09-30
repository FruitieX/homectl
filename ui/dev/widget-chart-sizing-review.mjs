import { readFile, mkdir, writeFile } from 'node:fs/promises';

export default async function (cdp, { url, width }) {
  const base = 'http://127.0.0.1:3021/api/v1/config';
  if (
    !url.startsWith('http://127.0.0.1:3021/') ||
    (await fetch(base + '/dashboard/layouts')).headers.get(
      'x-homectl-fixture',
    ) !== 'true'
  )
    throw Error('Isolated fixture required');
  const write = async (path, value) => {
    const response = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
    if (!response.ok) throw Error(await response.text());
    return (await response.json()).data;
  };
  const layout = await write('/dashboard/layouts', {
    id: 0,
    name: 'Chart sizing review',
    is_default: false,
  });
  const ids = [],
    checks = [],
    geometries = [];
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const pause = () => new Promise((resolve) => setTimeout(resolve, 400));
  const evidence = new URL(
    '../../docs/settings-overhaul-2026-09/implementation-evidence/widget-chart-sizing/',
    import.meta.url,
  );
  await mkdir(evidence, { recursive: true });
  const shot = async (name, selector) => {
    const box = await evaluate(
      `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:1}})()`,
    );
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: true,
      clip: box,
    });
    await writeFile(
      new URL(width + '-' + name + '.png', evidence),
      Buffer.from(data, 'base64'),
    );
  };
  try {
    for (const [i, widget_type] of ['weather', 'sensors'].entries())
      ids.push(
        (
          await write('/dashboard/widgets', {
            id: 0,
            layout_id: layout.id,
            widget_type,
            config: {
              title: widget_type === 'weather' ? 'Weather' : 'Climate sensors',
              options: { forecastHours: 48 },
            },
            grid_x: 0,
            grid_y: i * 6,
            grid_w: 16,
            grid_h: 6,
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
    await new Promise((resolve) => setTimeout(resolve, 1800));
    const available = await evaluate(
      `document.querySelector('.dashboard-weather-card').getBoundingClientRect().width`,
    );
    for (const requestedWidth of width < 700 ? [240, 360] : [240, 360, 520]) {
      const cardWidth = Math.min(requestedWidth, available);
      for (const height of [120, 144, 170, 220, 280, 360, 420]) {
        await evaluate(`(()=>{for(const card of document.querySelectorAll('.dashboard-weather-card,.dashboard-sensors-card')){
          card.style.setProperty('height','${height}px','important');card.style.setProperty('width','${cardWidth}px','important');
          card.closest('.dashboard-layout-item').style.setProperty('height','${height}px','important');
        }document.querySelector('.dashboard-weather-card').scrollIntoView({block:'center'});})()`);
        await pause();
        const result = await evaluate(`(()=>{
          const card=document.querySelector('.dashboard-weather-card'),svg=card.querySelector('svg[aria-label="Weather forecast temperature"]');
          const c=card.getBoundingClientRect(),r=svg?.getBoundingClientRect(),plot=svg?.querySelector('clipPath rect');
          const visible=!!r&&r.height>0;
          const y=[...(svg?.querySelectorAll('[data-axis="y"]')??[])],x=[...(svg?.querySelectorAll('[data-axis="x"]')??[])];
          const boxes=y.map(e=>e.getBoundingClientRect());
          const overlap=boxes.length===2&&Math.min(boxes[0].bottom,boxes[1].bottom)>Math.max(boxes[0].top,boxes[1].top);
          return {height:c.height,width:c.width,visible,chartHeight:r?.height??0,plotHeight:Number(plot?.getAttribute('height')??0),axisInside:visible&&r.bottom<=c.bottom-3,yCount:y.length,xCount:x.length,dayTime:x.every(e=>e.querySelectorAll('tspan').length===2),overlap,
            labelsInside:visible&&[...x,...y].every(e=>{const b=e.getBoundingClientRect();return b.left>=c.left&&b.right<=c.right&&b.bottom<=c.bottom-3;}),
            hoursVisible:card.querySelector('.dashboard-weather-hours').getBoundingClientRect().height>0};
        })()`);
        if (
          height >= 144 &&
          (!result.visible ||
            result.plotHeight < 45 ||
            !result.axisInside ||
            !result.labelsInside ||
            result.yCount !== 2 ||
            result.xCount < 3 ||
            result.xCount > 4 ||
            !result.dayTime ||
            result.overlap)
        )
          throw Error('Weather sizing: ' + JSON.stringify(result));
        if (height < 144 && result.visible)
          throw Error('Tiny weather card should use summary');
        if (result.hoursVisible !== (height > 360 && cardWidth > 322))
          throw Error('Forecast strip threshold: ' + JSON.stringify(result));
        geometries.push(result);
        checks.push(
          'Weather ' +
            Math.round(cardWidth) +
            '×' +
            height +
            ': readable axes or deliberate summary',
        );

        await evaluate(
          `document.querySelector('.dashboard-sensors-card').scrollIntoView({block:'center'})`,
        );
        await pause();
        const sensors = await evaluate(`(()=>{
          const card=document.querySelector('.dashboard-sensors-card'),chips=[...card.querySelectorAll('.dashboard-sensor-chip')];
          return {count:chips.length,readings:chips.map(chip=>{
            const b=chip.querySelector('.dashboard-sensor-sparkline-band').getBoundingClientRect(),chart=chip.querySelector('.dashboard-sensor-sparkline'),c=chip.getBoundingClientRect();
            return {band:b.height,chartVisible:chart&&getComputedStyle(chart).display!=='none',inside:b.bottom<=c.bottom,humidity:getComputedStyle(chip.querySelector('.dashboard-sensor-humidity')).display,temperature:parseFloat(getComputedStyle(chip.querySelector('.dashboard-sensor-temperature')).fontSize)};
          })};
        })()`);
        if (
          sensors.count !== 2 ||
          sensors.readings.some(
            (s) =>
              height >= 144 && (s.band < 24 || !s.chartVisible || !s.inside),
          )
        )
          throw Error(
            'Sensor sizing ' +
              cardWidth +
              '×' +
              height +
              ': ' +
              JSON.stringify(sensors),
          );
        checks.push(
          'Sensors ' +
            Math.round(cardWidth) +
            '×' +
            height +
            ': retained previews with readable sparklines',
        );
        if (requestedWidth === 360 && height === 170) {
          await shot('sensors-170', '.dashboard-sensors-card');
          await evaluate(
            `document.querySelector('.dashboard-weather-card').scrollIntoView({block:'center'})`,
          );
          await pause();
          await shot('weather-170', '.dashboard-weather-card');
        }
        if (requestedWidth === (width < 700 ? 360 : 520) && height === 420) {
          await evaluate(
            `document.querySelector('.dashboard-weather-card').scrollIntoView({block:'center'})`,
          );
          await pause();
          await shot('weather-420', '.dashboard-weather-card');
        }
      }
    }
    await evaluate(
      `document.querySelector('svg[aria-label="Weather forecast temperature"]').focus()`,
    );
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'ArrowRight',
      code: 'ArrowRight',
      windowsVirtualKeyCode: 39,
    });
    await pause();
    if (
      !(await evaluate(
        `document.querySelector('svg[aria-label="Weather forecast temperature"]').getAttribute('aria-valuetext').includes('Temperature:')&&!document.querySelector('[role="dialog"]')`,
      ))
    )
      throw Error('Inline chart keyboard inspection');
    checks.push('Inline keyboard inspection preserves weather details access');
    const point = await evaluate(
      `(()=>{const r=document.querySelector('svg[aria-label="Weather forecast temperature"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      ...point,
    });
    await pause();
    if (
      !(await evaluate(
        `document.querySelector('svg[aria-label="Weather forecast temperature"]').getAttribute('aria-valuetext').includes('Temperature:')&&!document.querySelector('[role="dialog"]')`,
      ))
    )
      throw Error('Weather hover inspection');
    checks.push(
      'Hover inspects the forecast without opening the weather dialog',
    );
    if (width < 700) {
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...point, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: point.x + 20, y: point.y, id: 1 }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      });
      await pause();
      if (
        !(await evaluate(
          `document.querySelector('svg[aria-label="Weather forecast temperature"]').getAttribute('aria-valuetext').includes('Temperature:')&&!document.querySelector('[role="dialog"]')`,
        ))
      )
        throw Error('Weather touch inspection');
      checks.push(
        'Phone drag retains the forecast reading without opening details',
      );
    }
    await evaluate(
      `document.querySelector('[aria-label="Open weather details"]').click()`,
    );
    await pause();
    await evaluate(
      `[...document.querySelectorAll('[role="tab"]')].find(e=>e.textContent==='Charts').focus()`,
    );
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await pause();
    const detail = await evaluate(
      `(()=>{const svg=document.querySelector('svg[aria-label="temperature forecast"]');return {count:svg?.querySelectorAll('[data-axis="y"]').length,dateLabels:[...svg?.querySelectorAll('[data-axis="x"]')??[]].every(e=>e.querySelectorAll('tspan').length===2)}})()`,
    );
    if (detail.count !== 2 || !detail.dateLabels)
      throw Error('Weather detail axes: ' + JSON.stringify(detail));
    checks.push(
      'Weather detail temperature chart uses low/high and day-time axes',
    );
    await evaluate(
      `document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`,
    );
    await pause();
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `const chartFetch=window.fetch;window.fetch=(input,init)=>chartFetch(input,init).then(async response=>{
        if(!String(input).includes('/api/weather'))return response;
        const data=await response.clone().json();data.properties.timeseries.forEach((row,i)=>row.data.instant.details.air_temperature=5+i*0.001);
        return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
      });`,
    });
    await cdp.send('Page.reload');
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const nearFlat = await evaluate(
      `(()=>{const card=document.querySelector('.dashboard-weather-card'),y=[...card.querySelectorAll('[data-axis="y"]')];const a=y[0]?.getBoundingClientRect(),b=y[1]?.getBoundingClientRect();return y.length===2&&Math.min(a.bottom,b.bottom)<=Math.max(a.top,b.top)})()`,
    );
    if (!nearFlat)
      throw Error('Near-constant temperature extrema labels overlap');
    checks.push(
      'Near-constant temperatures retain distinct, non-overlapping extrema labels',
    );
    return { passed: true, checks, geometries };
  } finally {
    for (const id of ids)
      await fetch(base + '/dashboard/widgets/' + id, { method: 'DELETE' });
    await fetch(base + '/dashboard/layouts/' + layout.id, { method: 'DELETE' });
  }
}
