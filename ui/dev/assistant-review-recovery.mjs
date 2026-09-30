import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const marker = await fetch(origin + '/api/v1/config/routines');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const plan = {
    planId: 'review-fixture',
    summary: 'Review evening configuration',
    createdAtMs: Date.now(),
    operations: [
      {
        opId: 'rename',
        op: 'update',
        kind: 'group',
        targetId: 'living_room',
        label: 'Rename living room',
        before: { name: 'Living room' },
        after: { name: 'Living area' },
      },
      {
        opId: 'create',
        op: 'create',
        kind: 'scene',
        label: 'Create evening scene',
        after: {
          id: 'review-evening',
          name: 'Evening',
          device_states: {},
          group_states: {},
        },
      },
      {
        opId: 'delete',
        op: 'delete',
        kind: 'scene',
        targetId: 'night',
        label: 'Delete night scene',
        before: { name: 'Night' },
        warnings: ['Used by a routine'],
      },
    ],
  };
  const action = {
    actionId: 'action-fixture',
    summary: 'Review light change',
    createdAtMs: Date.now(),
    changes: [
      {
        deviceKey: 'zigbee2mqtt/living_room_lamp',
        name: 'Living room lamp',
        power: true,
        brightness: 0.42,
      },
    ],
  };
  let pending,
    mode = 'plan';
  const requests = [],
    errors = [];
  const fulfill = (requestId, data, status = 200, type = 'application/json') =>
    cdp.send('Fetch.fulfillRequest', {
      requestId,
      responseCode: status,
      responseHeaders: [{ name: 'Content-Type', value: type }],
      body: Buffer.from(
        typeof data === 'string' ? data : JSON.stringify(data),
      ).toString('base64'),
    });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: origin + '/api/v1/config/assistant/*' }],
  });
  cdp.on('Fetch.requestPaused', (e) => {
    void (async () => {
      const p = new URL(e.request.url).pathname,
        method = e.request.method;
      if (p.endsWith('/threads') && method === 'GET')
        return fulfill(e.requestId, {
          success: true,
          data: [
            {
              id: 'history-review',
              name: 'Earlier proposal',
              updatedAtMs: Date.now(),
              messageCount: 1,
            },
          ],
        });
      if (p.endsWith('/threads/history-review') && method === 'GET')
        return fulfill(e.requestId, {
          success: true,
          data: {
            id: 'history-review',
            name: 'Earlier proposal',
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            messages: [
              {
                role: 'assistant',
                content: plan.summary,
                proposal: { kind: 'plan', plan },
              },
            ],
          },
        });
      if (p.endsWith('/chat'))
        return fulfill(
          e.requestId,
          `event: ${mode}\ndata: ${JSON.stringify(mode === 'plan' ? plan : action)}\n\n`,
          200,
          'text/event-stream',
        );
      if (p.endsWith('/apply')) {
        requests.push(JSON.parse(e.request.postData));
        pending = e.requestId;
        return;
      }
      if (method === 'DELETE') {
        requests.push({ delete: p });
        pending = e.requestId;
        return;
      }
      return cdp.send('Fetch.continueRequest', { requestId: e.requestId });
    })().catch((e) => errors.push(e.message));
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
  const pause = (ms = 130) => new Promise((r) => setTimeout(r, ms));
  const until = async (expr, label) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(label);
  };
  const button = (t) =>
    `[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.trim()===${JSON.stringify(t)})`;
  const label = (t) =>
    `document.querySelector(${JSON.stringify('[aria-label="' + t + '"]')})`;
  const checkboxes =
    "[...document.querySelectorAll('[role=dialog] [role=checkbox]')]";
  const click = async (expr) => {
    const p = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing '+${JSON.stringify(expr)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
  const checks = [];
  const assert = (ok, name) => {
    if (!ok) throw Error(name);
    checks.push({ name, passed: true });
  };
  const check = async (name, expr) => assert(await evaluate(expr), name);
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/assistant-review-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const reply = async (data, status = 200) => {
    if (!pending) throw Error('No pending request');
    const id = pending;
    pending = undefined;
    await fulfill(id, data, status);
    await pause();
  };
  const send = async () => {
    await click("document.querySelector('[role=dialog] textarea')");
    await cdp.send('Input.insertText', { text: 'Review a fixture change' });
    await click(button('Send'));
  };
  try {
    await click(label('Ask AI'));
    await until(
      `!![...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.includes('Earlier proposal'))`,
      'History listed',
    );
    await click(
      "[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.includes('Earlier proposal')&&!e.hasAttribute('aria-label'))",
    );
    await until(`${checkboxes}.length===3`, 'Historical plan loaded');
    await until(
      "!!document.querySelector('[role=dialog] canvas')",
      'Preview rendered',
    );
    await check(
      'Plan preview stays inside its reserved container',
      "[...document.querySelectorAll('[role=dialog] canvas')].every(e=>{const r=e.getBoundingClientRect(),p=e.parentElement.parentElement.getBoundingClientRect();return r.width>0&&r.height>0&&r.left>=p.left-1&&r.right<=p.right+1&&r.top>=p.top-1&&r.bottom<=p.bottom+1&&p.height<=226})",
    );
    await check(
      'Read-only historical proposal disables Apply and selection controls',
      `${checkboxes}.every(e=>e.disabled) && ${button('Accept all')}.disabled && ${button('Clear')}.disabled && ${button('Apply 2 changes')}.disabled`,
    );
    await click(label('Back to past conversations'));
    await send();
    await until(
      `!!${button('Apply 2 changes')} && !${button('Apply 2 changes')}.disabled`,
      'New plan ready',
    );
    assert(requests.length === 0, 'Proposal and history review write nothing');
    await check(
      'Destructive operation is unselected by default',
      `${label('Accept Delete night scene')}.getAttribute('aria-checked')==='false'`,
    );
    await click(
      "[...document.querySelectorAll('[role=dialog] button[aria-expanded]')].find(e=>e.textContent.includes('Living room'))",
    );
    await check(
      'Expanded update shows before and after values',
      "document.querySelector('[role=dialog]').textContent.includes('Living area')",
    );
    await click(button('Apply 2 changes'));
    await until(`!!${button('Applying…')}`, 'Application pending');
    await check(
      'Pending plan locks operation selection, bulk selection and discard',
      `${checkboxes}.every(e=>e.disabled) && ${button('Accept all')}.disabled && ${button('Clear')}.disabled && ${button('Discard')}.disabled && ${button('Applying…')}.disabled`,
    );
    assert(
      JSON.stringify(requests[0].acceptedOperationIds) ===
        JSON.stringify(['rename', 'create']),
      'Only reviewed operations are submitted',
    );
    await reply(
      {
        success: false,
        error: 'Fixture connection failed. Review and try again.',
      },
      503,
    );
    await until(
      `!!${button('Apply 2 changes')} && !${button('Apply 2 changes')}.disabled`,
      'Apply failure recovered',
    );
    await check(
      'Failed plan request stays visible inside the card',
      "[...document.querySelectorAll('[role=dialog] [role=alert]')].some(e=>e.textContent.includes('Fixture connection failed'))",
    );
    await shot('failure');
    await click(button('Apply 2 changes'));
    await reply({
      success: true,
      data: {
        results: [
          { opId: 'rename', ok: true },
          { opId: 'create', ok: false, error: 'Fixture scene conflict' },
        ],
      },
    });
    await until(
      "document.querySelector('[role=dialog]').textContent.includes('1 applied · 1 failed · 1 not included')",
      'Partial summary',
    );
    await check(
      'Partial result distinguishes applied, failed and excluded operations',
      "document.querySelector('[role=dialog]').textContent.includes('Not included in the last application') && document.querySelector('[role=dialog]').textContent.includes('Fixture scene conflict')",
    );
    await check(
      'Successful response clears the request error',
      "![...document.querySelectorAll('[role=dialog] [role=alert]')].some(e=>e.textContent.includes('Fixture connection failed'))",
    );
    await shot('partial');
    await click(
      "[...document.querySelectorAll('[role=dialog] a')].find(e=>e.getAttribute('href')==='/config/groups/living_room')",
    );
    await until(
      "location.pathname==='/config/groups/living_room' && !document.querySelector('[role=dialog]')",
      'Related room opened',
    );
    // Phone notifications temporarily cover the header entry. Let them finish
    // with the pointer away from the toast (hover pauses Sonner's timeout).
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: 5,
      y: 400,
    });
    await until(
      "!document.querySelector('[data-sonner-toast]')",
      'Notifications finished',
    );
    await click(label('Ask AI'));
    await until(
      "document.querySelector('[role=dialog]')?.textContent.includes('Fixture scene conflict')",
      'Thread retained',
    );
    assert(
      true,
      'Related-page navigation closes the panel and preserves results',
    );
    await click(label('Back to past conversations'));
    mode = 'action';
    await send();
    await until(`!!${button('Apply 1 change')}`, 'Action ready');
    await click(button('Apply 1 change'));
    await check(
      'Pending light action locks selection and discard',
      `${checkboxes}.every(e=>e.disabled) && ${button('Discard')}.disabled`,
    );
    await reply(
      { success: false, error: 'Fixture device service unavailable' },
      503,
    );
    await until(
      "[...document.querySelectorAll('[role=dialog] [role=alert]')].some(e=>e.textContent.includes('Fixture device service unavailable'))",
      'Action failure visible',
    );
    assert(true, 'Light action request failure remains visible in the card');
    await click(button('Discard'));
    await check(
      'Pending discard prevents applying the light action',
      `${button('Apply 1 change')}.disabled && ${checkboxes}.every(e=>e.disabled)`,
    );
    await reply({ success: false, error: 'Already removed' }, 404);
    await until(`!${button('Apply 1 change')}`, 'Local discard completed');
    assert(true, 'Failed remote discard still removes the local proposal');
    await check(
      'Assistant fits the viewport',
      "document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('[role=dialog]').getBoundingClientRect().right<=innerWidth+1",
    );
    assert(errors.length === 0, 'Interception completed without errors');
    return { passed: true, checks };
  } catch (error) {
    await shot('failed-test');
    throw error;
  } finally {
    if (pending)
      await fulfill(pending, { success: false, error: 'Fixture cleanup' }, 503);
    await cdp.send('Fetch.disable');
  }
}
