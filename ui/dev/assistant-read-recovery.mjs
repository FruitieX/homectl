import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    marker = await fetch(origin + '/api/v1/config/routines');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  let listReads = 0,
    firstReads = 0,
    searchReads = 0,
    chat;
  const errors = [];
  const fulfill = (id, data, status = 200, type = 'application/json') =>
    cdp.send('Fetch.fulfillRequest', {
      requestId: id,
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
      const p = new URL(e.request.url).pathname;
      if (p.endsWith('/threads')) {
        if (++listReads === 1)
          return fulfill(
            e.requestId,
            { success: false, error: 'Fixture list unavailable' },
            503,
          );
        return fulfill(e.requestId, {
          success: true,
          data: ['first', 'second'].map((id) => ({
            id,
            name:
              id === 'first'
                ? 'First conversation'
                : 'Unavailable conversation',
            updatedAtMs: Date.now(),
            messageCount: 1,
          })),
        });
      }
      if (p.endsWith('/threads/first')) {
        if (++firstReads === 1)
          return fulfill(
            e.requestId,
            { success: false, error: 'Fixture detail unavailable' },
            503,
          );
        return fulfill(e.requestId, {
          success: true,
          data: {
            id: 'first',
            name: 'First conversation',
            createdAtMs: Date.now(),
            updatedAtMs: Date.now(),
            messages: [
              { role: 'assistant', content: 'Stored conversation content' },
            ],
          },
        });
      }
      if (p.endsWith('/threads/second'))
        return fulfill(
          e.requestId,
          { success: false, error: 'Fixture missing conversation' },
          404,
        );
      if (p.endsWith('/search')) {
        if (++searchReads === 1)
          return fulfill(
            e.requestId,
            { success: false, error: 'Fixture search unavailable' },
            503,
          );
        return fulfill(e.requestId, { success: true, data: [] });
      }
      if (p.endsWith('/chat')) {
        chat = JSON.parse(e.request.postData);
        return fulfill(
          e.requestId,
          'event: answer\ndata: {"text":"New conversation answer"}\n\n',
          200,
          'text/event-stream',
        );
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
  const pause = () => new Promise((r) => setTimeout(r, 130));
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
  const thread = (t) =>
    `[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.includes(${JSON.stringify(t)})&&!e.hasAttribute('aria-label'))`;
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
      `/tmp/assistant-reads-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  try {
    await click(label('Ask AI'));
    await until(`!!${button('Retry conversations')}`, 'List failure');
    await check(
      'Conversation list failure is visible instead of an empty welcome',
      "document.querySelector('[role=dialog]').textContent.includes('Could not load conversations')&&!document.querySelector('[role=dialog]').textContent.includes('Ask a question about the current state')",
    );
    await click(button('Retry conversations'));
    await until(`!!${thread('First conversation')}`, 'List retry');
    assert(listReads === 2, 'Retry fetches the conversation list again');
    await click(thread('First conversation'));
    await until(`!!${button('Retry conversation')}`, 'Detail failure');
    await shot('conversation-error');
    await check(
      'Failed detail stops loading and offers explicit recovery',
      "document.querySelector('[role=dialog]').textContent.includes('Could not open this conversation')&&!document.querySelector('[role=dialog]').textContent.includes('Loading conversation…')",
    );
    await check(
      'Unresolved conversation cannot send into the previous thread',
      `document.querySelector('[role=dialog] textarea').disabled && ${button('Send')}.disabled`,
    );
    await click(button('Retry conversation'));
    await until(
      "document.querySelector('[role=dialog]').textContent.includes('Stored conversation content')",
      'Detail retry',
    );
    assert(firstReads === 2, 'Retry opens the stored conversation');
    await click(label('Back to past conversations'));
    await click(thread('Unavailable conversation'));
    await until(`!!${button('Back to conversations')}`, 'Switch failure');
    await check(
      'Failed thread switch is visible instead of silently showing the old conversation',
      "document.querySelector('[role=dialog]').textContent.includes('Could not open this conversation')&&!document.querySelector('[role=dialog]').textContent.includes('Stored conversation content')",
    );
    await click(button('Back to conversations'));
    await click(thread('First conversation'));
    await until(
      "document.querySelector('[role=dialog]').textContent.includes('Stored conversation content')",
      'Prior thread available',
    );
    assert(true, 'Failed thread switch preserves the earlier conversation');
    await click(label('Attach an entity'));
    await click(label('Search entities to attach'));
    await cdp.send('Input.insertText', { text: 'lamp' });
    await until(`!!${button('Retry search')}`, 'Search failure');
    await check(
      'Failed entity search differs from no matches',
      "document.querySelector('[role=dialog]').textContent.includes('Could not search entities')&&!document.querySelector('[role=dialog]').textContent.includes('No matching entities')",
    );
    await shot('search-error');
    await click(button('Retry search'));
    await until(
      "document.querySelector('[role=dialog]').textContent.includes('No matching entities.')",
      'Empty successful search',
    );
    assert(searchReads === 2, 'Search retry displays a genuine empty result');
    await click(label('Attach an entity'));
    await click(label('Back to past conversations'));
    await click("document.querySelector('[role=dialog] textarea')");
    await cdp.send('Input.insertText', {
      text: 'Start a separate conversation',
    });
    await click(button('Send'));
    await until(
      "document.querySelector('[role=dialog]').textContent.includes('New conversation answer')",
      'Fresh reply',
    );
    assert(
      chat && !chat.threadId && !chat.history?.length,
      'New conversation sends neither the old thread ID nor its history',
    );
    await check(
      'New conversation view contains only its own messages',
      "!document.querySelector('[role=dialog]').textContent.includes('Stored conversation content')",
    );
    await check(
      'Recovery controls fit the viewport',
      "document.documentElement.scrollWidth<=innerWidth+1 && document.querySelector('[role=dialog]').getBoundingClientRect().right<=innerWidth+1",
    );
    assert(errors.length === 0, 'Interception completed without errors');
    return { passed: true, checks };
  } catch (e) {
    await shot('failed-test');
    throw e;
  } finally {
    await cdp.send('Fetch.disable');
  }
}
