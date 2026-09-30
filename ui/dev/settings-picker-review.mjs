import { writeFile } from 'node:fs/promises';

// Read-only intercepted catalog; no saved fixture or household configuration changes.
export default async function (cdp, { width, height, url }) {
  const origin = 'http://127.0.0.1:3021';
  const response = await fetch(origin + '/api/v1/config/groups');
  if (
    !url.startsWith(origin + '/') ||
    response.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const catalog = await response.json();
  catalog.data = catalog.data.map((g) =>
    g.id === 'living_room'
      ? { ...g, linked_groups: ['unavailable-review'] }
      : g,
  );
  catalog.data.push(
    ...Array.from({ length: 65 }, (_, i) => ({
      id: 'picker-' + i,
      name: 'Picker room ' + String(i).padStart(2, '0'),
      hidden: false,
      devices: [],
      linked_groups: [],
    })),
    {
      id: 'picker-cycle',
      name: 'Picker cycle',
      hidden: false,
      devices: [],
      linked_groups: ['living_room'],
    },
  );
  const checks = [];
  let writes = 0;
  const errors = [];
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
  const pause = () => new Promise((r) => setTimeout(r, 160));
  const until = async (expr, label) => {
    for (let i = 0; i < 90; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(label);
  };
  const check = async (name, expr) => {
    if (!(await evaluate(expr))) throw Error(name);
    checks.push({ name, passed: true });
  };
  const button = (s) =>
    "[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===" +
    JSON.stringify(s) +
    ')';
  const dialog = "document.querySelector('[role=dialog]')";
  const search =
    'document.querySelector(\'[aria-label="Search rooms & groups"]\')';
  const option = (name) =>
    "[...document.querySelectorAll('[role=dialog] label')].find(e=>e.textContent.includes(" +
    JSON.stringify(name) +
    "))?.querySelector('input[type=checkbox]')";
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        windowsVirtualKeyCode: code,
        modifiers,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
      });
    await pause();
  };
  const activate = async (expr) => {
    await evaluate(expr + '.focus()');
    await key('Enter', 13);
  };
  const type = async (value) => {
    await evaluate(search + '.focus()');
    await key('a', 65, 2);
    await cdp.send('Input.insertText', { text: value });
    await pause();
  };
  const screenshot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      '/tmp/settings-picker-' + width + '-' + name + '.png',
      Buffer.from(data, 'base64'),
    );
  };
  const model = async () => {
    await evaluate(
      "for(const [k,v]of Object.entries({height:430,offsetTop:40,scale:1}))Object.defineProperty(visualViewport,k,{configurable:true,get:()=>v});visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'))",
    );
    await pause();
  };
  const restore = async () => {
    await evaluate(
      "for(const k of ['height','offsetTop','scale'])delete visualViewport[k];visualViewport.dispatchEvent(new Event('resize'))",
    );
    await pause();
  };
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) writes++;
  });
  await cdp.send('Fetch.enable', {
    patterns: [{ urlPattern: origin + '/api/v1/config/groups' }],
  });
  cdp.on('Fetch.requestPaused', ({ requestId }) => {
    void cdp
      .send('Fetch.fulfillRequest', {
        requestId,
        responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify(catalog)).toString('base64'),
      })
      .catch((e) => errors.push(e.message));
  });
  try {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
    await cdp.send('Page.navigate', {
      url: origin + '/config/groups/living_room',
    });
    await until('!!' + button('Add groups'), 'Group editor');
    await activate(button('Add groups'));
    await until('!!' + search, 'Picker');
    await check('Opening focuses search', 'document.activeElement===' + search);
    await check(
      'Large catalog starts at forty rows',
      "document.querySelectorAll('[role=dialog] input[type=checkbox]').length===40",
    );
    await check(
      'Draft starts with retained unavailable reference',
      dialog + ".textContent.includes('1 selected')",
    );
    await type('picker room 64');
    await check(
      'Search finds entries beyond the first forty',
      '!!' + option('Picker room 64'),
    );
    await key('Tab', 9);
    await key(' ', 32);
    await check(
      'Keyboard stages a selection',
      option('Picker room 64') +
        '.checked && ' +
        dialog +
        ".textContent.includes('2 selected')",
    );
    await activate(button('Cancel'));
    await until('!' + dialog, 'Cancel closes');
    await check(
      'Cancel returns focus to Add groups',
      'document.activeElement===' + button('Add groups'),
    );
    await activate(button('Add groups'));
    await until('!!' + search, 'Reopen');
    await check(
      'Cancel discards pending membership',
      dialog + ".textContent.includes('1 selected')",
    );
    await type('picker cycle');
    await check(
      'Cyclic group is explained and disabled',
      option('Picker cycle') +
        '.disabled && ' +
        dialog +
        ".textContent.includes('Would create a nesting loop')",
    );
    await type('unavailable-review');
    await check(
      'Unavailable selection remains removable',
      option('unavailable-review') +
        '.checked && !' +
        option('unavailable-review') +
        '.disabled',
    );
    await key('Tab', 9);
    await key(' ', 32);
    await check(
      'Unavailable reference can be deselected',
      '!' + option('unavailable-review') + '.checked',
    );
    await key('Escape', 27);
    await until('!' + dialog, 'Escape closes');
    await check(
      'Escape returns focus to Add groups',
      'document.activeElement===' + button('Add groups'),
    );
    await activate(button('Add groups'));
    await until('!!' + search, 'Reopen all');
    await check(
      'Escape preserves original membership',
      dialog + ".textContent.includes('1 selected')",
    );
    const more =
      "[...document.querySelectorAll('[role=dialog] button')].find(e=>e.textContent.startsWith('Show more'))";
    await activate(more);
    await check(
      'Show more reveals remaining catalog',
      '!!' + option('Picker room 64'),
    );
    await type('picker room 64');
    await key('Tab', 9);
    await key(' ', 32);
    if (width < 768 && height > 600) {
      await type('');
      await model();
      await check(
        'Picker fits visible keyboard area',
        '(()=>{const r=' +
          dialog +
          '.getBoundingClientRect();return r.top>=40&&r.bottom<=470})()',
      );
      await check(
        'Search and Done remain visible',
        '(()=>{const d=' +
          dialog +
          '.getBoundingClientRect();return [' +
          search +
          ',' +
          button('Done') +
          '].every(e=>{const r=e.getBoundingClientRect();return r.top>=d.top&&r.bottom<=d.bottom&&r.height>=40})})()',
      );
      await screenshot('keyboard');
      await restore();
    }
    await screenshot('selection');
    await activate(button('Done'));
    await until('!' + dialog, 'Done closes');
    await check(
      'Done returns focus to Add groups',
      'document.activeElement===' + button('Add groups'),
    );
    await check(
      'Done updates page draft without saving',
      "document.querySelector('.settings-workspace').textContent.includes('Picker room 64') && !!" +
        button('Save changes'),
    );
    await activate(button('Discard'));
    await check(
      'Discard restores saved membership',
      "!document.querySelector('.settings-workspace').textContent.includes('Picker room 64')",
    );
    if (width < 1024) {
      const trigger =
        'document.querySelector(\'button[aria-label="Settings categories"]\')';
      await activate(trigger);
      await until('!!' + dialog, 'Categories open');
      if (height > 600) await model();
      await check(
        'Categories dialog fits available height',
        '(()=>{const r=' +
          dialog +
          '.getBoundingClientRect();return r.top>=0&&r.bottom<=' +
          (height > 600 ? '470' : 'innerHeight') +
          '})()',
      );
      const last =
        "[...document.querySelectorAll('[role=dialog] nav a')].at(-1)";
      await evaluate(last + '.focus()');
      await pause();
      await check(
        'Final category can be reached by focus',
        '(()=>{const r=' +
          last +
          '.getBoundingClientRect(),d=' +
          dialog +
          '.getBoundingClientRect();return r.top>=d.top&&r.bottom<=d.bottom})()',
      );
      await check(
        'Category title and Close remain visible at end of list',
        '(()=>{const d=' +
          dialog +
          ".getBoundingClientRect();return [document.querySelector('[role=dialog] h2'),document.querySelector('[role=dialog] button[aria-label=Close]')].every(e=>{const r=e.getBoundingClientRect();return r.top>=d.top&&r.bottom<=d.bottom})})()",
      );
      await screenshot('categories');
      await key('Escape', 27);
      await until('!' + dialog, 'Categories close');
      if (height > 600) await restore();
      await check(
        'Categories Escape restores trigger focus',
        'document.activeElement===' + trigger,
      );
    }
    if (writes || errors.length)
      throw Error(JSON.stringify({ writes, errors }));
    checks.push({
      name: 'No API writes or interception failures',
      passed: true,
    });
    return {
      passed: true,
      checks,
      scope:
        'Synthetic catalog, native keys; phone keyboard geometry is injected, not physical hardware',
    };
  } catch (e) {
    await screenshot('failure');
    throw e;
  } finally {
    await restore();
    await cdp.send('Fetch.disable');
  }
}
