/** Driver for dev/auth-e2e.mjs (run through dev/cdp-probe.mjs). */
export default async function (cdp, { url }) {
  const origin = new URL(url).origin;
  const provider = process.env.AUTH_E2E_PROVIDER;
  const artifacts = process.env.AUTH_E2E_ARTIFACTS;
  const checks = [];
  const pause = (ms = 100) => new Promise((done) => setTimeout(done, ms));
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const screenshot = async (name) => {
    if (!artifacts) return;
    const { writeFile } = await import('node:fs/promises');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `${artifacts}/${name}.png`,
      Buffer.from(shot.data, 'base64'),
    );
  };
  const check = async (name, expression, timeout = 15000) => {
    const deadline = Date.now() + timeout;
    let last;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(`Boolean(${expression})`)) {
          checks.push(name);
          console.log(`ok - ${name}`);
          return;
        }
      } catch (error) {
        // Navigation in progress destroys the context; retry.
        last = error;
      }
      await pause();
    }
    await screenshot(`failed-${checks.length + 1}`);
    throw Error(`${name}${last ? ` (${last.message})` : ''}`);
  };
  const button = (label) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)})`;
  const click = async (expression) => {
    await check(`visible: ${expression.slice(0, 60)}`, expression);
    await evaluate(`(${expression}).click()`);
  };
  const navigate = async (path) => {
    await cdp.send('Page.navigate', { url: origin + path });
    await pause(300);
  };
  const me = `fetch('/auth/me').then(r=>r.json())`;

  // Node-side helpers: a "tablet" and an admin session that use plain HTTP.
  const cookieOf = (response, name) =>
    response.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .find(
        (pair) => pair.startsWith(`${name}=`) && pair.length > name.length + 1,
      );
  const adminSession = async () => {
    await fetch(`${provider}/__user?name=rasse`);
    const login = await fetch(`${origin}/auth/login?return=/`, {
      redirect: 'manual',
    });
    const authorize = await fetch(login.headers.get('location'), {
      redirect: 'manual',
    });
    const callback = await fetch(authorize.headers.get('location'), {
      redirect: 'manual',
      headers: { cookie: cookieOf(login, 'homectl_oidc') },
    });
    const session = cookieOf(callback, 'homectl_session');
    if (!session) throw Error('Admin session not issued');
    return session;
  };
  const post = (path, body, cookie) =>
    fetch(origin + path, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    }).then((r) => r.json());

  // 1. Signed out: the sign-in screen leads, the app is not rendered.
  await check(
    'sign-in screen shown',
    `${button('Sign in with passkey')} && !document.querySelector('nav')`,
  );
  await screenshot('1-sign-in');

  // 2. Passkey sign-in through the provider returns to the app as admin.
  await fetch(`${provider}/__user?name=rasse`);
  await click(button('Sign in with passkey'));
  await check(
    'signed in as admin',
    `${me}.then(s=>s.authenticated&&s.admin&&s.username==='rasse')`,
  );
  await check(
    'app rendered after sign-in',
    `!${button('Sign in with passkey')} && document.querySelector('a[href="/config"], nav')`,
  );

  // 3. A tablet asks to pair; the admin approves its QR link in the browser.
  const tablet = await post('/auth/pair/start', { name: 'Hallway tablet' });
  await navigate(`/pair?code=${tablet.code}`);
  await check(
    'approval page shows the request',
    `document.querySelector('[data-testid="pair-review"]')?.textContent.includes(${JSON.stringify(tablet.code)})`,
  );
  await screenshot('2-approve');
  await click(button('Approve'));
  await check(
    'approval confirmed',
    `document.body.textContent.includes('is paired')`,
  );
  const polled = await post('/auth/pair/poll', { pairingId: tablet.pairingId });
  if (polled.status !== 'approved')
    throw Error(`tablet poll: ${polled.status}`);
  const devicesWithToken = await fetch(`${origin}/api/v1/devices`, {
    headers: { authorization: `Bearer ${polled.token}` },
  });
  if (devicesWithToken.status !== 200)
    throw Error(`device token refused: ${devicesWithToken.status}`);
  checks.push('tablet received a working credential');
  console.log('ok - tablet received a working credential');

  await navigate('/config/paired-devices');
  await check(
    'paired devices page lists the tablet',
    `[...document.querySelectorAll('[data-testid="paired-device"]')].some(e=>e.textContent.includes('Hallway tablet'))`,
  );
  await screenshot('3-paired-devices');

  // 4. A user outside the allowed groups is refused.
  await cdp.send('Network.clearBrowserCookies');
  await fetch(`${provider}/__user?name=ada`);
  await navigate('/');
  await click(button('Sign in with passkey'));
  await check(
    'kids user refused',
    `document.body.textContent.includes('Not allowed')`,
  );
  const refused = await evaluate(me);
  if (refused.authenticated) throw Error('refused user got a session');

  // 5. This browser as a wall display: pairing screen, approval, then the app.
  await cdp.send('Network.clearBrowserCookies');
  await navigate('/pair-device');
  await check(
    'pairing screen shows code and QR',
    `document.querySelector('[data-testid="pairing-code"]')?.textContent.match(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/) && document.querySelector('[data-testid="pair-device-screen"] svg')`,
  );
  await screenshot('4-pair-device');
  const code = await evaluate(
    `document.querySelector('[data-testid="pairing-code"]').textContent`,
  );
  const admin = await adminSession();
  const approved = await post(
    '/auth/pair/approve',
    { code, name: 'Kitchen display' },
    admin,
  );
  if (!approved.device)
    throw Error(`approve failed: ${JSON.stringify(approved)}`);
  await check(
    'display opens the app as a paired device',
    `${me}.then(s=>s.kind==='device'&&s.name==='Kitchen display')`,
    20000,
  );
  await check(
    'app rendered on the display',
    `!document.querySelector('[data-testid="pair-device-screen"]') && !${button('Sign in with passkey')}`,
  );
  await screenshot('5-display-paired');

  // 6. Revoking the display signs it out on its next API call.
  const revoke = await fetch(`${origin}/auth/devices/${approved.device.id}`, {
    method: 'DELETE',
    headers: { cookie: admin },
  });
  if (!revoke.ok) throw Error(`revoke failed: ${revoke.status}`);
  await evaluate(`fetch('/api/v1/devices').then(r=>r.status)`);
  await check(
    'revoked display returns to sign-in',
    button('Sign in with passkey'),
  );

  return { passed: true, checks };
}
