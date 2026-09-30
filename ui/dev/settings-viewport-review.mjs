import { writeFile } from 'node:fs/promises';

// Uses native keys and a controlled VisualViewport model for keyboard/pan
// events. This is browser layout evidence, not a physical mobile keyboard test.
export default async function (cdp, { width, height, url }) {
  const origin = 'http://127.0.0.1:3021';
  const marker = await fetch(origin + '/api/v1/config/routines');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked fixture required');
  const reflowScale = Number(new URL(url).searchParams.get('reviewScale')) || 1;
  if (reflowScale !== 1)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: reflowScale,
      mobile: false,
      screenWidth: width * reflowScale,
      screenHeight: height * reflowScale,
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
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const key = async (key, code, modifiers = 0) => {
    for (const type of ['keyDown', 'keyUp'])
      await cdp.send('Input.dispatchKeyEvent', {
        type,
        key,
        code: key === 'Enter' ? 'Enter' : undefined,
        text: type === 'keyDown' && key === 'Enter' ? '\r' : undefined,
        windowsVirtualKeyCode: code,
        modifiers,
      });
    await pause();
  };
  const checks = [];
  const contrast = () => {
    // Computed Tailwind colors can be oklab/color-mix, not only rgb().
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const rgba = (color) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const luminance = (rgb) =>
      rgb
        .slice(0, 3)
        .map((n) => n / 255)
        .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4))
        .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i], 0);
    return [
      ...document.querySelectorAll(
        '.flow-lane > header h2, .flow-lane .text-destructive',
      ),
    ].map((e) => {
      const foreground = rgba(getComputedStyle(e).color),
        background = [0, 0, 0];
      let covered = 0;
      for (let p = e; p; p = p.parentElement) {
        const color = rgba(getComputedStyle(p).backgroundColor);
        for (let i = 0; i < 3; i++)
          background[i] += color[i] * color[3] * (1 - covered);
        covered += color[3] * (1 - covered);
      }
      for (let i = 0; i < 3; i++) background[i] += 255 * (1 - covered);
      const a = luminance(foreground),
        b = luminance(background);
      return {
        name: e.textContent,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    });
  };
  let writes = 0;
  const requests = [];
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (
      new URL(request.url).pathname ===
      '/api/v1/config/routines/schedule-preview'
    )
      return;
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(request.method)) {
      writes++;
      requests.push(request.method + ' ' + request.url);
    }
  });
  const check = async (name, expr) => {
    if (!(await evaluate(expr)))
      throw Error(
        name +
          ': ' +
          (await evaluate(
            'JSON.stringify({focus:document.activeElement?.outerHTML,innerWidth,innerHeight})',
          )),
      );
    checks.push({ name, passed: true });
  };
  const shot = async (state) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/settings-viewport-${width}-${state}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const originalTheme = await evaluate("localStorage.getItem('homectl-theme')");
  const originalDensity = await evaluate(
    "localStorage.getItem('homectl-density')",
  );
  await evaluate(
    "localStorage.setItem('homectl-theme',JSON.stringify('auto'));localStorage.setItem('homectl-density',JSON.stringify('compact'))",
  );
  await cdp.send('Emulation.setEmulatedMedia', {
    features: [
      { name: 'prefers-reduced-motion', value: 'reduce' },
      { name: 'prefers-color-scheme', value: 'light' },
    ],
  });
  const goto = async (route, field) => {
    await cdp.send('Page.navigate', { url: origin + route });
    await until(
      `!!document.querySelector('[data-field="${field}"]')`,
      'Editor ready',
    );
    await pause();
  };
  const focusByKeyboard = async (field) => {
    for (let i = 0; i < 100; i++) {
      if (
        await evaluate(
          `document.activeElement===document.querySelector('[data-field="${field}"]')`,
        )
      )
        return;
      await key('Tab', 9);
    }
    throw Error('Keyboard could not reach ' + field);
  };
  const discard = async () => {
    await evaluate(button('Discard') + '?.focus()');
    await key('Enter', 13);
    await until(
      "![...document.querySelectorAll('input[data-field]')].some(e=>e.value.startsWith('Viewport review'))",
      'Discarded',
    );
  };
  const model = async (height, top = 0, scale = 1) => {
    await evaluate(
      `(()=>{const v=visualViewport;for(const [key,value] of Object.entries({height:${height},offsetTop:${top},scale:${scale}}))Object.defineProperty(v,key,{configurable:true,get:()=>value});v.dispatchEvent(new Event('resize'));v.dispatchEvent(new Event('scroll'));})()`,
    );
    await pause();
  };
  const restoreModel = async () => {
    await evaluate(
      "for(const key of ['height','offsetTop','scale'])delete visualViewport[key];visualViewport.dispatchEvent(new Event('resize'))",
    );
    await pause();
  };
  try {
    for (const [name, route, field] of [
      ['routine', '/config/routines/kitchen_day', 'name'],
      ['scene', '/config/scenes/dark', 'name'],
      ['widget', '/config/dashboard/1/widgets/new', 'title'],
    ]) {
      await goto(route, field);
      await check(
        name + ': full page title remains readable',
        "(()=>{const h=document.querySelector('h1');return h.scrollWidth<=h.clientWidth+1})()",
      );
      await check(
        name + ': fits viewport',
        'document.documentElement.scrollWidth<=innerWidth+1 && [...document.querySelectorAll(".settings-workspace")].every(e=>e.scrollWidth<=e.clientWidth+1)',
      );
      if (width < 768)
        await check(
          name + ': phone button targets stay at least 44px',
          "[...document.querySelectorAll('.settings-workspace button')].filter(e=>e.getBoundingClientRect().width>0).every(e=>e.getBoundingClientRect().width>=43.9 && e.getBoundingClientRect().height>=43.9)",
        );
      await focusByKeyboard(field);
      await key('a', 65, 2);
      await cdp.send('Input.insertText', { text: 'Viewport review ' + name });
      await until('!!' + button('Discard'), 'Draft dirty');
      await check(
        name + ': reduced motion avoids page animations',
        "matchMedia('(prefers-reduced-motion: reduce)').matches && document.querySelector('.settings-workspace').getAnimations({subtree:true}).filter(a=>a.playState==='running').length===0",
      );
      await check(
        name + ': save action stays in view',
        '(()=>{const e=' +
          (name === 'widget'
            ? button('Create widget')
            : button('Save changes')) +
          ';const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth})()',
      );
      await shot(name + '-light');
      if (name === 'routine') {
        const ratios = await evaluate(`(${contrast.toString()})()`);
        if (ratios.length < 3 || ratios.some((r) => r.ratio < 4.5))
          throw Error(
            'Light routine heading/error contrast ' + JSON.stringify(ratios),
          );
        checks.push({
          name: 'Routine light headings and errors meet 4.5:1',
          passed: true,
          ratios,
        });
      }
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'prefers-color-scheme', value: 'dark' },
        ],
      });
      await pause();
      await check(
        name + ': system dark theme applies',
        "document.documentElement.classList.contains('dark')",
      );
      await shot(name + '-dark');
      if (name === 'routine') {
        const ratios = await evaluate(`(${contrast.toString()})()`);
        if (ratios.length < 3 || ratios.some((r) => r.ratio < 4.5))
          throw Error(
            'Dark routine heading/error contrast ' + JSON.stringify(ratios),
          );
        checks.push({
          name: 'Routine dark headings and errors meet 4.5:1',
          passed: true,
          ratios,
        });
      }
      if (width < 768 && reflowScale === 1) {
        const save =
          name === 'widget' ? button('Create widget') : button('Save changes');
        await model(430);
        await check(
          name + ': keyboard leaves save above its top edge',
          `(()=>{const r=${save}.getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height+1})()`,
        );
        await model(430, 65);
        await check(
          name + ': keyboard pan keeps navigation and save visible',
          `(()=>{const app=document.querySelector('.app-viewport').getBoundingClientRect(),r=${save}.getBoundingClientRect();return app.top>=64&&r.bottom<=495})()`,
        );
        await shot(name + '-keyboard');
        await model(height / 2, 0, 2);
        await check(
          name + ': pinch zoom does not impose keyboard sizing',
          "!document.documentElement.style.getPropertyValue('--app-visual-viewport-height')",
        );
        await restoreModel();
        await check(
          name + ': dismissal restores full-height layout',
          "document.querySelector('.app-viewport').getBoundingClientRect().height>=innerHeight-1",
        );
      }
      await discard();
      await cdp.send('Emulation.setEmulatedMedia', {
        features: [
          { name: 'prefers-reduced-motion', value: 'reduce' },
          { name: 'prefers-color-scheme', value: 'light' },
        ],
      });
    }
    if (width < 768 && reflowScale === 1) {
      await goto('/config/routines/kitchen_day', 'name');
      await key('k', 75, 2);
      await until(
        '!!document.querySelector(\'[aria-label="Search homectl"]\')',
        'Search open',
      );
      await cdp.send('Input.insertText', { text: 'room' });
      await model(430, 40);
      await check(
        'Search dialog fits above the keyboard',
        "(()=>{const r=document.querySelector('[role=dialog]').getBoundingClientRect();return r.top>=40&&r.bottom<=470})()",
      );
      await key('End', 35);
      await check(
        'Search can reach its final result above the keyboard',
        "(()=>{const r=document.querySelector('[cmdk-item][aria-selected=true]').getBoundingClientRect(),d=document.querySelector('[role=dialog]').getBoundingClientRect();return r.top>=d.top&&r.bottom<=d.bottom})()",
      );
      await check(
        'Search footer remains visible above the keyboard',
        "(()=>{const e=[...document.querySelectorAll('[role=dialog] span')].find(e=>e.textContent.trim()==='Select to open'),r=e.getBoundingClientRect(),d=document.querySelector('[role=dialog]').getBoundingClientRect();return r.height>0&&r.bottom<=d.bottom})()",
      );
      await check(
        'Phone search input avoids text-entry auto zoom',
        'parseFloat(getComputedStyle(document.querySelector(\'[aria-label="Search homectl"]\')).fontSize)>=16',
      );
      await shot('search-keyboard');
      await key('Escape', 27);
      await restoreModel();
    }
    if (writes) throw Error('Unexpected write ' + JSON.stringify(requests));
    checks.push({
      name: 'All viewport journeys issue no writes',
      passed: true,
    });
    return {
      passed: true,
      checks,
      reflowScale,
      scope:
        'Compact density, reduced motion, both system themes; phone keyboard/pan/zoom uses an injected VisualViewport model',
    };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await evaluate(
      `for(const [key,value]of ${JSON.stringify([
        ['homectl-theme', originalTheme],
        ['homectl-density', originalDensity],
      ])}){if(value===null)localStorage.removeItem(key);else localStorage.setItem(key,value)}`,
    );
  }
}
