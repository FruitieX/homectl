/**
 * Screenshot + DOM probe used for UI verification during the Settings UX work.
 *
 *   node dev/probe.mjs --url <url> [--out shot.png] [--width 430] [--height 932]
 *                      [--eval "<expr>"] [--wait 800]
 *
 * Prints console/page errors and the value of --eval as JSON. The browser is a
 * Playwright-managed Chromium (from the local cache) because the host cannot
 * launch the default bundled browser.
 */
/**
 * Playwright resolution: the repo does not depend on Playwright, so the probe
 * loads it from the first available candidate and can be pointed at any
 * installation with PLAYWRIGHT_MODULE.
 */
async function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    'playwright-core',
  ].filter(Boolean);
  const failures = [];
  for (const candidate of candidates) {
    try {
      return await import(candidate);
    } catch (error) {
      failures.push(`${candidate}: ${error.message}`);
    }
  }
  throw new Error(
    `Could not load Playwright. Install it or set PLAYWRIGHT_MODULE. Tried:\n${failures.join('\n')}`,
  );
}

const { chromium } = await loadPlaywright();

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const url = args.get('url');
if (!url) {
  console.error('usage: node dev/probe.mjs --url <url> [--out shot.png] [--eval expr]');
  process.exit(2);
}
const width = Number(args.get('width') ?? 430);
const height = Number(args.get('height') ?? 932);
const waitMs = Number(args.get('wait') ?? 800);
const executablePath = process.env.CHROME_PATH;

const browser = await chromium.launch({
  ...(executablePath ? { executablePath } : {}),
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

const problems = [];
page.on('console', (message) => {
  if (message.type() === 'error') problems.push(`console: ${message.text()}`);
});
page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(waitMs);

if (args.get('out')) {
  await page.screenshot({ path: args.get('out'), fullPage: args.get('full') === '1' });
}

if (args.get('eval')) {
  const expr = args.get('eval');
  const value = await page.evaluate(
    // eslint-disable-next-line no-new-func
    new Function(`return (${expr});`),
  );
  console.log(JSON.stringify(value, null, 1));
}

console.log(JSON.stringify({ url, problems: problems.slice(0, 8) }));
await browser.close();
