import { writeFile } from 'node:fs/promises';
export default async function (cdp, { url, width }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config';
  if (!url.startsWith(origin + '/')) throw Error('Fixture required');
  const marker = await fetch(base + '/sensors/catalog');
  if (marker.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Marked fixture required');
  const catalog = (await marker.json()).data,
    id = 'chart_review_' + Date.now();
  let layout;
  const write = async (path, body, method = 'POST') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  const until = async (expression, name) => {
    for (let i = 0; i < 180; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(name);
  };
  const checks = [];
  const check = async (name, expression) => {
    if (!(await evaluate(expression))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const click = async (expression) => {
    const p = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
  const dialog = `document.querySelector('[role="dialog"]')`;
  const shot = async (name) => {
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/chart-recovery-${width}-${name}.png`,
      Buffer.from(r.data, 'base64'),
    );
  };
  try {
    await write(
      '/sensors/catalog',
      {
        expected: catalog,
        sensors: [
          ...catalog.sensors,
          {
            id,
            name: 'Review climate source',
            source: 'influxdb',
            enabled: true,
          },
        ],
        groups: catalog.groups,
      },
      'PUT',
    );
    layout = await write('/dashboard/layouts', {
      id: 0,
      name: 'Chart recovery review',
      is_default: false,
    });
    for (const [i, type] of ['indoor_climate', 'sensors'].entries())
      await write('/dashboard/widgets', {
        id: 0,
        layout_id: layout.id,
        widget_type: type,
        config: {
          title: type === 'indoor_climate' ? 'Climate review' : 'Sensor review',
          options:
            type === 'indoor_climate'
              ? { temperatureSensorId: id, range: '-24h' }
              : { sensorSelection: 'selected', sensorIds: [id] },
        },
        grid_x: i * 4,
        grid_y: 0,
        grid_w: 4,
        grid_h: 4,
        sort_order: i,
      });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.chartMode='empty';const chartFetch=window.fetch.bind(window);const chartInterval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>chartInterval(fn,ms===60000?5000:ms,...args);const samples=[0,1].map(i=>({device_id:${JSON.stringify(id)},integration_id:'influxdb',_field:'tempc',_time:new Date(Date.now()-i*600000).toISOString(),_value:21.4-i*.3}));window.fetch=(input,init)=>String(input).includes('/api/influxdb/temp-sensors')?Promise.resolve(new Response(JSON.stringify(window.chartMode==='data'?samples:window.chartMode==='error'?{error:'Fixture unavailable'}:[]),{status:window.chartMode==='error'?503:200,headers:{'Content-Type':'application/json'}})):chartFetch(input,init);`,
    });
    await cdp.send('Page.navigate', { url: origin + '/?layout=' + layout.id });
    await cdp.send('Page.bringToFront');
    await until(
      `!!document.querySelector('[aria-label="Open Climate review details"]')`,
      'Widgets ready',
    );
    await click(
      `document.querySelector('[aria-label="Open Climate review details"]')`,
    );
    await until(
      `${dialog}?.textContent.includes('No readings available.')`,
      'Honest empty chart',
    );
    await check(
      'Empty history has no fabricated plot or zero measurement',
      `!${dialog}.querySelector('svg[role="slider"]')&&${dialog}.textContent.includes('—')&&${dialog}.textContent.includes('No temperature history available.')`,
    );
    await shot('empty');
    await click(`${dialog}.querySelector('button[aria-label="Close"]')`);
    await until(`!${dialog}`, 'Close empty climate');
    await click(
      `document.querySelector('[aria-label="Open all climate sensors"]')`,
    );
    await until(
      `${dialog}?.textContent.includes('Climate sensors')`,
      'Empty sensor card pointer opens details',
    );
    checks.push({
      name: 'Empty sensor card remains clickable across its surface',
      passed: true,
    });
    await click(`${dialog}.querySelector('button[aria-label="Close"]')`);
    await until(`!${dialog}`, 'Close empty sensors');
    await click(
      `document.querySelector('[aria-label="Open Climate review details"]')`,
    );
    await until(`!!${dialog}`, 'Return to climate');
    await evaluate(`window.chartMode='error'`);
    await until(
      `${dialog}?.textContent.includes('Readings could not be loaded.')`,
      'Initial error status',
    );
    await check(
      'Initial read failure offers retry and preserves honest missing values',
      `${dialog}.textContent.includes('Retry readings')&&!${dialog}.querySelector('svg[role="slider"]')`,
    );
    await shot('initial-error');
    await evaluate(`window.chartMode='data'`);
    await click(
      `[...${dialog}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry readings')`,
    );
    await until(
      `!!${dialog}?.querySelector('svg[role="slider"]')`,
      'Retry gives chart',
    );
    await check(
      'Retry displays sourced temperature without inventing humidity',
      `${dialog}.textContent.includes('21.4')&&${dialog}.textContent.includes('Humidity updated: No readings')`,
    );
    await until(
      `document.querySelector('[aria-label="Open all climate sensors"]')?.parentElement.textContent.includes('21.4')`,
      'Sensor widget has cached sample',
    );
    await evaluate(`window.chartMode='empty'`);
    await until(
      `${dialog}?.textContent.includes('The source returned no new readings.')`,
      'Empty refresh labeled',
    );
    await check(
      'Empty refresh retains chart with explicit last-sample status',
      `${dialog}.textContent.includes('21.4')&&!!${dialog}.querySelector('svg[role="slider"]')&&${dialog}.textContent.includes('last available samples')`,
    );
    await check(
      'Time-axis labels do not overlap',
      `(()=>{const labels=[...${dialog}.querySelectorAll('svg[role="slider"] > text')].map(e=>e.getBoundingClientRect());return labels.length>0&&labels.every((r,i)=>!i||r.left>=labels[i-1].right+2)})()`,
    );
    await check(
      'Overlay title and close control remain visible after retry',
      `(()=>{const d=${dialog},r=d.getBoundingClientRect(),h=d.querySelector('h2').getBoundingClientRect(),b=d.querySelector('button[aria-label="Close"]').getBoundingClientRect();return h.top>=r.top&&b.top>=r.top&&b.bottom<=r.bottom})()`,
    );
    await shot('retained');
    await evaluate(`window.chartMode='error'`);
    await until(
      `${dialog}?.textContent.includes('Readings could not be refreshed.')`,
      'Cached error',
    );
    await check(
      'Failed refresh retains samples and offers retry',
      `${dialog}.textContent.includes('21.4')&&${dialog}.textContent.includes('Retry readings')`,
    );
    await click(`${dialog}.querySelector('button[aria-label="Close"]')`);
    await until(`!${dialog}`, 'Close detail');
    await evaluate(
      `document.querySelector('[aria-label="Open all climate sensors"]').focus()`,
    );
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Enter',
      windowsVirtualKeyCode: 13,
      text: '\r',
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Enter',
      windowsVirtualKeyCode: 13,
    });
    await until(
      `${dialog}?.textContent.includes('Readings could not be refreshed.')`,
      'Sensor details carry status',
    );
    await check(
      'Sensor detail shares failure status and retained chart',
      `!!${dialog}.querySelector('svg[role="slider"]')&&${dialog}.textContent.includes('last available samples')`,
    );
    await shot('sensor-error');
    await evaluate(`window.chartMode='data'`);
    await click(
      `[...${dialog}.querySelectorAll('button')].find(b=>b.textContent.trim()==='Retry readings')`,
    );
    await until(
      `!${dialog}?.textContent.includes('could not be refreshed')`,
      'Sensor recovered',
    );
    await check(
      'Recovered sensor detail clears failure status',
      `!!${dialog}.querySelector('svg[role="slider"]')&&!${dialog}.textContent.includes('last available samples')`,
    );
    await check(
      'Detail stays within viewport',
      `(()=>{const r=${dialog}.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1&&document.documentElement.scrollWidth<=innerWidth+1})()`,
    );
    return { passed: true, checks, width };
  } finally {
    if (layout)
      await write('/dashboard/layouts/' + layout.id, undefined, 'DELETE');
    const current = (await (await fetch(base + '/sensors/catalog')).json())
      .data;
    await write(
      '/sensors/catalog',
      {
        expected: current,
        sensors: current.sensors.filter((s) => s.id !== id),
        groups: current.groups,
      },
      'PUT',
    );
  }
}
