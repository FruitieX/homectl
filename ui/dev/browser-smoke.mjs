/** Small CI suite using the existing CDP drivers and a marked, in-memory API. */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, open, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'test-artifacts/browser');
const profile = await mkdtemp(resolve(tmpdir(), 'homectl-smoke-'));
const children = [],
  logs = [];
function stop(child, signal) {
  try {
    process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}
await mkdir(artifacts, { recursive: true });
const freePort = () =>
  new Promise((done, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => done(port));
    });
  });
const fixturePort = await freePort(),
  uiPort = await freePort(),
  cdpPort = await freePort();
const origin = `http://127.0.0.1:${uiPort}`;
const env = {
  ...process.env,
  API_ENDPOINT: '',
  HOMECTL_DEV_PROXY_TARGET: `http://127.0.0.1:${fixturePort}`,
  CDP_PORT: String(cdpPort),
  SMOKE_ARTIFACTS: artifacts,
};
async function start(name, command, args, processEnv = env) {
  const log = await open(resolve(artifacts, `${name}.log`), 'w');
  logs.push(log);
  const child = spawn(command, args, {
    cwd: root,
    env: processEnv,
    stdio: ['ignore', log.fd, log.fd],
    detached: process.platform !== 'win32',
  });
  children.push(child);
  child.on('error', (error) => console.error(`${name}: ${error.message}`));
  return child;
}
async function completed(child, name, timeout = 180000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    if (child.exitCode !== 0)
      throw Error(
        `${name} exited ${child.exitCode ?? child.signalCode}; see ${artifacts}`,
      );
    return;
  }
  await new Promise((done, reject) => {
    const timer = setTimeout(() => {
      stop(child, 'SIGTERM');
      reject(Error(`${name} timed out`));
    }, timeout);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else reject(Error(`${name} exited ${code}; see ${artifacts}`));
    });
  });
}
async function ready(url, child) {
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw Error(`Service exited before ${url} was ready`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* service starting */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw Error(`Service did not become ready: ${url}`);
}
try {
  const browser = [
    process.env.CHROME_BIN,
    'google-chrome',
    'chromium',
    'chromium-browser',
    '/opt/google/chrome/chrome',
  ]
    .filter(Boolean)
    .find(
      (command) =>
        spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0,
    );
  if (!browser)
    throw Error(
      'Chromium/Chrome required. Set CHROME_BIN to its executable (on Nix: nix shell nixpkgs#chromium --command pnpm test:browser).',
    );
  if (process.env.SMOKE_SKIP_BUILD !== '1')
    await completed(
      await start('build', 'pnpm', ['exec', 'vite', 'build']),
      'Production build',
    );
  const fixture = await start('fixture', process.execPath, [
    '--experimental-strip-types',
    'dev/fixture-server.mjs',
    '--port',
    String(fixturePort),
  ]);
  await ready(`${env.HOMECTL_DEV_PROXY_TARGET}/api/v1/config/groups`, fixture);
  const ui = await start('preview', 'pnpm', [
    'exec',
    'vite',
    'preview',
    '--host',
    '127.0.0.1',
    '--port',
    String(uiPort),
    '--strictPort',
  ]);
  await ready(origin + '/config', ui);
  const chrome = await start('chrome', browser, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    `--user-data-dir=${profile}`,
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${cdpPort}`,
    'about:blank',
  ]);
  await ready(`http://127.0.0.1:${cdpPort}/json/version`, chrome);
  for (const [width, height] of [
    [1440, 1000],
    [390, 844],
  ]) {
    // Each viewport starts with an independent catalog and fresh tab storage.
    const reset = await fetch(
      `${env.HOMECTL_DEV_PROXY_TARGET}/__fixture/normal`,
      { method: 'POST' },
    );
    if (!reset.ok) throw Error('Could not reset fixture');
    const name = `smoke-${width}`;
    try {
      await completed(
        await start(name, process.execPath, [
          'dev/cdp-probe.mjs',
          '--url',
          origin + '/config',
          '--width',
          String(width),
          '--height',
          String(height),
          '--settle',
          '100',
          '--strict',
          '1',
          '--driver-file',
          'dev/browser-smoke-driver.mjs',
          '--out',
          resolve(artifacts, `${name}.png`),
        ]),
        name,
      );
    } catch (error) {
      console.error(await readFile(resolve(artifacts, `${name}.log`), 'utf8'));
      throw error;
    }
    console.log(`${width} × ${height}: browser smoke passed`);
  }
  console.log(`Screenshots and logs: ${artifacts}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const child of children.reverse()) stop(child, 'SIGTERM');
  // Allow Chromium to release its profile; force only this run's own processes.
  await Promise.all(
    children.map(async (child) => {
      for (
        let i = 0;
        i < 30 && child.exitCode === null && child.signalCode === null;
        i++
      )
        await new Promise((done) => setTimeout(done, 100));
      stop(child, 'SIGKILL');
    }),
  );
  for (const log of logs) await log.close();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
