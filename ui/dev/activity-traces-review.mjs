import { writeFile } from 'node:fs/promises';
import { fixtures } from './fixtures.mjs';
import keyboardReview from './settings-activity-keyboard.mjs';
export default async function (cdp, { url, width }) {
  const origin = 'http://127.0.0.1:3021',
    endpoint = origin + '/api/v1/config/routine-history';
  const response = await fetch(endpoint);
  if (
    !url.startsWith(origin + '/') ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const original = (await response.json()).data,
    normal = fixtures.normal().routineHistory;
  const run = normal.find((row) => row.id === '9001');
  const entry = (id) => ({
    ...structuredClone(run),
    id,
    routine_name: 'Trace ' + id,
  });
  const entries = [];
  const empty = entry('empty');
  empty.v2.last_run.steps = [];
  empty.action_count = 0;
  entries.push(empty);
  const suppressed = entry('suppressed');
  suppressed.v2.last_run.steps[0].disposition = 'suppressed';
  suppressed.v2.last_run.steps[0].reason = 'Stale intent';
  suppressed.action_count = 0;
  entries.push(suppressed);
  const rejected = entry('rejected');
  rejected.v2.last_run.accepted = false;
  rejected.v2.last_run.steps = [];
  rejected.action_count = 0;
  entries.push(rejected);
  const unknown = entry('unknown');
  unknown.v2.last_run = null;
  unknown.v2.condition.truth = 'unknown';
  unknown.v2.condition.unknown_reason = {
    kind: 'not_initialized',
    entity: 'new sensor',
  };
  const reasons = [
    { kind: 'missing_entity', entity: 'deleted helper' },
    { kind: 'missing_field', field: '/temperature' },
    { kind: 'offline', device: 'zigbee2mqtt/living_room_lamp' },
    { kind: 'stale', device: 'zigbee2mqtt/living_room_motion' },
    { kind: 'empty_selection', group: 'living_room' },
    { kind: 'not_initialized', entity: 'new sensor' },
    { kind: 'unknown_source_value', source: 'unavailable-source' },
  ];
  unknown.v2.condition.trace = {
    path: '/condition',
    truth: 'unknown',
    evaluated: true,
    children: reasons.map((reason, index) => ({
      path: '/condition/' + index,
      truth: 'unknown',
      evaluated: true,
      unknown_reason: reason,
    })),
  };
  unknown.v2.condition.trace.children.push({
    path: '/condition/skipped',
    truth: 'unknown',
    evaluated: false,
  });
  entries.push(unknown);
  const blocked = structuredClone(normal[0]);
  blocked.id = 'blocked';
  blocked.v2.last_run = structuredClone(run.v2.last_run);
  blocked.v2.last_run.steps[0].action_id = 'old-unrelated-step';
  entries.push(blocked);
  const error = entry('error');
  error.v2.condition.error = 'Comparison types do not match';
  error.v2.last_run = null;
  entries.push(error);
  const labels = entry('labels');
  labels.v2.definition_revision = 0;
  labels.v2.last_run.steps[0].action_id = 'deleted-history-step';
  labels.v2.last_run.steps[0].references = [
    { entity: 'scene', entity_id: 'normal' },
    { entity: 'group', entity_id: 'living_room' },
    { entity: 'device', entity_id: 'zigbee2mqtt/living_room_lamp' },
    { entity: 'helper', entity_id: 'deleted-helper' },
  ];
  entries.push(labels);
  const literal = entry('literal');
  literal.routine_id = 'all';
  literal.routine_name = 'Routine literally all';
  entries.push(literal);
  const configure = async (data) => {
    const r = await fetch(origin + '/api/__fixture/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) throw Error('Fixture history update');
  };
  await configure({ entries });
  let failNames = true,
    writes = 0;
  const exceptions = [];
  cdp.on('Runtime.exceptionThrown', (e) =>
    exceptions.push(e.exceptionDetails.text),
  );
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (
      request.method !== 'GET' &&
      request.url.startsWith(origin + '/api/v1/config/')
    )
      writes++;
  });
  cdp.on('Fetch.requestPaused', async (e) => {
    if (e.request.method === 'GET' && failNames)
      return cdp.send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: 503,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify({ success: false, error: 'Fixture name read failed' }),
        ).toString('base64'),
      });
    await cdp.send('Fetch.continueRequest', { requestId: e.requestId });
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: origin + '/api/v1/config/scenes' }],
  });
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
  const until = async (expr, message) => {
    for (let i = 0; i < 140; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)})`;
  const label = (name) =>
    `document.querySelector(${JSON.stringify('[aria-label="' + name + '"]')})`;
  const row = (id) => `document.querySelector('[data-activity-id="${id}"]')`;
  const click = async (expr) => {
    const p = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing control '+${JSON.stringify(expr)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        ...p,
        button: 'left',
        clickCount: 1,
      });
    await pause();
  };
  const key = async (key, code) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        ...(key === 'Enter' && type === 'keyDown' ? { text: '\r' } : {}),
      });
  };
  const choose = async (name, text) => {
    await click(label(name));
    await until("!!document.querySelector('[role=option]')", 'Filter choices');
    await evaluate(
      `[...document.querySelectorAll('[role=option]')].find(e=>e.textContent.trim()===${JSON.stringify(text)}).focus()`,
    );
    await key('Enter', 13);
    await until("!document.querySelector('[role=option]')", 'Filter selected');
    await pause();
  };
  const checks = [];
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/activity-traces-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const goto = async (path) => {
    await evaluate(
      `history.pushState({},'',${JSON.stringify(path)});dispatchEvent(new PopStateEvent('popstate'))`,
    );
    await pause();
  };
  try {
    await cdp.send('Page.navigate', {
      url: origin + '/config/routine-history',
    });
    await until(
      `!!${row('labels')} && document.body.textContent.includes('Some current reference names')`,
      'History and name failure',
    );
    await check(
      'Name read failures keep all recorded entries',
      'document.querySelectorAll("[data-activity-id]").length===8',
    );
    await click(`${row('labels')}.querySelector('summary')`);
    await check(
      'Failed name lookup falls back to the recorded entity ID',
      `${row('labels')}.querySelector('a[href="/config/scenes/normal"]').textContent.includes('normal')`,
    );
    failNames = false;
    await click(button('Retry reference names'));
    await until(
      "!document.body.textContent.includes('Some current reference names')",
      'Names recovered',
    );
    await check(
      'Current names accompany exact recorded destinations',
      `${row('labels')}.querySelector('a[href="/config/scenes/normal"]').textContent.includes('Normal') && ${row('labels')}.querySelector('a[href="/config/groups/living_room"]').textContent.includes('Living room') && ${row('labels')}.querySelector('a[href="/config/helpers/deleted-helper"]').textContent.includes('deleted-helper')`,
    );
    await check(
      'Historical revision change is explained before navigation',
      `${row('labels')}.textContent.includes('This routine has changed since this attempt')`,
    );
    await evaluate(row('labels') + ".scrollIntoView({block:'start'})");
    await shot('references');
    await click(
      `${row('labels')}.querySelector('a[href="/config/routines/motion_on?node=deleted-history-step"]')`,
    );
    await until(
      "document.body.textContent.includes('The referenced step or trigger is no longer present')",
      'Missing historical node',
    );
    checks.push({
      name: 'A removed historical node opens the current routine with an explanation',
      passed: true,
    });
    await goto('/config/routine-history');
    await until(`!!${row('empty')}`, 'History returns');
    await choose('Activity outcome', 'No actions');
    await check(
      'Accepted empty plan has its own filter and outcome',
      `document.querySelectorAll('[data-activity-id]').length===1 && !!${row('empty')} && new URLSearchParams(location.search).get('outcome')==='No actions'`,
    );
    await click(`${row('empty')}.querySelector('summary')`);
    await check(
      'Empty plans make no dispatch claim',
      `${row('empty')}.textContent.includes('No actions were planned') && ${row('empty')}.textContent.includes('No steps were planned')`,
    );
    await choose('Activity outcome', 'All steps skipped');
    await check(
      'Fully suppressed plan is distinct from partial dispatch',
      `document.querySelectorAll('[data-activity-id]').length===1 && !!${row('suppressed')}`,
    );
    await choose('Activity outcome', 'Rejected');
    await check(
      'Execution-policy rejection stays distinct',
      `document.querySelectorAll('[data-activity-id]').length===1 && !!${row('rejected')}`,
    );
    await choose('Activity outcome', 'Error');
    await check(
      'Condition errors stay distinct',
      `!!${row('error')} && ${row('error')}.textContent.includes('Comparison types do not match')`,
    );
    await choose('Activity outcome', 'Blocked');
    await click(`${row('blocked')}.querySelector('summary')`);
    await check(
      'Blocked attempt never exposes a previous run as current evidence',
      `${row('blocked')}.textContent.includes('7 attempts') && ${row('blocked')}.textContent.includes('No run outcome was recorded') && !${row('blocked')}.querySelector('a[href*="old-unrelated-step"]')`,
    );
    await choose('Activity outcome', 'Unknown');
    await evaluate(row('unknown') + ".querySelector('summary').focus()");
    await key('Enter', 13);
    await check(
      'Keyboard opens the complete unknown trace',
      `${row('unknown')}.open && ['Missing entity: deleted helper','Missing field: /temperature','Device offline:','Stale observation:','Group has no members:','Not initialized:','Source has no value:','not evaluated'].every(t=>${row('unknown')}.textContent.includes(t))`,
    );
    await check(
      'Typed unknown reasons link to their canonical settings',
      `!!${row('unknown')}.querySelector('a[href="/config/sources/unavailable-source"]') && !!${row('unknown')}.querySelector('a[href="/config/groups/living_room"]') && !!${row('unknown')}.querySelector('a[href="/config/devices/detail/zigbee2mqtt/living_room_lamp"]')`,
    );
    await evaluate(row('unknown') + ".scrollIntoView({block:'start'})");
    await shot('trace');
    await click(button('Clear filters'));
    await choose('Activity kind', 'Blocked attempt');
    await check(
      'Event-kind filter retains its exact URL value',
      `new URLSearchParams(location.search).get('kind')==='v2_blocked' && document.querySelectorAll('[data-activity-id]').length===1 && !!${row('blocked')}`,
    );
    await click(button('Clear filters'));
    await click(label('Routine filter'));
    await cdp.send('Input.insertText', { text: 'Routine literally all' });
    await until(
      "document.querySelectorAll('[cmdk-item]').length===1",
      'Exact routine choice',
    );
    await key('End', 35);
    await key('Enter', 13);
    await until(
      `!document.querySelector('[cmdk-input]') && document.querySelectorAll('[data-activity-id]').length===1 && !!${row('literal')}`,
      'Routine filter applied',
    );
    await check(
      'A routine named all cannot collide with All routines',
      `new URLSearchParams(location.search).get('routine')==='all' && document.querySelectorAll('[data-activity-id]').length===1 && !!${row('literal')}`,
    );
    await check(
      'Routine picker restores focus',
      `document.activeElement===${label('Routine filter')}`,
    );
    await click(button('Clear filters'));
    await evaluate(
      "document.querySelector('h1').scrollIntoView({block:'start'})",
    );
    await shot('overview');
    const keyboard = await keyboardReview(cdp, {
      url: origin + '/config/routine-history',
    });
    if (!keyboard.passed) throw Error('Keyboard review');
    checks.push(...keyboard.checks.map((name) => ({ name, passed: true })));
    if (writes || exceptions.length)
      throw Error(
        'Unexpected write or exception ' +
          JSON.stringify({ writes, exceptions }),
      );
    checks.push({
      name: 'History inspection and navigation never write configuration or raise page exceptions',
      passed: true,
    });
    return {
      passed: true,
      checks,
      scope:
        'Synthetic retained entries, local catalogs and injected name-read failure; runtime execution requires separate server evidence',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await evaluate("document.documentElement.style.zoom='1'").catch(() => {});
    await goto('/config');
    await cdp.send('Fetch.disable');
    await configure({ entries: original, fail: false });
  }
}
