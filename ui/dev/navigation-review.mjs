/** Shared-shell acceptance against isolated fixtures; no configuration writes. */
import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const base = 'http://127.0.0.1:3021',
    checks = [];
  if (
    !url.startsWith(base + '/') ||
    (await fetch(base + '/api/v1/config/floorplans')).headers.get(
      'x-homectl-fixture',
    ) !== 'true'
  )
    throw Error('Isolated fixture required');
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(
        result.exceptionDetails.exception?.description ??
          result.exceptionDetails.text,
      );
    return result.result.value;
  };
  const pause = (ms = 160) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression, name) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate('Boolean(' + expression + ')')) {
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
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...p,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...p,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await pause();
  };
  const shot = async (name) => {
    const { data } = await cdp.send('Page.captureScreenshot', {
      format: 'png',
    });
    await writeFile(
      `/tmp/navigation-${width}-${name}.png`,
      Buffer.from(data, 'base64'),
    );
  };
  const desktop = width >= 1024;
  const sidebar = `document.querySelector('aside[aria-label="Application navigation"]')`;
  const nav = desktop
    ? `${sidebar}.querySelector('nav[aria-label="Primary navigation"]')`
    : `document.querySelector('[role="dialog"] nav[aria-label="Primary navigation"]')`;
  const category = desktop
    ? `${sidebar}.querySelector('nav[aria-label="Settings categories"]')`
    : `document.querySelector('[role="dialog"] nav[aria-label="Settings categories"]')`;
  const menu = async () => {
    if (desktop) return;
    await click(
      `document.querySelector('header button[aria-label="Open navigation"]')`,
    );
    await until(
      `!!document.querySelector('[role="dialog"] nav[aria-label="Primary navigation"]')`,
      'Shared phone navigation opens',
    );
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
        `!document.querySelector('[role="dialog"]')`,
        'Navigation closes after choosing a destination',
      );
  };
  const shell = async (name) => {
    await until(
      `document.documentElement.scrollWidth<=innerWidth+1&&document.querySelector('main').getBoundingClientRect().height>250`,
      name + ' fits the viewport',
    );
    if (desktop)
      await until(
        `(()=>{const el=${sidebar},nav=el.querySelector('nav[aria-label="Primary navigation"]');return el===window.__reviewSidebar&&el.getBoundingClientRect().width===window.__reviewWidth&&JSON.stringify([...nav.querySelectorAll('a')].map(a=>({text:a.textContent,to:a.getAttribute('href'),height:a.getBoundingClientRect().height})))===window.__reviewLinks})()`,
        name +
          ' keeps the same sidebar element, width and primary link positions',
      );
    else
      await until(
        `(()=>{const ns=[...document.querySelectorAll('nav[aria-label="Primary navigation"]')].filter(n=>n.getBoundingClientRect().width>0);const n=ns.find(n=>n.querySelector('a[href="/map"]'));return n&&n.querySelectorAll('a').length===4&&n.querySelector('button[aria-label="Search"]')&&document.querySelector('header button[aria-label="Open navigation"]')})()`,
        name + ' keeps the phone menu and all primary shortcuts',
      );
  };
  try {
    await cdp.send('Page.bringToFront');
    await cdp.send('Page.navigate', { url: base + '/' });
    await pause(450);
    await until(`!!document.querySelector('header')`, 'Home shell loaded');
    if (desktop)
      await evaluate(
        `window.__reviewSidebar=${sidebar};window.__reviewWidth=${sidebar}.getBoundingClientRect().width;window.__reviewLinks=JSON.stringify([...${sidebar}.querySelector('nav[aria-label="Primary navigation"]').querySelectorAll('a')].map(a=>({text:a.textContent,to:a.getAttribute('href'),height:a.getBoundingClientRect().height})))`,
      );
    await shell('Home');
    await shot('home');
    await primary('/map');
    await until(`!!document.querySelector('canvas')`, 'Map loads');
    await shell('Floorplan');
    await shot('map');
    await primary('/groups');
    await shell('Rooms');
    await primary('/config');
    await until(
      `!!document.querySelector('.settings-workspace h1')`,
      'Settings landing page is ready',
    );
    await shell('Settings');
    if (!desktop) await menu();
    await until(
      `!!${category}&&${category}.querySelectorAll('a').length===19&&[...${category}.querySelectorAll('a')].every(a=>a.querySelector('svg[aria-hidden]'))`,
      'All settings categories have consistent icons in shared navigation',
    );
    await shot('settings-menu');
    await click(`${category}.querySelector('a[href="/config/settings"]')`);
    await until(
      `location.pathname==='/config/settings'&&!document.querySelector('[role="dialog"]')`,
      'Settings category link navigates and closes menu',
    );
    await shell('App settings');
    if (!desktop) await menu();
    await click(`${category}.querySelector('a[href="/config/floorplan"]')`);
    await until(
      `location.pathname==='/config/floorplan'&&!!document.querySelector('canvas')&&!document.querySelector('[role="dialog"]')`,
      'Floorplan editor opens from the shared settings navigation',
    );
    await shell('Floorplan editor');
    await until(
      `(()=>{const c=document.querySelector('canvas').getBoundingClientRect();return c.width>230&&c.height>300&&c.bottom<=innerHeight+1})()`,
      'Editor retains a usable fixed canvas',
    );
    await shot('editor');
    if (desktop) {
      await until(
        `${category}.querySelector('a[href="/config/floorplan"]').getAttribute('aria-current')==='page'&&${nav}.querySelector('a[href="/config"]').getAttribute('aria-current')==='page'`,
        'Editor marks Settings and its Floorplan category active',
      );
      await click(
        `${sidebar}.querySelector('button[aria-label="Collapse settings categories"]')`,
      );
      await until(
        `!${category}&&${sidebar}.getBoundingClientRect().width===window.__reviewWidth`,
        'Collapsing categories retains the shared sidebar width',
      );
      await click(
        `${sidebar}.querySelector('button[aria-label="Expand settings categories"]')`,
      );
    }
    await primary('/');
    await shell('Home after editor');
    await menu();
    const search = desktop
      ? `${sidebar}.querySelector('button')`
      : `document.querySelector('[role="dialog"] button[aria-label="Search"]')`;
    await click(search);
    await until(
      `!!document.querySelector('[cmdk-input]')&&document.activeElement===document.querySelector('[cmdk-input]')`,
      'Shared Search opens the focused command palette',
    );
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'Escape',
      code: 'Escape',
      windowsVirtualKeyCode: 27,
    });
    await until(
      `!document.querySelector('[role="dialog"]')`,
      'Escape closes Search without leaving another navigation overlay',
    );
    await click(
      `document.querySelector('header button[aria-label="Enter fullscreen"]')`,
    );
    await until(
      `!document.querySelector('aside[aria-label="Application navigation"]')&&!document.querySelector('nav[aria-label="Primary navigation"]')`,
      'Fullscreen hides shared navigation',
    );
    await click(`document.querySelector('[aria-label="Exit fullscreen"]')`);
    if (desktop) {
      await until(`!!${sidebar}`, 'Sidebar returns after fullscreen');
      await evaluate(`window.__reviewSidebar=${sidebar};true`);
    }
    await shell('Leaving fullscreen');
    return { passed: true, width, checks };
  } catch (error) {
    await shot('failure');
    throw error;
  }
}
