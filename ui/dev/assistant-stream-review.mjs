import http from 'node:http';
import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    marker = await fetch(origin + '/api/v1/config/routines');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  let mode = 'hold',
    aborted = 0;
  const requests = [],
    responses = new Set();
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    responses.add(res);
    res.on('close', () => {
      if (!res.writableEnded) aborted++;
      responses.delete(res);
    });
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
    });
    const send = (event, data) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('status', { phase: 'thinking', message: 'Reading fixture context' });
    send('delta', { text: 'Streaming fragment' });
    if (mode === 'truncated') res.end();
    if (mode === 'complete') {
      send('usage', {
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        contextWindow: 1000,
        approximate: false,
      });
      send('answer', { text: 'Completed fixture answer' });
      res.end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port,
    errors = [];
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: origin + '/api/v1/config/assistant/chat' }],
  });
  cdp.on('Fetch.requestPaused', (e) => {
    void cdp
      .send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: 307,
        responseHeaders: [
          { name: 'Location', value: `http://127.0.0.1:${port}/stream` },
        ],
      })
      .catch((e) => errors.push(e.message));
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
      `/tmp/assistant-stream-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const send = async (text) => {
    await click("document.querySelector('[role=dialog] textarea')");
    await cdp.send('Input.insertText', { text });
    await click(button('Send'));
  };
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (
      request.method === 'POST' &&
      /\/(apply|commands|force-trigger)$/.test(new URL(request.url).pathname)
    )
      writes++;
  });
  try {
    await click(label('Ask AI'));
    await until(
      "document.querySelector('[role=dialog]') && !document.querySelector('[role=dialog]').getAnimations().some(a=>a.playState==='running')",
      'Panel opening settled',
    );
    await send('Show the current state');
    await until(
      "document.querySelector('[role=dialog]')?.textContent.includes('Streaming fragment')",
      'Streaming delta visible',
    );
    await check(
      'Stream progress and provider text appear before completion',
      "document.querySelector('[role=dialog]').textContent.includes('Reading fixture context')",
    );
    await check(
      'Stream disables another Send while Cancel remains available',
      `${button('Send')}.disabled && !${button('Cancel')}.disabled && document.querySelector('[role=dialog] textarea').disabled`,
    );
    await click(label('Back to past conversations'));
    await check(
      'History remains reachable while a reply streams',
      "document.querySelector('[role=dialog]').textContent.includes('Past conversations')&&document.querySelector('[role=dialog]').textContent.includes('Replying…')",
    );
    await click(button('Close'));
    await until("!document.querySelector('[role=dialog]')", 'Panel closed');
    assert(aborted === 0, 'Closing the panel preserves the in-flight turn');
    await click(label('Ask AI'));
    await until(
      "document.querySelector('[role=dialog]') && !document.querySelector('[role=dialog]').getAnimations().some(a=>a.playState==='running')",
      'Panel reopening settled',
    );
    await until(`!!${button('Cancel')}`, 'Pending turn reopened');
    await click(button('Cancel'));
    for (let i = 0; i < 80 && aborted === 0; i++) await pause();
    assert(aborted === 1, 'Cancel closes the real local HTTP response');
    await check(
      'Cancel restores the composer without a spurious failure',
      `!${button('Cancel')}&&!document.querySelector('[role=dialog] textarea').disabled&&!document.querySelector('[role=dialog] [role=alert]')`,
    );
    mode = 'truncated';
    await send('Try another read');
    await until(
      "document.querySelector('[role=dialog]')?.textContent.includes('ended before it finished')",
      'Interrupted stream error',
    );
    await check(
      'Premature EOF shows a recoverable error instead of a completed answer',
      "!document.querySelector('[role=dialog]').textContent.includes('Streaming fragment')&&!document.querySelector('[role=dialog] textarea').disabled",
    );
    await shot('interrupted');
    mode = 'complete';
    await send('Read again');
    await until(
      "document.querySelector('[role=dialog]')?.textContent.includes('Completed fixture answer')",
      'Completed retry',
    );
    await check(
      'Successful reply clears progress and restores input',
      `!${button('Cancel')}&&!document.querySelector('[role=dialog] textarea').disabled&&!document.querySelector('[role=dialog]').textContent.includes('Streaming fragment')`,
    );
    await check(
      'Usage is rendered for the completed reply',
      "document.querySelector('[role=dialog]').textContent.includes('15')",
    );
    assert(
      requests.length === 3 && writes === 0,
      'Three read turns issue no configuration or live apply request',
    );
    await check(
      'Stream and recovery controls fit the viewport',
      "document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('[role=dialog]').getBoundingClientRect().right<=innerWidth+1",
    );
    await shot('complete');
    assert(errors.length === 0, 'Interception completed without errors');
    return { passed: true, checks };
  } catch (e) {
    await shot('failed-test');
    throw e;
  } finally {
    await cdp.send('Fetch.disable');
    for (const res of responses) res.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
