export default async function (cdp, { width, url }) {
  if (!url.startsWith('http://127.0.0.1:3021/config/floorplan'))
    throw Error('Use isolated fixture.');
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
    return r.result.value;
  };
  if (
    (await evaluate(
      "fetch('/api/v1/config/floorplans/ground_floor/editor').then(r=>r.headers.get('x-homectl-fixture'))",
    )) !== 'true'
  )
    throw Error('Fixture marker missing.');
  const pause = () => new Promise((r) => setTimeout(r, 200));
  const rect = await evaluate(
    `(()=>{const canvas=document.querySelector('canvas');canvas.scrollIntoView({block:'center'});const r=canvas.getBoundingClientRect();return {x:r.x+r.width*0.3,y:r.y+r.height*0.6}})()`,
  );
  const before = await evaluate(
    "fetch('/api/v1/config/floorplans/ground_floor/editor').then(r=>r.json()).then(r=>r.data.revision_token)",
  );
  const dirty = () =>
    evaluate(
      "[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='Save changes')",
    );
  const move = async (cancel = false) => {
    if (width < 700) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [rect],
      });
      await pause();
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: rect.x + 25, y: rect.y + 10 }],
      });
      await pause();
      await cdp.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        ...rect,
        button: 'left',
        clickCount: 1,
      });
      await pause();
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rect.x + 25,
        y: rect.y + 10,
        button: 'left',
        buttons: 1,
      });
      await pause();
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: rect.x + 25,
        y: rect.y + 10,
        button: 'left',
        clickCount: 1,
      });
    }
    await pause();
  };
  const checks = [];
  if (width < 700) {
    await move(true);
    if (await dirty()) throw Error('Canceling touch changed the draft.');
    checks.push('Native touch cancellation restores the original layout');
  }
  await move();
  if (!(await dirty())) throw Error('Native drawing did not stage a change.');
  if (
    (await evaluate(
      "fetch('/api/v1/config/floorplans/ground_floor/editor').then(r=>r.json()).then(r=>r.data.revision_token)",
    )) !== before
  )
    throw Error('Drawing saved implicitly.');
  checks.push('Native drawing stages layout changes without saving');
  await evaluate(
    "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Discard').click()",
  );
  await pause();
  if (await dirty()) throw Error('Discard did not restore layout.');
  checks.push('Discard restores native drawing changes');
  await evaluate(
    "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Window').click();document.querySelector('canvas').focus()",
  );
  await pause();
  for (const key of ['ArrowRight', 'ArrowDown', 'Enter']) {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code: key,
    });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key });
    await pause();
  }
  if (!(await dirty()))
    throw Error('Keyboard did not apply the selected tool.');
  checks.push('Native keyboard input paints using the selected tool');
  await evaluate(
    "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Discard').click()",
  );
  await pause();
  await evaluate(
    "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Zoom in').click()",
  );
  await pause();
  await evaluate(
    "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Pan canvas').click()",
  );
  const panAt = await evaluate(
    "(()=>{const viewport=document.querySelector('canvas').parentElement;viewport.scrollIntoView({block:'center'});const r=viewport.getBoundingClientRect();return {x:r.x+r.width*.7,y:Math.max(100,r.y+Math.min(r.height*.5,250))}})()",
  );
  if (width < 700) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [panAt],
    });
    for (let n = 1; n <= 5; n++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: panAt.x - n * 15, y: panAt.y }],
      });
      await pause();
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } else {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      ...panAt,
      button: 'left',
      clickCount: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: panAt.x - 75,
      y: panAt.y,
      button: 'left',
      buttons: 1,
    });
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x: panAt.x - 75,
      y: panAt.y,
      button: 'left',
      clickCount: 1,
    });
  }
  await pause();
  if (await dirty()) throw Error('Panning changed the layout.');
  if (
    !(await evaluate(
      "document.querySelector('canvas').parentElement.scrollLeft > 10",
    ))
  )
    throw Error('Pan gesture did not move the zoomed viewport.');
  if (!(await evaluate('document.documentElement.scrollWidth <= innerWidth')))
    throw Error('Zoomed canvas overflowed the page.');
  checks.push(
    'Zoom and native panning move only the viewport without page overflow',
  );
  return { passed: true, checks };
}
