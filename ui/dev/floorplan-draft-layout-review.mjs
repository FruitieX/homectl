/** Fixed-canvas draft transitions; isolated fixtures, no server writes. */
import { writeFile } from 'node:fs/promises';

export default async function (cdp, { width, url }) {
  const base = 'http://127.0.0.1:3021',
    checks = [];
  if (url !== base + '/config/floorplan')
    throw Error(
      'Open the implicit first floorplan on the isolated fixture UI.',
    );
  const response = await fetch(base + '/api/v1/config/floorplans');
  if (response.headers.get('x-homectl-fixture') !== 'true')
    throw Error('Fixture marker missing.');
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const pause = () => new Promise((resolve) => setTimeout(resolve, 160));
  const check = async (name, expression) => {
    for (let i = 0; i < 60; i++) {
      if (await evaluate('Boolean(' + expression + ')')) {
        checks.push(name);
        return;
      }
      await pause();
    }
    throw Error(name);
  };
  const click = async (selector) => {
    const point = await evaluate(
      `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...point,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      ...point,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    });
    await pause();
  };
  const measure = `(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect();return JSON.stringify({x:r.x,y:r.y,width:r.width,height:r.height,zoom:c.dataset.zoom,viewX:c.dataset.viewX,viewY:c.dataset.viewY})})()`;
  const stable = (baseline) => `${measure}===${JSON.stringify(baseline)}`;
  const dirty = `document.querySelector('.settings-savebar')?.dataset.dirty==='true'`;
  const banner = `document.querySelector('[aria-label="Retained drafts"]')`;
  const menu = '[aria-label="Document menu"]';
  const unchanged = await evaluate(
    `fetch('/api/v1/config/floorplans').then(r=>r.json()).then(JSON.stringify)`,
  );
  await check(
    'Implicit first floorplan loads',
    `document.querySelector('canvas')`,
  );
  await pause();
  await click('[aria-label="Walls tool"]');
  if (width < 900) await click('[aria-label="Close library"]');
  await click('[aria-label="Fit entire floorplan"]');
  const before = await evaluate(measure);
  const point = await evaluate(
    `(()=>{const c=document.querySelector('canvas'),r=c.getBoundingClientRect(),d=c.dataset;return{x:r.x+Number(d.viewX)+4.5*Number(d.tileWidth)*Number(d.zoom),y:r.y+Number(d.viewY)+3.5*Number(d.tileHeight)*Number(d.zoom)}})()`,
  );
  const pointer = async (phase, p = point) => {
    if (width < 900) {
      await cdp.send('Input.dispatchTouchEvent', {
        type:
          phase === 'down'
            ? 'touchStart'
            : phase === 'move'
              ? 'touchMove'
              : 'touchEnd',
        touchPoints: phase === 'up' ? [] : [{ ...p, id: 1 }],
      });
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type:
          phase === 'down'
            ? 'mousePressed'
            : phase === 'move'
              ? 'mouseMoved'
              : 'mouseReleased',
        ...p,
        button: 'left',
        buttons: phase === 'up' ? 0 : 1,
        clickCount: 1,
      });
    }
    await pause();
  };
  await pointer('down');
  await check('First paint marks the document dirty', dirty);
  await check(
    'First paint keeps canvas bounds, pan and zoom unchanged',
    stable(before),
  );
  await pointer('move', { x: point.x + 18, y: point.y + 12 });
  await check('Continuing stroke keeps the canvas fixed', stable(before));
  await pointer('up');
  const afterStroke = await evaluate(measure);
  await check(
    'No retained-draft banner is inserted above the editor',
    `!${banner}`,
  );
  await click(menu);
  await check(
    'Active implicit floorplan is excluded from other drafts',
    `!document.querySelector('[role="menu"]').textContent.includes('Unsaved drafts')`,
  );
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape' });
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape' });
  await click('[aria-label="Undo"]');
  await check(
    'Undo clears the dirty status without moving the canvas',
    `!(${dirty})&&(${stable(before)})`,
  );
  await click('[aria-label="Redo"]');
  await check(
    'Redo restores the draft without moving the canvas',
    `${dirty}&&(${stable(before)})`,
  );
  await click(menu);
  await click('[role="menu"] a[href="/config/floorplan?new=1"]');
  await check(
    'New document opens',
    `location.search==='?new=1'&&document.querySelector('#floorplan-name')`,
  );
  await evaluate(
    `(()=>{const e=document.querySelector('#floorplan-name');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'Layout review');e.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
  await pause();
  const newBounds = await evaluate(measure);
  await click(menu);
  await check(
    'Other floorplan draft is available in the document menu',
    `document.querySelector('[role="menu"] a[href^="/config/floorplan?id="]')`,
  );
  await click('[role="menu"] a[href^="/config/floorplan?id="]');
  await check(
    'Reopening the retained floorplan restores its edits',
    `${dirty}&&location.search.startsWith('?id=')`,
  );
  await click(menu);
  await check(
    'New document draft is available without adding a banner',
    `!${banner}&&document.querySelector('[role="menu"] a[href="/config/floorplan?new=1"]')`,
  );
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    `/tmp/floorplan-draft-layout-${width}.png`,
    Buffer.from(shot.data, 'base64'),
  );
  await click('[role="menu"] a[href="/config/floorplan?new=1"]');
  await check(
    'New document draft is retained and its canvas size is stable',
    `document.querySelector('#floorplan-name').value==='Layout review'&&(${stable(newBounds)})`,
  );
  await click(menu);
  await click('[role="menu"] a[href="/map"]');
  if (width < 1024) await click('[aria-label="Open navigation"]');
  await click(
    `${width < 1024 ? '[role="dialog"] ' : ''}[aria-label="Primary navigation"] a[href="/config"]`,
  );
  await check('Other settings pages retain the existing draft banner', banner);
  await check(
    'Browser checks made no configuration writes',
    `fetch('/api/v1/config/floorplans').then(r=>r.json()).then(v=>JSON.stringify(v)===${JSON.stringify(unchanged)})`,
  );
  return {
    width,
    checks,
    canvasBefore: JSON.parse(before),
    canvasAfterStroke: JSON.parse(afterStroke),
    newDocumentCanvas: JSON.parse(newBounds),
  };
}
