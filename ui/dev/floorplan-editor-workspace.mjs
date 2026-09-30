/** Native browser acceptance against the isolated development fixture only. */
import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  if (!url.startsWith('http://127.0.0.1:3021/config/floorplan'))
    throw Error('Use the isolated fixture UI on :3021.');
  const checks = [];
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression: `(async()=>(${expression}))()`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
    return r.result.value;
  };
  const pause = () => new Promise((r) => setTimeout(r, 130));
  const until = async (expression, message) => {
    for (let n = 0; n < 80; n++) {
      if (await evaluate(expression)) return;
      await pause();
    }
    throw Error(message);
  };
  const check = async (name, expression) => {
    const passed = !!(await evaluate(expression));
    checks.push({ name, passed });
    if (!passed) throw Error(name);
  };
  const click = async (label) => {
    await evaluate(
      `document.querySelector('[aria-label=${JSON.stringify(label)}]')?.click()`,
    );
    await pause();
  };
  const button = async (text) => {
    await evaluate(
      `[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(text)})?.click()`,
    );
    await pause();
  };
  const saved = () =>
    evaluate(
      "fetch('/api/v1/config/floorplans/ground_floor/editor').then(r=>r.json()).then(r=>r.data)",
    );
  if (
    (await evaluate(
      "fetch('/api/v1/config/floorplans/ground_floor/editor').then(r=>r.headers.get('x-homectl-fixture'))",
    )) !== 'true'
  )
    throw Error('Fixture marker missing.');
  await until('!!document.querySelector("canvas")', 'Editor loaded');
  const original = await saved();
  const dirty =
    'document.querySelector(".settings-savebar").dataset.dirty==="true"';
  const input = async (label, value) => {
    await evaluate(
      `(()=>{const el=document.querySelector('[aria-label=${JSON.stringify(label)}]');el.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(String(value))});el.dispatchEvent(new Event('input',{bubbles:true}));el.blur()})()`,
    );
    await pause();
  };
  const world = async (x, y) =>
    evaluate(
      `(()=>{const el=document.querySelector('canvas'),r=el.getBoundingClientRect(),d=el.dataset;return{x:r.x+Number(d.viewX)+(${x}+.5)*Number(d.tileWidth)*Number(d.zoom),y:r.y+Number(d.viewY)+(${y}+.5)*Number(d.tileHeight)*Number(d.zoom)}})()`,
    );
  const drag = async (
    start,
    end,
    { button = 'left', cancel = false, modifiers = 0 } = {},
  ) => {
    if (width < 900 && button === 'left') {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ ...start, id: 1 }],
      });
      await pause();
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...end, id: 1 }],
      });
      await pause();
      await cdp.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...start,
        button,
        buttons: button === 'middle' ? 4 : 1,
        clickCount: 1,
        modifiers,
      });
      await pause();
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        ...end,
        button,
        buttons: button === 'middle' ? 4 : 1,
        modifiers,
      });
      await pause();
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        ...end,
        button,
        buttons: 0,
        clickCount: 1,
        modifiers,
      });
    }
    await pause();
  };
  await check(
    'Fixed document, crisp canvas and no document overflow',
    'document.body.scrollHeight===innerHeight&&document.body.scrollWidth===innerWidth&&document.querySelector("canvas").width===Math.round(document.querySelector("canvas").getBoundingClientRect().width*devicePixelRatio)',
  );
  await click('Walls tool');
  if (width < 900) await click('Close library');
  const shortcut = async (key) => {
    await evaluate('document.querySelector("canvas").focus()');
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: 'Key' + key.toUpperCase(),
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code: 'Key' + key.toUpperCase(),
    });
    await pause();
  };
  await shortcut('f');
  await check(
    'F switches brush to rectangle without editing the document',
    `document.querySelector('[aria-label="Rectangle"]').getAttribute('aria-pressed')==='true'&&!(${dirty})`,
  );
  await shortcut('f');
  await check(
    'F switches rectangle back to brush',
    `document.querySelector('[aria-label="Brush"]').getAttribute('aria-pressed')==='true'`,
  );
  await shortcut('e');
  await check(
    'E enables tile erasing with a distinct eraser cursor',
    `document.querySelector('.fp-stage').dataset.tool==='erase'&&getComputedStyle(document.querySelector('canvas')).cursor.startsWith('url(')`,
  );
  await shortcut('e');
  await check(
    'E restores Walls painting and its normal cursor',
    `document.querySelector('.fp-stage').dataset.tool==='walls'&&getComputedStyle(document.querySelector('canvas')).cursor==='crosshair'`,
  );
  if (width < 900) await click('Close library');
  const rect = await world(5, 4);
  const scale = await evaluate(
    'Number(document.querySelector("canvas").dataset.zoom)',
  );
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    ...rect,
    deltaX: 0,
    deltaY: -120,
  });
  await pause();
  await check(
    'Wheel zoom changes the transform without dirtying the draft',
    `Number(document.querySelector('canvas').dataset.zoom)>${scale}&&!(${dirty})`,
  );
  const panPoint = await world(5, 4),
    beforePan = await evaluate(
      'Number(document.querySelector("canvas").dataset.viewX)',
    );
  await drag(
    panPoint,
    { x: panPoint.x + 35, y: panPoint.y + 15 },
    { button: 'middle' },
  );
  await check(
    'Middle-drag pans even in Walls mode without painting',
    `Number(document.querySelector('canvas').dataset.viewX)>${beforePan}&&!(${dirty})`,
  );
  await click('Fit entire floorplan');
  const paintStart = await world(4, 3),
    paintEnd = await world(6, 4);
  await drag(paintStart, paintEnd);
  await check('A mouse or touch stroke edits only the draft', dirty);
  await check(
    'Drawing leaves the saved revision untouched',
    `(await fetch('/api/v1/config/floorplans/ground_floor/editor').then(r=>r.json())).data.revision_token===${JSON.stringify(original.revision_token)}`,
  );
  await click('Undo');
  await check('One Undo reverses the complete stroke', `!(${dirty})`);
  await click('Redo');
  await check('Redo restores the stroke', dirty);
  await button('Discard');
  await check('Discard restores the saved document', `!(${dirty})`);
  await evaluate('document.querySelector("canvas").focus()');
  for (const key of ['ArrowRight', 'ArrowDown', 'Enter']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
    await pause();
  }
  await check(
    'Keyboard tile navigation and Enter edit the focused tile',
    dirty,
  );
  await click('Undo');
  await check('Keyboard painting participates in draft Undo', `!(${dirty})`);
  await click('Devices tool');
  await evaluate("document.querySelector('.fp-entity').click()");
  await pause();
  await check(
    'Unplaced catalog entry arms canvas placement',
    '!!document.querySelector(".fp-pending")',
  );
  const place = await world(7.38, 5.12);
  await drag(place, place);
  await check(
    'Canvas placement opens the position inspector',
    `!!document.querySelector('[aria-label="Placement X"]')`,
  );
  await check(
    'New device placement defaults to quarter-grid snapping',
    `document.querySelector('[aria-label="Placement X"]').value==='7.5'&&document.querySelector('[aria-label="Placement Y"]').value==='5'`,
  );
  const setSnap = async (label) => {
    await click('Device snapping');
    await evaluate(
      `[...document.querySelectorAll('[role="option"]')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).click()`,
    );
    await pause();
  };
  await setSnap('Grid');
  await button('Snap to grid');
  await check(
    'Inspector snaps an existing placement to the selected whole grid',
    `document.querySelector('[aria-label="Placement X"]').value==='8'&&document.querySelector('[aria-label="Placement Y"]').value==='5'`,
  );
  await click('Undo');
  await setSnap('¼ grid');
  await input('Placement X', 7.38);
  await input('Placement Y', 5.12);
  await button('Snap to ¼ grid');
  await check(
    'Quarter-grid control snaps exact typed coordinates',
    `document.querySelector('[aria-label="Placement X"]').value==='7.5'&&document.querySelector('[aria-label="Placement Y"]').value==='5'`,
  );
  await click('Undo');
  const snapShot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(
    `/tmp/homectl-floorplan-snap-${width}.png`,
    Buffer.from(snapShot.data, 'base64'),
  );
  await setSnap('Grid');
  const expectPosition = async (x, y, message) =>
    check(
      message,
      `Math.abs(Number(document.querySelector('[aria-label="Placement X"]').value)-${x})<.002&&Math.abs(Number(document.querySelector('[aria-label="Placement Y"]').value)-${y})<.002`,
    );
  const movePlacement = async (modifiers = 0) => {
    if (width < 900) await click('Close properties');
    await click('Fit entire floorplan');
    await drag(await world(7.38, 5.12), await world(9.38, 6.12), { modifiers });
  };
  await movePlacement();
  await expectPosition(9, 6, 'Dragging respects whole-grid snapping');
  await click('Undo');
  if (width >= 900) {
    await movePlacement(1);
    await expectPosition(
      9.38,
      6.12,
      'Alt bypasses snapping during a device drag',
    );
    await click('Undo');
    await movePlacement(8);
    await expectPosition(
      9.5,
      6,
      'Shift uses quarter-grid precision while whole-grid mode stays selected',
    );
    await click('Undo');
  }
  await setSnap('Free');
  await movePlacement();
  await expectPosition(
    9.38,
    6.12,
    'Free mode supports precise placement on desktop and touch',
  );
  await click('Undo');
  await input('Placement X', 7.3);
  await check('Fractional coordinate editing stays unsaved', dirty);
  await button('Save');
  await until(`!(${dirty})`, 'Placement saved');
  const placed = JSON.parse((await saved()).grid_data);
  await check(
    'Placement save preserves unknown grid extensions',
    `JSON.stringify((await fetch('/api/v1/config/floorplans/ground_floor/editor').then(r=>r.json()).then(r=>JSON.parse(r.data.grid_data))).future)===${JSON.stringify(JSON.stringify(JSON.parse(original.grid_data).future))}`,
  );
  if (!placed.devices.some((d) => d.x === 7.3))
    throw Error('Fractional position lost');
  checks.push({
    name: 'Fractional coordinates survive the API round trip',
    passed: true,
  });
  if (width < 900) await click('Close properties');
  await click('Rooms tool');
  if (width < 900) await click('Close library');
  await shortcut('e');
  await check(
    'E erases room areas without switching into tile erasing',
    `document.querySelector('.fp-stage').dataset.tool==='rooms'&&document.querySelector('.fp-stage').dataset.erasing==='true'&&getComputedStyle(document.querySelector('canvas')).cursor.startsWith('url(')`,
  );
  await shortcut('e');
  await check(
    'E restores room painting without changing mode',
    `document.querySelector('.fp-stage').dataset.tool==='rooms'&&document.querySelector('.fp-stage').dataset.erasing==='false'`,
  );
  await click('Brush');
  const roomStart = await world(4, 5);
  await drag(roomStart, { x: roomStart.x + 15, y: roomStart.y + 10 });
  await check('Room mask painting edits the draft', dirty);
  await click('Undo');
  await check('Room mask stroke is one undo step', `!(${dirty})`);
  if (width < 900) {
    await click('Walls tool');
    await click('Close library');
    const scaleBeforePinch = await evaluate(
      'Number(document.querySelector("canvas").dataset.zoom)',
    );
    const a = await world(4, 3),
      b = { x: a.x + 70, y: a.y + 40 };
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...a, id: 1 }],
    });
    await pause();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { ...a, id: 1 },
        { ...b, id: 2 },
      ],
    });
    await pause();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: a.x - 25, y: a.y - 10, id: 1 },
        { x: b.x + 25, y: b.y + 10, id: 2 },
      ],
    });
    await pause();
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
    await pause();
    await check(
      'Two-finger pinch changes zoom',
      `Number(document.querySelector('canvas').dataset.zoom)>${scaleBeforePinch}`,
    );
    await check(
      'A second finger cancels painting before pinch navigation',
      `!(${dirty})`,
    );
  }
  await click('Layout tool');
  await button('Resize…');
  await input('Grid width', 14);
  await input('Grid height', 10);
  await button('Apply resize');
  await check('Reviewed resize edits draft only', dirty);
  await button('Discard');
  await check(
    'Discard restores pre-resize dimensions',
    `document.querySelector('.fp-canvas-title').textContent.includes('${placed.width} × ${placed.height}')`,
  );
  await click('Layout tool');
  await evaluate(
    "(()=>{const input=document.querySelector('#floorplan-name');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'Draft name');input.dispatchEvent(new Event('input',{bubbles:true}));input.blur()})()",
  );
  await pause();
  // Change the isolated server independently to exercise the same revision conflict as production.
  await evaluate(
    "(async()=>{const endpoint='/api/v1/config/floorplans/ground_floor/editor';const row=(await(await fetch(endpoint)).json()).data;await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...row,name:'Changed elsewhere',expected:row.revision_token})});})()",
  );
  await button('Save');
  await until(
    "document.querySelector('.settings-savebar').textContent.includes('Review changes')",
    'Conflict retained',
  );
  await check('Conflicting save keeps the draft and exposes review', dirty);
  await button('Review changes');
  await button('Use latest saved');
  await check('Conflict review can adopt the saved document', `!(${dirty})`);
  // Restore only our isolated fixture document and reload for the next capture.
  await evaluate(
    `(async()=>{const endpoint='/api/v1/config/floorplans/ground_floor/editor';const current=(await(await fetch(endpoint)).json()).data;await fetch(endpoint,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...${JSON.stringify(original)},image:current.image,expected:current.revision_token})});})()`,
  );
  return { passed: checks.every((c) => c.passed), checks };
}
