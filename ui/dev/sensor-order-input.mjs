/** Native-keyboard ordering and dashboard propagation against the isolated fixture. */
export default async function (cdp, { width, url }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Fixture required');
  const base = 'http://127.0.0.1:3021/api/v1/config';
  const response = await fetch(base + '/sensors/catalog');
  if (response.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Marked fixture required');
  const original = (await response.json()).data;
  const api = async (path, body, method = 'PUT') => {
    const r = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!r.ok) throw Error(await r.text());
    return r.status === 204 ? null : (await r.json()).data;
  };
  const seed = {
    sensors: [
      {
        id: 'render_living',
        name: 'Living climate',
        source: 'influxdb',
        enabled: true,
      },
      {
        id: 'render_bedroom',
        name: 'Bedroom climate',
        source: 'influxdb',
        enabled: true,
      },
      { id: 'outdoor', name: 'Outside', source: 'influxdb', enabled: true },
    ],
    groups: [
      {
        id: 'indoor',
        name: 'Indoor',
        sensorIds: ['render_living', 'render_bedroom'],
      },
      {
        id: 'all',
        name: 'Entire home',
        sensorIds: ['render_living', 'render_bedroom', 'outdoor'],
      },
    ],
    extension: { keep: true },
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
  const pause = () => new Promise((r) => setTimeout(r, 180));
  const until = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const key = async (key) => {
    await cdp.send('Page.bringToFront');
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
      ...(key === 'Enter' ? { text: '\r', windowsVirtualKeyCode: 13 } : {}),
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
    await pause();
  };
  const activate = async (expression) => {
    await evaluate(
      `(()=>{const e=${expression};if(!e || e.disabled)throw Error('Missing enabled control');e.scrollIntoView({block:'center'});e.focus()})()`,
    );
    await key('Enter');
  };
  const byLabel = (label) =>
    `document.querySelector('[aria-label="${label}"]')`;
  const checks = [];
  let layout;
  try {
    await api('/sensors/catalog', { ...seed, expected: original });
    layout = await api(
      '/dashboard/layouts',
      { id: 0, name: 'Sensor ordering verification', is_default: false },
      'POST',
    );
    for (const [i, title] of ['Catalog order', 'Explicit selection'].entries())
      await api(
        '/dashboard/widgets',
        {
          id: 0,
          layout_id: layout.id,
          widget_type: 'sensors',
          config: {
            title,
            options: {
              sensorSelection: i ? 'selected' : 'all',
              sensorIds: i ? ['render_living', 'render_bedroom'] : [],
            },
          },
          grid_x: 0,
          grid_y: i * 4,
          grid_w: 8,
          grid_h: 4,
          sort_order: i,
        },
        'POST',
      );
    await cdp.send('Page.navigate', {
      url: 'http://127.0.0.1:3021/config/sensors',
    });
    await until(
      `!!${byLabel('Move sensor Living climate down')}`,
      'Catalog loaded',
    );
    if (
      !(await evaluate(
        `${byLabel('Move sensor Living climate up')}.disabled && ${byLabel('Move sensor Outside down')}.disabled`,
      ))
    )
      throw Error('Boundary controls enabled');
    checks.push('First/last ordering boundaries are disabled');
    await activate(byLabel('Move sensor Living climate down'));
    await activate(byLabel('Move group Indoor down'));
    await activate(
      `document.querySelector('[data-field="groups.1.sensorIds"] [aria-label="Move Bedroom climate up"]')`,
    );
    const draftServer = (await (await fetch(base + '/sensors/catalog')).json())
      .data;
    if (JSON.stringify(draftServer) !== JSON.stringify(seed))
      throw Error('Reorder wrote before Save');
    checks.push(
      'Native keyboard reorders catalog, groups and scoped members without early writes',
    );
    await activate(
      `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Save changes')`,
    );
    await until(
      `!document.body.textContent.includes('Unsaved changes')`,
      'Save completed',
    );
    const saved = (await (await fetch(base + '/sensors/catalog')).json()).data;
    if (
      saved.sensors.map((s) => s.id).join(',') !==
      'render_bedroom,render_living,outdoor'
    )
      throw Error('Catalog order');
    if (saved.groups.map((g) => g.id).join(',') !== 'all,indoor')
      throw Error('Group order');
    if (saved.groups[1].sensorIds.join(',') !== 'render_bedroom,render_living')
      throw Error('Member order');
    if (
      saved.groups[0].sensorIds.join(',') !==
        'render_living,render_bedroom,outdoor' ||
      !saved.extension.keep
    )
      throw Error('Unrelated data changed');
    checks.push(
      'Save persists all three orders, preserves shared memberships and extension fields',
    );
    if (!(await evaluate('document.documentElement.scrollWidth<=innerWidth+1')))
      throw Error('Ordering page overflow');
    checks.push('Ordering controls fit the viewport');
    await cdp.send('Page.navigate', {
      url: 'http://127.0.0.1:3021/?layout=' + layout.id,
    });
    await until(
      `document.querySelectorAll('.dashboard-sensors-card').length===2 && document.querySelectorAll('.dashboard-sensors-preview button').length===5`,
      'Dashboard sensors loaded',
    );
    const orders = await evaluate(
      `[...document.querySelectorAll('.dashboard-sensors-card')].map(c=>[...c.querySelectorAll('.dashboard-sensors-preview button')].map(b=>b.firstElementChild.textContent.trim()).join(','))`,
    );
    if (
      orders[0] !== 'Bedroom climate,Living climate,Outside' ||
      orders[1] !== 'Living climate,Bedroom climate'
    )
      throw Error('Dashboard order ' + JSON.stringify(orders));
    checks.push(
      'Dashboard follows catalog order while explicit widget selection keeps its own order',
    );
    await activate(
      `document.querySelector('.dashboard-sensors-card [aria-label="Open all climate sensors"]')`,
    );
    await until(
      `!!document.querySelector('[role="dialog"]')`,
      'Sensor details',
    );
    await activate(byLabel('Sensor location'));
    await until(
      `document.querySelectorAll('[role="option"]').length>0`,
      'Group picker',
    );
    const options = await evaluate(
      `[...document.querySelectorAll('[role="option"]')].map(e=>e.textContent)`,
    );
    if (
      options.filter((t) => t === 'Indoor').length !== 1 ||
      options.indexOf('Entire home') > options.indexOf('Indoor')
    )
      throw Error('Group choices order or duplicate ' + options);
    await activate(
      `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent==='Entire home')`,
    );
    await until(`!document.querySelector('[role="listbox"]')`, 'Group chosen');
    const legends = await evaluate(
      `[...document.querySelectorAll('[role="dialog"] [aria-label="temperature history"]')].map(e=>e.parentElement.textContent)`,
    );
    if (
      !legends[0]?.includes('Living climate') ||
      !legends[0]?.includes('Bedroom climate') ||
      legends[0].indexOf('Living climate') >
        legends[0].indexOf('Bedroom climate')
    )
      throw Error('Group series order ' + JSON.stringify(legends));
    checks.push(
      'Group picker follows configured order without reserved-ID collisions; charts follow group member order',
    );
    await key('Escape');
    return { passed: true, checks, width };
  } finally {
    const current = (await (await fetch(base + '/sensors/catalog')).json())
      .data;
    await api('/sensors/catalog', { ...original, expected: current });
    if (layout)
      await api('/dashboard/layouts/' + layout.id, undefined, 'DELETE');
  }
}
