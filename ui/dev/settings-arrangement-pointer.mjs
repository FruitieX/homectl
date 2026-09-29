export default async function (cdp, { width, url }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Use the isolated fixture.');
  const evaluate = async (expression) => {
    const result = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const marker = await evaluate(
    "fetch('/api/v1/config/dashboard/layouts/1/arrangement').then(r=>r.headers.get('x-homectl-fixture'))",
  );
  if (marker !== 'true') throw Error('Missing fixture marker.');
  const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
  const rect = await evaluate(
    `(()=>{const el=document.querySelector('[aria-label="Resize Indoor readings"]');el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  const before = await evaluate(
    "fetch('/api/v1/config/dashboard/layouts/1/arrangement').then(r=>r.json()).then(r=>JSON.stringify(r.data))",
  );
  const move = async (end, cancel = false) => {
    if (width < 700) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: rect.x, y: rect.y }],
      });
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: rect.x + end, y: rect.y + 50 }],
      });
      await pause();
      await cdp.send('Input.dispatchTouchEvent', {
        type: cancel ? 'touchCancel' : 'touchEnd',
        touchPoints: [],
      });
    } else {
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: rect.x,
        y: rect.y,
        button: 'left',
        clickCount: 1,
      });
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: rect.x + end,
        y: rect.y + 50,
        button: 'left',
        buttons: 1,
      });
      await pause();
      await cdp.send('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: rect.x + end,
        y: rect.y + 50,
        button: 'left',
        clickCount: 1,
      });
    }
    await pause();
  };
  const checks = [];
  if (width < 700) {
    await move(50, true);
    if (
      await evaluate(
        "[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='Save changes')",
      )
    )
      throw Error('Cancelled touch resize created an edit.');
    checks.push('A cancelled native touch gesture leaves the draft unchanged');
  }
  await move(width < 700 ? 50 : 100);
  if (
    !(await evaluate(
      "[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='Save changes')",
    ))
  )
    throw Error('Native resize did not stage an edit.');
  const after = await evaluate(
    "fetch('/api/v1/config/dashboard/layouts/1/arrangement').then(r=>r.json()).then(r=>JSON.stringify(r.data))",
  );
  if (after !== before) throw Error('Pointer resize wrote before Save.');
  checks.push('Native pointer resize stages changes without writing');
  await evaluate(
    "[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='Discard').click()",
  );
  await pause();
  if (
    await evaluate(
      "[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='Save changes')",
    )
  )
    throw Error('Discard did not clear the resize.');
  checks.push('Discard clears the pending pointer resize');
  return { passed: true, checks };
}
