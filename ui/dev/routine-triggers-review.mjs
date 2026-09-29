import { writeFile } from 'node:fs/promises';

// Own records only, on the explicitly marked isolated fixture.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const base = origin + '/api/v1/config/routines';
  const marker = await fetch(base);
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = `routine-triggers-${width}-${Date.now()}`;
  const path = '/config/routines/' + id;
  const main = { integration_id: 'zigbee2mqtt', device_id: 'living_room_lamp' };
  const initial = {
    id,
    name: 'Routine starts review',
    enabled: false,
    semantics_version: 2,
    revision: 1,
    rules: [],
    actions: [],
    definition_v2: {
      triggers: [
        {
          id: 'calendar',
          kind: 'schedule',
          schedule: {
            cron: '0 0 8 * * *',
            timezone: 'Europe/Helsinki',
            backlog: 'catch_up_once',
            catch_up_lateness_ms: 60000,
            future: 'kept',
          },
        },
        {
          id: 'interval',
          kind: 'schedule',
          schedule: { every_ms: 60000, backlog: 'skip' },
        },
        { id: 'report', kind: 'report', device: main, field: 'power' },
        {
          id: 'change',
          kind: 'state_change',
          device: main,
          mode: 'transition',
        },
        {
          id: 'held',
          kind: 'predicate_for',
          predicate: { kind: 'literal', value: true },
          duration_ms: 60000,
        },
        {
          id: 'edge',
          kind: 'predicate_transition',
          predicate: { kind: 'literal', value: true },
        },
        { id: 'timer', kind: 'timer_fired', timer: 'old' },
        { id: 'startup', kind: 'startup' },
        { id: 'manual', kind: 'manual' },
      ],
      condition: { kind: 'literal', value: true },
      execution: { mode: 'queued', max_actions: 32 },
      program: {
        kind: 'native',
        steps: [
          { id: 'cancel', action: 'cancel_timer', timer: 'review' },
          {
            id: 'delay',
            action: 'schedule_timer',
            timer: 'review',
            delay_ms: 60000,
          },
        ],
      },
    },
  };
  const created = await fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(initial),
  });
  if (!created.ok) throw Error('Fixture create failed');
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
  const until = async (expr, name) => {
    for (let i = 0; i < 80; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(name);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const labeled = (label, tag = '', scope = 'document') =>
    `${scope}?.querySelector(${JSON.stringify(`${tag}[aria-label="${label}"]`)})`;
  const click = async (expr) => {
    const point = await evaluate(
      `(()=>{const e=${expr}; if(!e)throw Error('Missing click target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
  const key = async (key, code, modifiers = 0) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      windowsVirtualKeyCode: code,
      modifiers,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      windowsVirtualKeyCode: code,
      modifiers,
    });
  };
  const type = async (label, value, scope = 'document') => {
    await click(labeled(label, 'input', scope));
    await key('a', 65, 2);
    await key('Backspace', 8);
    if (value) await cdp.send('Input.insertText', { text: value });
    await pause();
  };
  const pick = async (label, text, scope = 'document') => {
    await click(labeled(label, 'button', scope));
    await until(`!!document.querySelector('[role=option]')`, 'Type options');
    await click(
      `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`,
    );
  };
  const goto = async (route) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(route)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  const checks = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const read = async () =>
    (await (await fetch(base)).json()).data.find((row) => row.id === id);
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (request.url === base + '/' + id && request.method === 'PUT') writes++;
  });
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/routine-triggers-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const cleanup = async () => {
    const r = await fetch(base + '/' + id, { method: 'DELETE' });
    if (!r.ok) throw Error('Fixture cleanup failed');
  };
  const assert = (name, condition) => {
    if (!condition) throw Error(name);
    checks.push({ name, passed: true });
  };
  const save = async () => {
    await click(
      '(' + button('Save changes') + ' || ' + button('Retry save') + ')',
    );
    await until(`!${button('Discard')}`, 'Source saved');
  };
  const reload = async () => {
    const loaded = new Promise((resolve) =>
      cdp.on('Page.loadEventFired', resolve),
    );
    await cdp.send('Page.reload');
    await loaded;
    await until(`!!${labeled('Trigger type', 'button')}`, 'Source reloaded');
  };

  const node = (id) =>
    'document.querySelector(\'[data-node-id="' + id + '"]\')';
  const field = (label, id) => labeled(label, 'input', node(id));
  const value = (label, id) => field(label, id) + '.value';
  const saveAttempt = async () =>
    click('(' + button('Save changes') + ' || ' + button('Retry save') + ')');
  const triggers = async () => (await read()).definition_v2.triggers;
  try {
    await cdp.send('Page.navigate', { url: origin + path });
    await cdp.send('Page.bringToFront');
    await until(
      '!!' + field('Cron expression', 'calendar'),
      'Routine starts ready',
    );
    await type('Cron expression', '0 30 9 * * *', node('calendar'));
    await type('Catch-up lateness', '7', node('calendar'));
    await pick('Missed occurrences', 'Skip', node('calendar'));
    await save();
    assert(
      'Skipping catch-up removes its inapplicable field on Save',
      !(await triggers()).find((t) => t.id === 'calendar').schedule
        .catch_up_lateness_ms,
    );
    await pick('Missed occurrences', 'Run once on catch-up', node('calendar'));
    await type('Catch-up lateness', '7', node('calendar'));
    await pick('Missed occurrences', 'Skip', node('calendar'));
    await pick('Missed occurrences', 'Run once on catch-up', node('calendar'));
    await check(
      'Catch-up toggles retain the edited lateness before Save',
      value('Catch-up lateness', 'calendar') + " === '7'",
    );
    await pick('Schedule type', 'Fixed interval', node('calendar'));
    await check(
      'Intervals omit calendar-only policy controls',
      '!' + labeled('Missed occurrences', 'button', node('calendar')),
    );
    await type('Interval', '2', node('calendar'));
    await pick('Interval unit', 'minutes', node('calendar'));
    await type('Interval', '3.5', node('calendar'));
    await pick('Schedule type', 'Calendar (cron)', node('calendar'));
    await check(
      'Calendar draft restores cron, zone and catch-up',
      value('Cron expression', 'calendar') +
        " === '0 30 9 * * *' && " +
        value('Catch-up lateness', 'calendar') +
        " === '7' && " +
        value('Schedule timezone', 'calendar') +
        " === 'Europe/Helsinki'",
    );
    await pick('Schedule type', 'Fixed interval', node('calendar'));
    // Unit display may normalize after changing schedule mode; assert the eventual exact API value.
    await save();
    let row = (await triggers()).find((t) => t.id === 'calendar');
    assert(
      'Interval Save retains exact duration and unknown fields without calendar backlog',
      row.schedule.every_ms === 210000 &&
        !row.schedule.cron &&
        row.schedule.backlog === 'skip' &&
        row.schedule.catch_up_lateness_ms === undefined &&
        row.schedule.future === 'kept',
    );
    await type('Interval', '', node('interval'));
    const before = writes;
    await saveAttempt();
    await check(
      'A required empty duration stays blank and gets focus',
      value('Interval', 'interval') +
        " === '' && document.activeElement === " +
        field('Interval', 'interval'),
    );
    assert('Incomplete duration cannot save', writes === before);
    await goto('/config/routines');
    await goto(path);
    await until('!!' + field('Interval', 'interval'), 'Draft returned');
    await check(
      'Empty duration and its units survive navigation',
      value('Interval', 'interval') +
        " === '' && " +
        labeled('Interval unit', 'button', node('interval')) +
        ".textContent.includes('minutes')",
    );
    await click(field('Interval', 'interval'));
    await shot('unfinished');
    await click(button('Discard'));
    await pick('Interval unit', 'seconds', node('interval'));
    await type('Interval', '1.001', node('interval'));
    await pick('Interval unit', 'minutes', node('interval'));
    await save();
    assert(
      'Changing duration units preserves exact milliseconds',
      (await triggers()).find((t) => t.id === 'interval').schedule.every_ms ===
        1001,
    );
    await type('Report field', 'temperature', node('report'));
    await pick('State change mode', 'Level (while true)', node('change'));
    await pick('Condition result', 'Always false', node('held'));
    await type('Held for', '1.5', node('held'));
    await pick('Condition result', 'Always false', node('edge'));
    await type('Timer name', 'review', node('timer'));
    await pick('Duration unit', 'seconds', node('delay'));
    await type('Duration', '1.001', node('delay'));
    await pick('Duration unit', 'minutes', node('delay'));
    await pick('Trigger type', 'Manual only', node('startup'));
    await pick('Trigger type', 'On startup', node('manual'));
    await save();
    const all = await triggers();
    assert(
      'Action duration unit changes retain exact milliseconds',
      (await read()).definition_v2.program.steps.find(
        (step) => step.id === 'delay',
      ).delay_ms === 1001,
    );
    assert(
      'Edited report, state, held predicate, transition, timer, startup and manual starts persist with stable IDs',
      all.find((t) => t.id === 'report').field === 'temperature' &&
        all.find((t) => t.id === 'change').mode === 'level' &&
        all.find((t) => t.id === 'held').duration_ms === 90000 &&
        all.find((t) => t.id === 'held').predicate.value === false &&
        all.find((t) => t.id === 'edge').predicate.value === false &&
        all.find((t) => t.id === 'timer').timer === 'review' &&
        all.find((t) => t.id === 'startup').kind === 'manual' &&
        all.find((t) => t.id === 'manual').kind === 'startup',
    );
    await type('Report field', '', node('report'));
    await type('Held for', '-', node('held'));
    await pick('Trigger type', 'Manual only', node('held'));
    await save();
    assert(
      'Omitted report fields and removed duration variants have no hidden errors',
      (await triggers()).find((t) => t.id === 'report').field === undefined &&
        (await triggers()).find((t) => t.id === 'held').kind === 'manual',
    );
    await reload();
    await check(
      'Saved interval and report field survive reload',
      value('Interval', 'interval') +
        " === '1.001' && " +
        value('Report field', 'report') +
        " === ''",
    );
    await pick('Schedule type', 'Calendar (cron)', node('calendar'));
    await type('Cron expression', '0 30 9 * * *', node('calendar'));
    await pick('Missed occurrences', 'Run once on catch-up', node('calendar'));
    await type('Catch-up lateness', '5', node('calendar'));
    await save();
    await reload();
    assert(
      'Calendar cron and bounded catch-up survive Save/reload',
      (await triggers()).find((t) => t.id === 'calendar').schedule
        .catch_up_lateness_ms === 300000,
    );
    await click(field('Cron expression', 'calendar'));
    await shot('calendar');
    return { passed: true, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cleanup();
  }
}
