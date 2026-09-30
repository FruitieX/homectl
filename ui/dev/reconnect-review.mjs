import http from 'node:http';
import crypto from 'node:crypto';
import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021',
    marker = await fetch(origin + '/api/v1/config/routines');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const frame = await new Promise((resolve, reject) => {
    const ws = new WebSocket('ws://127.0.0.1:3021/ws');
    const timeout = setTimeout(() => {
      ws.close();
      reject(Error('Fixture state timeout'));
    }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ Resync: {} }));
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data);
      if (data.State) {
        clearTimeout(timeout);
        ws.close();
        resolve(data);
      }
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(Error('Fixture state failed'));
    };
  });
  const key = 'zigbee2mqtt/living_room_lamp';
  frame.State.revision = 5;
  frame.State.devices[key].data.Controllable.state.power = false;
  const encode = (text) => {
    const b = Buffer.from(text),
      h = Buffer.alloc(b.length < 126 ? 2 : b.length < 65536 ? 4 : 10);
    h[0] = 0x81;
    if (h.length === 2) h[1] = b.length;
    else if (h.length === 4) {
      h[1] = 126;
      h.writeUInt16BE(b.length, 2);
    } else {
      h[1] = 127;
      h.writeBigUInt64BE(BigInt(b.length), 2);
    }
    return Buffer.concat([h, b]);
  };
  const sockets = new Set(),
    messages = [];
  let latest,
    connections = 0;
  const send = (value) =>
    latest.write(
      encode(typeof value === 'string' ? value : JSON.stringify(value)),
    );
  const server = http.createServer();
  const transports = new Set();
  server.on('connection', (socket) => {
    transports.add(socket);
    socket.on('close', () => transports.delete(socket));
  });
  server.on('upgrade', (req, socket) => {
    const accept = crypto
      .createHash('sha1')
      .update(
        req.headers['sec-websocket-key'] +
          '258EAFA5-E914-47DA-95CA-C5AB0DC85B11',
      )
      .digest('base64');
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
    );
    sockets.add(socket);
    latest = socket;
    connections++;
    let buffered = Buffer.alloc(0);
    socket.on('close', () => sockets.delete(socket));
    socket.on('end', () => socket.end());
    socket.on('error', () => socket.destroy());
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 2) {
        const opcode = buffered[0] & 15,
          masked = !!(buffered[1] & 128);
        let len = buffered[1] & 127,
          offset = 2;
        if (len === 126) {
          if (buffered.length < 4) return;
          len = buffered.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffered.length < 10) return;
          len = Number(buffered.readBigUInt64BE(2));
          offset = 10;
        }
        if (buffered.length < offset + (masked ? 4 : 0) + len) return;
        let payload = buffered.subarray(
          offset + (masked ? 4 : 0),
          offset + (masked ? 4 : 0) + len,
        );
        if (masked) {
          const mask = buffered.subarray(offset, offset + 4);
          payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
        }
        buffered = buffered.subarray(offset + (masked ? 4 : 0) + len);
        if (opcode === 8) {
          socket.end(Buffer.from([0x88, 0]));
          return;
        }
        if (opcode === 1) messages.push(JSON.parse(payload.toString()));
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const config = await (await fetch(origin + '/api/config')).json(),
    errors = [];
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: origin + '/api/config' }],
  });
  cdp.on('Fetch.requestPaused', (e) => {
    void cdp
      .send('Fetch.fulfillRequest', {
        requestId: e.requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify({
            ...config,
            wsEndpoint: `ws://127.0.0.1:${port}/ws`,
          }),
        ).toString('base64'),
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
  const pause = () => new Promise((r) => setTimeout(r, 100));
  const until = async (expr, label) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(label);
  };
  const localUntil = async (fn, label) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(label);
  };
  const button = (t) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(t)})`;
  const field = "document.querySelector('[data-field=display_name]')";
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
      `/tmp/reconnect-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) writes++;
  });
  try {
    await cdp.send('Page.navigate', {
      url: origin + '/config/devices/detail/' + key,
    });
    await localUntil(
      () => latest && !latest.destroyed && !latest.readableEnded,
      'Socket opened',
    );
    await until(`!!${button('On')}&&!!${field}`, 'Device controls loaded');
    await check(
      'Socket open alone does not enable live controls',
      `${button('On')}.disabled&&${button('Off')}.disabled`,
    );
    await check(
      'Startup shows the retained-value warning on this viewport',
      "[...document.querySelectorAll('[role=status]')].some(e=>e.textContent.includes('Displayed values may be out of date')&&e.getBoundingClientRect().height>0)",
    );
    send(frame);
    await until(`!${button('On')}.disabled`, 'Fresh snapshot ready');
    await check(
      'Fresh snapshot enables controls and clears the warning',
      `!document.body.textContent.includes('Displayed values may be out of date')&&${button('Off')}.getAttribute('aria-pressed')==='true'`,
    );
    await click(field);
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      code: 'KeyA',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await cdp.send('Input.insertText', { text: 'Retained reconnect draft' });
    await pause();
    const changed = structuredClone(frame.State.devices[key]);
    changed.data.Controllable.state.power = true;
    send({
      Patch: {
        revision: 7,
        devices: { upserted: { [key]: changed }, removed: [] },
      },
    });
    await until(`${button('On')}.disabled`, 'Gap pauses controls');
    await check(
      'A revision gap preserves displayed state and the unsaved draft',
      `${button('Off')}.getAttribute('aria-pressed')==='true'&&${field}.value==='Retained reconnect draft'`,
    );
    await localUntil(
      () => messages.some((m) => m.Resync),
      'Gap requests full state',
    );
    const resyncs = messages.filter((m) => m.Resync).length;
    send({ Patch: { revision: 8 } });
    await pause();
    assert(
      messages.filter((m) => m.Resync).length === resyncs,
      'Further patches do not flood resync requests',
    );
    await shot('resync');
    frame.State.revision = 9;
    frame.State.devices[key] = changed;
    send(frame);
    await until(
      `!${button('On')}.disabled&&${button('On')}.getAttribute('aria-pressed')==='true'`,
      'Resync applied',
    );
    const off = structuredClone(changed);
    off.data.Controllable.state.power = false;
    send({
      Patch: {
        revision: 9,
        devices: { upserted: { [key]: off }, removed: [] },
      },
    });
    await pause();
    await check(
      'Duplicate patches do not overwrite fresh state',
      `${button('On')}.getAttribute('aria-pressed')==='true'`,
    );
    send({
      Patch: {
        revision: 10,
        devices: { upserted: { [key]: off }, removed: [] },
      },
    });
    await until(
      `${button('Off')}.getAttribute('aria-pressed')==='true'`,
      'Sequential patch applied',
    );
    assert(true, 'The next sequential patch updates live state');
    frame.State.revision = 10;
    frame.State.devices[key] = off;
    const beforeResume = connections;
    await evaluate("window.dispatchEvent(new Event('online'))");
    await until(`${button('On')}.disabled`, 'Resume awaits snapshot');
    send('not JSON');
    send('null');
    send({
      DeviceCommandResult: {
        request_id: 'unrelated',
        applied: true,
        error: null,
      },
    });
    await localUntil(
      () => connections > beforeResume,
      'Unanswered probe reconnects',
    );
    await check(
      'Unrelated traffic does not mark a resumed socket ready',
      `${button('On')}.disabled&&${field}.value==='Retained reconnect draft'`,
    );
    send(frame);
    await until(`!${button('On')}.disabled`, 'Replacement socket synchronized');
    const beforeDrop = connections;
    latest.destroy();
    await until(`${button('On')}.disabled`, 'Dropped connection shown');
    await localUntil(() => connections > beforeDrop, 'Automatic reconnect');
    await check(
      'Physical socket reconnect still waits for a snapshot',
      `${button('On')}.disabled&&${field}.value==='Retained reconnect draft'`,
    );
    send(frame);
    await until(`!${button('On')}.disabled`, 'Recovered');
    assert(
      !messages.some((m) => m.DeviceCommand || m.SceneCommand) && writes === 0,
      'Recovery sends no commands or configuration saves',
    );
    await click(button('On'));
    await localUntil(
      () => messages.some((m) => m.DeviceCommand),
      'Command uses recovered socket',
    );
    const command = messages.find((m) => m.DeviceCommand).DeviceCommand;
    assert(
      command.device_key === key && command.power === true,
      'Explicit action uses the recovered socket and intended device',
    );
    send({
      DeviceCommandResult: {
        request_id: command.request_id,
        applied: true,
        error: null,
      },
    });
    frame.State.devices[key].data.Controllable.state.power = true;
    frame.State.revision = 11;
    send(frame);
    await until(
      `!${button('On')}.disabled&&${button('On')}.getAttribute('aria-pressed')==='true'`,
      'Acknowledged state',
    );
    await check(
      'Acknowledged command leaves the configuration draft untouched',
      `${field}.value==='Retained reconnect draft'&&!!${button('Save changes')}`,
    );
    const beforePendingDrop = connections;
    await click(button('Off'));
    await localUntil(
      () => messages.filter((m) => m.DeviceCommand).length === 2,
      'Unconfirmed command submitted',
    );
    latest.destroy();
    await localUntil(
      () => connections > beforePendingDrop,
      'Pending-command reconnect',
    );
    send(frame);
    await until(
      `!${button('On')}.disabled`,
      'Pending command released after reconnect',
    );
    assert(
      messages.filter((m) => m.DeviceCommand).length === 2,
      'Unconfirmed commands are not replayed after reconnect',
    );
    await check(
      'Lost acknowledgement reports uncertainty without inventing device state',
      `document.body.textContent.includes('Connection lost before runtime confirmation') && ${button('On')}.getAttribute('aria-pressed')==='true' && ${field}.value==='Retained reconnect draft'`,
    );
    await shot('recovered');
    await check(
      'Recovery banner and editor fit the viewport',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    assert(errors.length === 0, 'Interception completed without errors');
    return { passed: true, checks };
  } catch (e) {
    await shot('failed-test');
    throw e;
  } finally {
    // This tab owns only the synthetic unsaved display-name draft. Explicitly
    // discard it so the app's beforeunload guard does not block test cleanup.
    if (await evaluate(`!!${button('Discard')}`))
      await click(button('Discard'));
    await cdp.send('Fetch.disable');
    await cdp.send('Page.navigate', { url: 'about:blank' });
    for (const socket of transports) socket.destroy();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
