/** Local interaction study only. No API, websocket or physical device writes. */
export default async function (cdp, { width, url }) {
  if (!url.startsWith('http://127.0.0.1:3024/quick-adjust-study.html'))
    throw Error('Local mockup required');
  const checks = [];
  const pause = (ms = 180) => new Promise((resolve) => setTimeout(resolve, ms));
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
  const pointer = (type, p) =>
    width < 700
      ? cdp.send('Input.dispatchTouchEvent', {
          type: { down: 'touchStart', move: 'touchMove', up: 'touchEnd' }[type],
          touchPoints: type === 'up' ? [] : [{ ...p, id: 1 }],
        })
      : cdp.send('Input.dispatchMouseEvent', {
          type: {
            down: 'mousePressed',
            move: 'mouseMoved',
            up: 'mouseReleased',
          }[type],
          ...p,
          button: 'left',
          buttons: type === 'up' ? 0 : 1,
          clickCount: 1,
        });
  for (const kind of ['moat', 'tabs', 'rail']) {
    const ref = `window.quickAdjustStudy.concepts.find(concept=>concept.kind==='${kind}')`;
    await evaluate(`location.hash='${kind}'`);
    await pause();
    await evaluate(`${ref}.stage.scrollIntoView({block:'center'})`);
    await pause();
    const center = await evaluate(`${ref}.center()`);
    const position = async (selector) =>
      evaluate(
        `(()=>{const r=${ref}.stage.querySelector('${selector}').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,left:r.left,right:r.right}})()`,
      );
    const state = async () => {
      // Touch dispatch is delivered through Chromium's compositor; allow its
      // pointermove to reach the page before reading the resulting values.
      await pause(50);
      return evaluate(`({h:${ref}.h,s:${ref}.s,b:${ref}.b,mode:${ref}.mode})`);
    };
    const color = { x: center.x + 70, y: center.y };
    await pointer('down', color);
    await pointer('move', { x: center.x + 78, y: center.y });
    const afterColor = await state();
    if (afterColor.h !== 90 || afterColor.b !== 62)
      throw Error(kind + ' color gesture changed brightness');
    checks.push(kind + ': initial color movement preserves brightness');
    await pointer('move', { x: center.x - 119, y: center.y });
    await pause(80);
    if ((await state()).mode !== 'color' || (await state()).b !== 62)
      throw Error(kind + ' ordinary crossing switched controls');
    checks.push(kind + ': ordinary edge crossing does not switch control');
    await pointer('move', color);
    let brightnessPoint;
    if (kind === 'moat') {
      brightnessPoint = { x: center.x + 119, y: center.y };
      await pointer('move', brightnessPoint);
      await pause(400);
    } else if (kind === 'tabs') {
      brightnessPoint = await position('[data-mode-button="brightness"]');
      await pointer('move', brightnessPoint);
      await pause(260);
    } else {
      const handle = await position('.rail-handle');
      await pointer('move', handle);
      // Gradual movement verifies the confirmation corridor, not a jump.
      for (let x = handle.x + 4; x <= handle.right + 20; x += 4) {
        brightnessPoint = { x, y: handle.y };
        await pointer('move', brightnessPoint);
        await pause(20);
      }
    }
    const armed = await state();
    if (armed.mode !== 'brightness' || armed.b !== 62)
      throw Error(kind + ' handoff jumped brightness or failed to arm');
    checks.push(
      kind +
        ': deliberate handoff arms brightness without changing its value or lifting',
    );
    if (kind === 'tabs') {
      await pointer('move', color);
      if ((await state()).b !== 62)
        throw Error('Return to dial jumped brightness');
    }
    const movePoint =
      kind === 'rail'
        ? { x: brightnessPoint.x, y: brightnessPoint.y - 30 }
        : { x: center.x, y: center.y + (kind === 'moat' ? 119 : 100) };
    await pointer('move', movePoint);
    const adjusted = await state();
    if (adjusted.b <= 62 || adjusted.h !== armed.h || adjusted.s !== armed.s)
      throw Error(
        kind +
          ' brightness changed color or did not adjust: ' +
          JSON.stringify({ armed, adjusted, center, movePoint }),
      );
    checks.push(kind + ': brightness movement changes only brightness');
    if (kind === 'moat') {
      await pointer('move', color);
      await pause(400);
    } else if (kind === 'tabs') {
      await pointer('move', await position('[data-mode-button="color"]'));
      await pause(260);
    } else {
      const back = await position('.rail-return');
      await pointer('move', back);
      for (let x = back.x - 4; x >= back.left - 20; x -= 4) {
        await pointer('move', { x, y: back.y });
        await pause(20);
      }
    }
    const returned = await state();
    if (returned.mode !== 'color' || returned.b !== adjusted.b)
      throw Error(kind + ' return changed brightness');
    await pointer('move', { x: center.x - 70, y: center.y });
    if ((await state()).h !== 270 || (await state()).b !== adjusted.b)
      throw Error(kind + ' resumed color changed brightness');
    await pointer('up', { x: center.x - 70, y: center.y });
    if (await evaluate(`${ref}.popover.classList.contains('closed')`))
      throw Error(kind + ' release closed popover');
    checks.push(
      kind +
        ': returns to color, adjusts it and releases with the popover still open',
    );
    const power = await position('.power');
    await pointer('down', power);
    await pause(620);
    await pointer('up', power);
    if (
      !(await evaluate(`${ref}.popover.classList.contains('closed')`)) ||
      !(await evaluate(`${ref}.on`))
    )
      throw Error(
        kind +
          ' power hold should dismiss without toggling: ' +
          JSON.stringify(
            await evaluate(
              `({closed:${ref}.popover.classList.contains('closed'),on:${ref}.on,pointer:${ref}.pointer,suppress:${ref}.suppressPower})`,
            ),
          ),
      );
    checks.push(kind + ': power hold dismisses without toggling');
    await evaluate(`${ref}.reset()`);
  }
  await evaluate(`location.hash='all'`);
  return { passed: true, width, checks };
}
