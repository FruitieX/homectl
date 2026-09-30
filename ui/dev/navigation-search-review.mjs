import { writeFile } from 'node:fs/promises';

// Intercepted catalogs only; this journey never saves or commands fixture entities.
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3021';
  const response = await fetch(origin + '/api/v1/config/routines');
  if (
    !url.startsWith(origin + '/') ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const catalog = await response.json();
  const id = 'beyond-forty-' + width,
    name = 'Beyond catalog forty ' + width;
  const rows = Array.from({ length: 65 }, (_, i) => ({
    id: i === 64 ? id : `search-review-${width}-${i}`,
    name: i === 64 ? name : `Catalog routine ${i}`,
    enabled: false,
    semantics_version: 2,
    revision: 1,
    rules: [],
    actions: [],
    definition_v2: {
      triggers: [{ kind: 'manual', id: 'manual' }],
      program: { kind: 'native', steps: [] },
    },
  }));
  let fail = true,
    writes = 0;
  const errors = [],
    checks = [];
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) writes++;
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: origin + '/api/v1/config/routines' }],
  });
  cdp.on('Fetch.requestPaused', ({ requestId }) => {
    void cdp
      .send('Fetch.fulfillRequest', {
        requestId,
        responseCode: fail ? 503 : 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(
          JSON.stringify(
            fail
              ? { success: false, error: 'Fixture catalog unavailable' }
              : { ...catalog, data: [...catalog.data, ...rows] },
          ),
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
  const pause = () => new Promise((r) => setTimeout(r, 140));
  const until = async (expression, message) => {
    for (let i = 0; i < 110; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const input = `document.querySelector('[aria-label="Search homectl"]')`;
  const field = `document.querySelector('[data-field="name"]')`;
  const matches = (text) =>
    `[...document.querySelectorAll('[cmdk-item]')].filter(e=>e.textContent.includes(${JSON.stringify(text)}))`;
  const click = async (expression) => {
    const p = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Missing target');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
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
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        modifiers,
      });
    await pause();
  };
  const type = async (expression, text) => {
    await click(expression);
    await key('a', 65, 2);
    await key('Backspace', 8);
    await cdp.send('Input.insertText', { text });
    await pause();
  };
  const check = async (name, expression) => {
    if (!(await evaluate(expression)))
      throw Error(
        name + ': ' + (await evaluate('document.activeElement?.outerHTML')),
      );
    checks.push({ name, passed: true });
  };
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/navigation-search-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const open = async () => {
    await key('k', 75, 2);
    await until('!!' + input, 'Palette opens');
  };
  try {
    await cdp.send('Page.navigate', {
      url: origin + '/config/groups/living_room',
    });
    await until('!!' + field, 'Room editor ready');
    const draft = 'Unsaved search journey ' + width;
    await type(field, draft);
    await open();
    await until('!!' + button('Retry'), 'Catalog failure visible');
    await check(
      'Incomplete catalog is identified',
      "document.querySelector('[role=dialog]').textContent.includes('Could not refresh routines. Results may be incomplete.')",
    );
    await type(input, name);
    await check(
      'Unavailable catalog does not invent results',
      matches(name) + '.length===0',
    );
    await check(
      'Close stays within the search row without covering Retry',
      "(()=>{const close=document.querySelector('[role=dialog] button[aria-label=Close]').getBoundingClientRect();const input=document.querySelector('[aria-label=\"Search homectl\"]').getBoundingClientRect();return close.bottom<=input.bottom+1})()",
    );
    await shot('unavailable');
    fail = false;
    await click(button('Retry'));
    await until(matches(name) + '.length===1', 'Beyond forty result appears');
    await check(
      'Retry retains the query and finds the last of 65 routines',
      input + '.value===' + JSON.stringify(name),
    );
    await check(
      'Search field has accessible keyboard focus',
      'document.activeElement===' +
        input +
        ' || document.activeElement.textContent.trim()==="Retry"',
    );
    await shot('recovered');
    await key('Escape', 27);
    await until('!' + input, 'Escape closes search');
    await until(
      'document.activeElement===' + field,
      'Focus returns to edited field',
    );
    await check(
      'Escape restores focus without losing the draft',
      field + '.value===' + JSON.stringify(draft),
    );
    const history = await cdp.send('Page.getNavigationHistory');
    const entryId = history.entries[history.currentIndex].id;
    await open();
    await check('Reopening clears the prior query', input + '.value===""');
    await type(input, name);
    await key('Enter', 13);
    await until(
      'location.pathname===' + JSON.stringify('/config/routines/' + id),
      'Enter navigates to routine',
    );
    await check('Navigation closes the palette', '!' + input);
    await cdp.send('Page.navigateToHistoryEntry', { entryId });
    await until(
      '!!' + field + ' && location.pathname==="/config/groups/living_room"',
      'Back returns to room',
    );
    await check(
      'Browser Back retains the room draft',
      field + '.value===' + JSON.stringify(draft),
    );
    await open();
    await check(
      'Recent destination appears exactly once',
      matches(name) + '.length===1',
    );
    await type(input, name);
    await check(
      'Recent destination is not duplicated during search',
      matches(name) + '.length===1',
    );
    await type(input, 'circadian');
    await until(
      "[...document.querySelectorAll('[cmdk-item]')].some(e=>e.textContent.includes('Computed source · circadian'))",
      'Source indexed',
    );
    await check(
      'Computed sources are included with their identity',
      "[...document.querySelectorAll('[cmdk-item]')].filter(e=>e.textContent.includes('Computed source · circadian')).length===1",
    );
    await shot('source');
    await click(
      "[...document.querySelectorAll('[cmdk-item]')].find(e=>e.textContent.includes('Computed source · circadian'))",
    );
    await until(
      "location.pathname==='/config/sources/circadian'",
      'Source canonical route',
    );
    await check(
      'Entity search opens source details',
      "location.pathname==='/config/sources/circadian'",
    );
    await cdp.send('Page.navigateToHistoryEntry', { entryId });
    await until(
      '!!' + field + ' && location.pathname==="/config/groups/living_room"',
      'Return for cleanup',
    );
    await check(
      'Navigation fits viewport',
      'document.documentElement.scrollWidth<=innerWidth+1',
    );
    if (writes || errors.length)
      throw Error(JSON.stringify({ writes, errors }));
    checks.push({
      name: 'Search and navigation perform no writes',
      passed: true,
    });
    await click(button('Discard'));
    await until('!' + button('Discard'), 'Draft discarded');
    return {
      passed: true,
      checks,
      expectedErrors: 'Injected routine catalog HTTP 503 before Retry',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await cdp.send('Fetch.disable');
  }
}
