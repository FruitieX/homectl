/**
 * CDP probe for UI verification on hosts where the bundled browser cannot run.
 *
 *   # one-off: nix shell nixpkgs#chromium -c chromium --headless=new \
 *   #   --no-sandbox --disable-gpu --remote-debugging-port=9223 about:blank
 *   node dev/cdp-probe.mjs --url http://127.0.0.1:3011/config/groups \
 *        --out shot.png --width 430 --height 932 \
 *        --eval "document.querySelector('h1').textContent"
 *
 * Drives the DevTools-protocol browser over a WebSocket (Node's built-in
 * global) so no extra dependency is needed. Prints the evaluated value and any
 * console/page errors as JSON.
 */
const port = Number(process.env.CDP_PORT ?? 9223);
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}
const url = args.get('url');
if (!url) {
  console.error('usage: node dev/cdp-probe.mjs --url <url> [--out shot.png] [--eval expr]');
  process.exit(2);
}
const width = Number(args.get('width') ?? 430);
const height = Number(args.get('height') ?? 932);
const settleMs = Number(args.get('settle') ?? 1200);

class CDP {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
        return;
      }
      if (message.method) {
        for (const handler of this.listeners.get(message.method) ?? []) {
          handler(message.params);
        }
      }
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, handler) {
    const list = this.listeners.get(method) ?? [];
    list.push(handler);
    this.listeners.set(method, list);
  }
}

async function openTarget() {
  const created = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
    method: 'PUT',
  }).then((response) => response.json());
  const socket = new WebSocket(created.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  return { cdp: new CDP(socket), targetId: created.id, socket };
}

const { cdp, targetId, socket } = await openTarget();
const problems = [];

try {
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
  // Guard rail: a probe run may drive write flows, so every mutating request
  // must stay on localhost. Anything else is reporting as a problem instead of
  // being silently accepted.
  cdp.on('Network.requestWillBeSent', (params) => {
    const { method, url: requestUrl } = params.request;
    if (method === 'GET' || method === 'OPTIONS' || method === 'HEAD') return;
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/)/.test(requestUrl)) return;
    problems.push(`NON_LOCAL_WRITE ${method} ${requestUrl}`);
  });
  cdp.on('Runtime.exceptionThrown', (params) => {
    problems.push(`exception: ${params.exceptionDetails?.text ?? 'unknown'}`);
  });
  cdp.on('Log.entryAdded', (params) => {
    if (params.entry.level === 'error') problems.push(`log: ${params.entry.text}`);
  });
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700,
  });
  await cdp.send('Page.navigate', { url });
  await new Promise((resolve) => setTimeout(resolve, settleMs));

  if (args.get('eval')) {
    const expression = args.get('eval');
    const result = await cdp.send('Runtime.evaluate', {
      expression: `(async () => (${expression}))()`,
      returnByValue: true,
      awaitPromise: true,
    });
    console.log(JSON.stringify({ evaluated: result.result?.value ?? null }, null, 1));
  }

  if (args.get('out')) {
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: args.get('full') === '1',
    });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(args.get('out'), Buffer.from(shot.data, 'base64'));
  }
} finally {
  console.log(JSON.stringify({ url, viewport: { width, height }, problems: problems.slice(0, 8) }));
  socket.close();
  await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`).catch(() => {});
}
