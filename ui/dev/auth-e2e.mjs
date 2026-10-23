/**
 * Browser end-to-end test of sign-in and device pairing against the real
 * server binary, the built UI and a mock OIDC provider.
 *
 *   cargo build --bin homectl-server          # from the repo root
 *   nix shell nixpkgs#chromium --command pnpm test:auth-e2e
 *
 * HOMECTL_SERVER_BIN overrides the server binary (default
 * ../target/debug/homectl-server); SMOKE_SKIP_BUILD=1 reuses ui/dist.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { mkdtemp, mkdir, rm, open, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = resolve(root, 'test-artifacts/auth-e2e');
const work = await mkdtemp(resolve(tmpdir(), 'homectl-auth-e2e-'));
const children = [],
  logs = [];
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

function stop(child, signal) {
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function start(name, command, args, env, cwd = root) {
  const log = await open(resolve(artifacts, `${name}.log`), 'w');
  logs.push(log);
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ['ignore', log.fd, log.fd],
    detached: true,
  });
  children.push(child);
  return child;
}

async function exited(child, name, timeout = 180000) {
  if (child.exitCode !== null) {
    if (child.exitCode !== 0) throw Error(`${name} exited ${child.exitCode}`);
    return;
  }
  await new Promise((done, reject) => {
    const timer = setTimeout(() => reject(Error(`${name} timed out`)), timeout);
    child.once('exit', (code) => {
      clearTimeout(timer);
      if (code === 0) done();
      else reject(Error(`${name} exited ${code}; see ${artifacts}`));
    });
  });
}

async function ready(url, child) {
  for (let i = 0; i < 300; i++) {
    if (child.exitCode !== null) throw Error(`Exited before ${url} was ready`);
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* starting */
    }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw Error(`Not ready: ${url}`);
}

/** Minimal OIDC provider: signs in `currentUser` without any prompt. */
function startMockProvider(port) {
  const issuer = `http://127.0.0.1:${port}`;
  const grants = new Map();
  const users = {
    rasse: ['admins', 'family'],
    julle: ['family'],
    ada: ['kids'],
  };
  const state = { currentUser: 'rasse' };
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url, issuer);
    const json = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
      });
    }
    if (url.pathname === '/__user') {
      state.currentUser = url.searchParams.get('name');
      return json(200, { ok: true });
    }
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      const code = randomUUID();
      grants.set(code, {
        nonce: q.get('nonce'),
        challenge: q.get('code_challenge'),
        user: state.currentUser,
      });
      res.writeHead(302, {
        location: `${q.get('redirect_uri')}?code=${code}&state=${encodeURIComponent(q.get('state'))}`,
      });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const form = new URLSearchParams(body);
      const grant = grants.get(form.get('code'));
      grants.delete(form.get('code'));
      const challenge = createHash('sha256')
        .update(form.get('code_verifier') ?? '')
        .digest('base64url');
      if (!grant || challenge !== grant.challenge)
        return json(400, { error: 'invalid_grant' });
      const claims = {
        iss: issuer,
        sub: `sub-${grant.user}`,
        aud: 'homectl',
        exp: Math.floor(Date.now() / 1000) + 300,
        nonce: grant.nonce,
        name: grant.user,
        preferred_username: grant.user,
        groups: users[grant.user] ?? [],
      };
      const idToken = `e30.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.sig`;
      return json(200, { id_token: idToken, token_type: 'Bearer' });
    }
    json(404, { error: 'not found' });
  });
  server.listen(port, '127.0.0.1');
  return { issuer, server };
}

let provider;
try {
  const browser = [
    process.env.CHROME_BIN,
    'google-chrome',
    'chromium',
    'chromium-browser',
  ]
    .filter(Boolean)
    .find(
      (command) =>
        spawnSync(command, ['--version'], { stdio: 'ignore' }).status === 0,
    );
  if (!browser) throw Error('Chromium/Chrome required (set CHROME_BIN).');
  const serverBin =
    process.env.HOMECTL_SERVER_BIN ??
    resolve(root, '../target/debug/homectl-server');
  if (!existsSync(serverBin))
    throw Error(
      `Server binary not found at ${serverBin}; run cargo build --bin homectl-server`,
    );
  if (process.env.SMOKE_SKIP_BUILD !== '1')
    await exited(
      // Same-origin API calls, whatever a local .env points at.
      await start('build', 'pnpm', ['exec', 'vite', 'build'], {
        ...process.env,
        API_ENDPOINT: '',
      }),
      'UI build',
    );

  const [providerPort, serverPort, cdpPort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
  ]);
  provider = startMockProvider(providerPort);
  const origin = `http://127.0.0.1:${serverPort}`;
  const server = await start(
    'server',
    serverBin,
    ['--port', String(serverPort)],
    {
      ...process.env,
      RUST_LOG: 'warn,homectl_server=info',
      WARMUP_TIME: '0',
      DATABASE_URL: `sqlite://${work}/homectl.db?mode=rwc`,
      HOMECTL_UI_DIST_DIR: resolve(root, 'dist'),
      HOMECTL_OIDC_ISSUER: provider.issuer,
      HOMECTL_OIDC_CLIENT_ID: 'homectl',
      HOMECTL_OIDC_CLIENT_SECRET: 'e2e-secret',
      HOMECTL_PUBLIC_URL: origin,
      HOMECTL_OIDC_ALLOWED_GROUPS: 'family',
    },
    work,
  );
  await ready(`${origin}/health/ready`, server);
  const chrome = await start(
    'chrome',
    browser,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${resolve(work, 'chrome')}`,
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${cdpPort}`,
      'about:blank',
    ],
    process.env,
  );
  await ready(`http://127.0.0.1:${cdpPort}/json/version`, chrome);

  const probe = await start(
    'driver',
    process.execPath,
    [
      'dev/cdp-probe.mjs',
      '--url',
      origin + '/',
      '--width',
      '1280',
      '--height',
      '900',
      '--settle',
      '300',
      '--driver-file',
      'dev/auth-e2e-driver.mjs',
      '--out',
      resolve(artifacts, 'final.png'),
    ],
    {
      ...process.env,
      CDP_PORT: String(cdpPort),
      AUTH_E2E_PROVIDER: provider.issuer,
      AUTH_E2E_ARTIFACTS: artifacts,
    },
  );
  try {
    await exited(probe, 'auth e2e driver');
  } finally {
    console.log(await readFile(resolve(artifacts, 'driver.log'), 'utf8'));
  }
  console.log('Auth e2e passed');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  provider?.server.close();
  for (const child of children.reverse()) stop(child, 'SIGTERM');
  await new Promise((done) => setTimeout(done, 500));
  for (const child of children) stop(child, 'SIGKILL');
  for (const log of logs) await log.close();
  await rm(work, { recursive: true, force: true, maxRetries: 3 });
}
