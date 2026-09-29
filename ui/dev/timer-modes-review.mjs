import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    base = origin + '/api/v1/config/timers';
  if (!url.startsWith(origin + '/')) throw Error('Fixture required');
  const marker = await fetch(base);
  if (marker.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Marked fixture required');
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
  const pause = () => new Promise((r) => setTimeout(r, 150));
  const until = async (expression, message) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const click = async (expression) => {
    const point = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Click target missing');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      clickCount: 1,
    });
    await pause();
  };
  const field = (label, index = 0) =>
    `[...document.querySelectorAll('label')].filter(l=>l.querySelector('span')?.textContent===${JSON.stringify(label)})[${index}]?.querySelector('input')`;
  const input = async (label, value) => {
    await evaluate(
      `(()=>{const e=${field(label)};Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
    );
    await pause();
  };
  const pick = async (label, text, index = 0) => {
    await click(
      `[...document.querySelectorAll('button[aria-label="${label}"]')][${index}]`,
    );
    await until(`!!document.querySelector('[role="option"]')`, 'Options');
    await click(
      `[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const read = async () =>
    (await (await fetch(base)).json()).data.timers.map((t) => t.definition);
  const checks = [],
    ids = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const shot = async (mode, resetScroll = true) => {
    if (resetScroll) await evaluate('window.scrollTo(0,0)');
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/timer-modes-${width}-${mode}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const current = await read();
    const r = await fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timers: current.filter((t) => !ids.includes(t.id)),
        expected: current,
      }),
    });
    if (!r.ok) throw Error('Fixture cleanup failed');
  };
  try {
    await cdp.send('Page.navigate', { url: origin + '/config/timers' });
    await cdp.send('Page.bringToFront');
    await until(
      `!!${button('Add timer')}&&!${button('Add timer')}.disabled`,
      'Timer page ready',
    );
    for (const mode of ['countdown', 'scheduled', 'ready_by']) {
      await click(button('Add timer'));
      await until(`${field('Name')}?.value==='New timer'`, 'New timer draft');
      const path = await evaluate('location.pathname+location.search');
      const id = new URLSearchParams(path.split('?')[1]).get('timer');
      ids.push(id);
      await input(
        'Name',
        mode === 'countdown'
          ? 'Evening scene delay'
          : mode === 'scheduled'
            ? 'Morning room schedule'
            : 'Coffee ready',
      );
      await pick('Icon', mode === 'ready_by' ? 'Coffee' : 'Timer');
      await pick(
        'Timer mode',
        mode === 'ready_by'
          ? 'Ready by'
          : mode === 'scheduled'
            ? 'Scheduled'
            : 'Countdown',
      );
      if (mode === 'countdown') {
        await input('Wait for (minutes)', '25');
        await pick('Target type', 'Scene');
        await pick('Target', 'Normal');
      } else {
        await check(
          `${mode}: Helsinki default`,
          `${field('Time zone')}.value==='Europe/Helsinki'`,
        );
        if (mode === 'scheduled') {
          await input('Start time', '07:15');
          await pick('Repeat', 'Once, on a date');
          await input('Date', '2026-12-15');
          await pick('Target type', 'Room or group');
          await pick('Target', 'Living room');
          await pick('Action', 'Turn on');
          await click(
            `[...document.querySelectorAll('label')].find(l=>l.textContent.includes('Run an end action after a duration')).querySelector('input')`,
          );
          await input('Run for (minutes)', '45');
          await pick('Target type', 'Scene', 1);
          await pick('Target', 'Night', 1);
        } else {
          await input('Ready by', '08:30');
          await input('Warm up for (minutes)', '35');
          await pick('Target', 'Living room lamp');
          await pick('Target', 'Living room lamp', 1);
          await pick('Action', 'Turn off', 1);
        }
      }
      if ((await read()).some((t) => t.id === id))
        throw Error('Wrote before save');
      checks.push({
        name: `${mode}: draft does not write before Save`,
        passed: true,
      });
      await check(
        `${mode}: unsaved indicator and related target link`,
        `document.body.textContent.includes('Unsaved changes')&&[...document.querySelectorAll('a')].some(a=>a.textContent==='Open target details'&&a.pathname.startsWith('/config/'))`,
      );
      const link = await evaluate(
        `[...document.querySelectorAll('a')].find(a=>a.textContent==='Open target details').getAttribute('href')`,
      );
      await goto(link);
      await goto(path);
      await until(`!!${button('Save changes')}`, 'Retained timer draft');
      await check(
        `${mode}: navigation retains mode`,
        `document.querySelector('button[aria-label="Timer mode"]').textContent.includes(${JSON.stringify(mode === 'ready_by' ? 'Ready by' : mode === 'scheduled' ? 'Scheduled' : 'Countdown')})`,
      );
      await shot(mode);
      if (width < 700) {
        await evaluate(
          `document.querySelector('button[aria-label="Target type"]').scrollIntoView({block:"center"})`,
        );
        await shot(mode + '-actions', false);
      }
      await click(button('Save changes'));
      await until(`!${button('Save changes')}`, 'Save complete');
      const saved = (await read()).find((t) => t.id === id);
      if (!saved || saved.enabled || saved.schedule.kind !== mode)
        throw Error('Saved mode/enabled mismatch');
      if (
        mode === 'countdown' &&
        (saved.schedule.minutes !== 25 ||
          saved.action.kind !== 'scene' ||
          saved.action.scene_id !== 'normal' ||
          saved.finish_action !== null)
      )
        throw Error('Countdown persistence');
      if (
        mode === 'scheduled' &&
        (saved.schedule.time !== '07:15' ||
          saved.schedule.date !== '2026-12-15' ||
          saved.schedule.duration_minutes !== 45 ||
          saved.action.group_id !== 'living_room' ||
          saved.finish_action.scene_id !== 'night')
      )
        throw Error('Scheduled persistence');
      if (
        mode === 'ready_by' &&
        (saved.schedule.warmup_minutes !== 35 ||
          saved.schedule.time !== '08:30' ||
          saved.action.device_key !== 'zigbee2mqtt/living_room_lamp' ||
          saved.finish_action.power !== false ||
          saved.icon !== 'coffee')
      )
        throw Error('Ready-by persistence');
      checks.push({
        name: `${mode}: exact schedule and targets persist`,
        passed: true,
      });
      await input('Name', 'Discard this edit');
      await click(button('Discard'));
      await until(
        `${field('Name')}?.value===${JSON.stringify(saved.name)}`,
        'Discard restores saved name',
      );
      checks.push({
        name: `${mode}: Discard restores saved value`,
        passed: true,
      });
    }
    const reloaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await reloaded;
    await until(
      `!!${button('Add timer')} && !${button('Add timer')}.disabled`,
      'Reload',
    );
    await check(
      'All three saved timers survive page reload',
      `['Evening scene delay','Morning room schedule','Coffee ready'].every(t=>document.body.textContent.includes(t))`,
    );
    await check(
      'No horizontal overflow',
      `document.documentElement.scrollWidth<=innerWidth+1`,
    );
    return { passed: true, checks, width };
  } finally {
    await cleanup();
  }
}
