/** Compact rail acceptance against isolated fixtures; no API writes. */
import { writeFile } from 'node:fs/promises';
import { configSections } from '../app/config/sections.ts';
export default async function (cdp, { width, url }) {
  const base = 'http://127.0.0.1:3021',
    checks = [],
    desktop = width >= 1024;
  if (
    !url.startsWith(base + '/') ||
    (await fetch(base + '/api/v1/config/floorplans')).headers.get(
      'x-homectl-fixture',
    ) !== 'true'
  )
    throw Error('Isolated fixture required');
  let writes = 0;
  cdp.on('Network.requestWillBeSent', ({ request }) => {
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) writes++;
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
  const pause = (ms = 160) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression, name) => {
    for (let i = 0; i < 65; i++) {
      if (await evaluate(`Boolean(${expression})`)) {
        checks.push(name);
        return;
      }
      await pause();
    }
    throw Error(name);
  };
  const click = async (expression) => {
    const p = await evaluate(
      `(()=>{const e=${expression};if(!e)throw Error('Missing target');e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        ...p,
        button: 'left',
        buttons: type === 'mousePressed' ? 1 : 0,
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
  const shot = async (name) => {
    await pause(200);
    const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      `/tmp/compact-rail-${width}-${name}.png`,
      Buffer.from(r.data, 'base64'),
    );
  };
  const rail = `document.querySelector('.app-navigation-rail')`,
    panel = `document.querySelector('[aria-label="Settings panel"]')`,
    drawer = `document.querySelector('[role="dialog"]')`;
  const nav = desktop
    ? `${rail}.querySelector('nav[aria-label="Primary navigation"]')`
    : `${drawer}.querySelector('nav[aria-label="Primary navigation"]')`;
  const categories = desktop
    ? `${panel}.querySelector('nav[aria-label="Settings categories"]')`
    : `${drawer}.querySelector('nav[aria-label="Settings categories"]')`;
  const menu = async () => {
    if (!desktop) {
      await click(
        `document.querySelector('header button[aria-label="Open navigation"]')`,
      );
      await until(
        `!!${drawer}.querySelector('nav[aria-label="Primary navigation"]')`,
        'Phone navigation opens',
      );
    }
  };
  const primary = async (href) => {
    await menu();
    await click(`${nav}.querySelector('a[href="${href}"]')`);
    await until(
      `location.pathname===${JSON.stringify(href)}`,
      'Primary navigation opens ' + href,
    );
    if (!desktop)
      await until(
        `!${drawer}`,
        'Choosing a destination closes the phone drawer',
      );
  };
  const shell = async (name) => {
    await until(
      'document.documentElement.scrollWidth<=innerWidth+1',
      name + ' has no horizontal overflow',
    );
    if (desktop)
      await until(
        `(()=>{const r=${rail};return r===window.__rail&&r.getBoundingClientRect().width===76&&JSON.stringify([...r.querySelectorAll('.app-rail-link')].map(a=>({text:a.textContent,y:a.getBoundingClientRect().y,height:a.getBoundingClientRect().height})))===window.__railPositions})()`,
        name + ' keeps the same 76 px rail and link positions',
      );
    else
      await until(
        `!!document.querySelector('header button[aria-label="Open navigation"]')&&[...document.querySelectorAll('nav[aria-label="Primary navigation"]')].some(n=>n.getBoundingClientRect().width>0&&n.querySelector('button[aria-label="Search"]'))`,
        name + ' keeps the phone menu and bottom shortcuts',
      );
  };
  const prefs = await evaluate(
    `Object.fromEntries(['homectl-theme','homectl-density','homectl-accent','fullscreen'].map(k=>[k,localStorage.getItem(k)]))`,
  );
  await evaluate(
    `localStorage.setItem('homectl-theme','"light"');localStorage.setItem('homectl-density','"compact"');localStorage.setItem('homectl-accent','"emerald"');localStorage.setItem('fullscreen','false')`,
  );
  try {
    await cdp.send('Page.navigate', { url: base + '/' });
    await until(
      desktop
        ? `!!${rail}`
        : `!!document.querySelector('header button[aria-label="Open navigation"]')`,
      'Home navigation loaded',
    );
    if (desktop)
      await evaluate(
        `window.__rail=${rail};window.__railPositions=JSON.stringify([...${rail}.querySelectorAll('.app-rail-link')].map(a=>({text:a.textContent,y:a.getBoundingClientRect().y,height:a.getBoundingClientRect().height})))`,
      );
    await shell('Home');
    await until(`!${panel}`, 'Settings panel is absent outside configuration');
    await shot('home');
    await primary('/map');
    await until("!!document.querySelector('canvas')", 'Floorplan loads');
    await shell('Floorplan');
    if (!desktop)
      await until(
        `(()=>{const a=document.getElementById('floorplan-tabs').getBoundingClientRect(),b=document.querySelector('[aria-label="Ask AI"]').getBoundingClientRect();return Math.abs(a.top-b.top)<8&&a.right<=b.left+1})()`,
        'Floorplan tabs stay beside the assistant in the phone AppBar',
      );
    await shot('map');
    await primary('/config');
    await until(
      `!!document.querySelector('.settings-workspace h1')`,
      'Settings landing opens',
    );
    await shell('Settings');
    if (desktop)
      await until(
        `${panel}&&${panel}.getBoundingClientRect().width===248&&${rail}.querySelector('a[href="/config"]').getAttribute('aria-expanded')==='true'`,
        'Entering Settings opens its 248 px panel',
      );
    else await menu();
    await until(
      `${categories}.querySelectorAll('a').length===${configSections.length + 1}&&[...${categories}.querySelectorAll('a')].every(a=>a.querySelector('svg[aria-hidden]'))`,
      'All settings sections and Overview have consistent icons',
    );
    await until(
      `${categories}.querySelectorAll('[aria-current="page"]').length===1`,
      'Only the selected category is marked current in its catalog',
    );
    if (!desktop) {
      await until(
        `[...${categories}.querySelectorAll('a')].every(a=>a.getBoundingClientRect().height>=44)`,
        'Every phone category has a 44 px touch target',
      );
      await shot('settings-top');
      await click(
        `${drawer}.querySelector('[aria-label="Jump to Maintenance"]')`,
      );
      await pause(500);
      await until(
        `${categories}.scrollTop>0`,
        'Phone shortcut reaches Maintenance',
      );
    }
    await shot('settings');
    await click(`${categories}.querySelector('a[href="/config/logs"]')`);
    await until("location.pathname==='/config/logs'", 'Category opens Logs');
    if (!desktop) {
      await until(`!${drawer}`, 'Category selection dismisses the drawer');
      await menu();
      await until(
        `(()=>{const c=${categories},a=c.querySelector('a[aria-current="page"]'),r=a.getBoundingClientRect(),b=c.getBoundingClientRect();return r.top>=b.top-1&&r.bottom<=b.bottom+1})()`,
        'Reopening reveals the current category',
      );
    }
    await click(`${categories}.querySelector('a[href="/config/routines"]')`);
    await until(
      "location.pathname==='/config/routines'",
      'Routines opens from the same catalog',
    );
    const routines = (
      await (await fetch(base + '/api/v1/config/routines')).json()
    ).data;
    const routine = routines.find((r) => r.semantics_version === 2);
    await until(
      `!!document.querySelector('a[href="/config/routines/${encodeURIComponent(routine.id)}"]')`,
      'Routines list finishes loading',
    );
    await click(
      `document.querySelector('a[href="/config/routines/${encodeURIComponent(routine.id)}"]')`,
    );
    await until(
      `location.pathname==='/config/routines/${routine.id}'`,
      'Routine detail opens',
    );
    await shot('routine');
    if (desktop) {
      const path = await evaluate('location.pathname');
      await click(
        `document.querySelector('[aria-label="Close settings panel"]')`,
      );
      await until(
        `!${panel}&&location.pathname===${JSON.stringify(path)}&&document.activeElement===${rail}.querySelector('a[href="/config"]')`,
        'Close collapses the panel without navigating and returns focus to Settings',
      );
      await shell('Collapsed routine editor');
      await shot('routine-closed');
      await click(`${rail}.querySelector('a[href="/config"]')`);
      await until(
        `!!${panel}&&location.pathname===${JSON.stringify(path)}`,
        'Settings on a settings page reopens its panel without changing the page',
      );
      await click(`${categories}.querySelector('a[href="/config/floorplan"]')`);
      await until(
        "location.pathname==='/config/floorplan'&&!!document.querySelector('canvas')",
        'Floorplan editor opens from settings',
      );
      await shell('Floorplan editor');
      await until(
        `(()=>{const c=document.querySelector('canvas').getBoundingClientRect();return c.width>230&&c.height>300&&c.bottom<=innerHeight+1})()`,
        'Editor keeps a usable fixed canvas with the settings panel open',
      );
      await shot('editor');
      await click(`${categories}.querySelector('a[href="/config/floorplan"]')`);
      await key('Escape', 27);
      await until(`!${panel}`, 'Escape within the settings panel collapses it');
      await click(`${rail}.querySelector('a[href="/config"]')`);
    } else {
      await menu();
      await click(`${categories}.querySelector('a[href="/config/floorplan"]')`);
      await until(
        "location.pathname==='/config/floorplan'&&!!document.querySelector('canvas')",
        'Phone editor opens from settings',
      );
      await shot('editor');
    }
    const history = await cdp.send('Page.getNavigationHistory'),
      entry = history.entries[history.currentIndex].id;
    await primary('/');
    await shell('Home after settings');
    await until(`!${panel}`, 'Leaving settings always removes its panel');
    await cdp.send('Page.navigateToHistoryEntry', { entryId: entry });
    await until(
      "location.pathname==='/config/floorplan'",
      'Back returns to the settings editor',
    );
    if (desktop)
      await until(`!!${panel}`, 'Back from another area reopens settings');
    await primary('/map');
    await until(`!${panel}`, 'Floorplan never retains a settings panel');
    await primary('/config');
    await until(
      "location.pathname==='/config'",
      'Settings from another page always goes to its landing page',
    );
    if (desktop) {
      await until(
        `!!${panel}`,
        'Settings reopens after previously being collapsed',
      );
      await evaluate(`document.documentElement.style.fontSize='32px'`);
      await pause(200);
      await until(
        `(()=>{const links=[...${categories}.querySelectorAll('a')];return links.every(a=>{const r=a.getBoundingClientRect(),t=a.querySelector('span').getBoundingClientRect();return t.right<=r.right+1})})()`,
        'Settings labels wrap inside the panel at enlarged text size',
      );
      await evaluate(`document.documentElement.style.fontSize=''`);
      await click(
        `document.querySelector('[aria-label="Close settings panel"]')`,
      );
      await click(`${rail}.querySelector('[aria-label="Search"]')`);
    } else {
      await menu();
      await click(`${drawer}.querySelector('[aria-label="Search"]')`);
    }
    await until(
      `document.querySelector('[cmdk-input]')&&document.activeElement===document.querySelector('[cmdk-input]')`,
      'Search opens the focused command palette',
    );
    await key('Escape', 27);
    await until(
      `!${drawer}`,
      'Escape closes Search without leaving a navigation dialog',
    );
    await primary('/');
    await click(
      `document.querySelector('header button[aria-label="Enter fullscreen"]')`,
    );
    await until(
      `!document.querySelector('aside[aria-label="Application navigation"]')&&!document.querySelector('nav[aria-label="Primary navigation"]')`,
      'Fullscreen hides application navigation',
    );
    await click(`document.querySelector('[aria-label="Exit fullscreen"]')`);
    await until(
      desktop
        ? `!!${rail}`
        : `!!document.querySelector('header button[aria-label="Open navigation"]')`,
      'Navigation returns after fullscreen',
    );
    await primary('/config');
    if (!desktop) await menu();
    await evaluate(`document.documentElement.classList.add('dark')`);
    await shot('dark');
    if (writes) throw Error('Navigation made API writes: ' + writes);
    checks.push('Navigation performs no configuration or device writes');
    return { passed: true, width, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  } finally {
    await evaluate(
      `for(const [k,v]of Object.entries(${JSON.stringify(prefs)})){if(v===null)localStorage.removeItem(k);else localStorage.setItem(k,v)};document.documentElement.style.fontSize=''`,
    );
  }
}
