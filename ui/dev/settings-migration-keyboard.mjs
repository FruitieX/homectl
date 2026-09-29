export default async function (cdp, { url }) {
  if (!url.startsWith('http://127.0.0.1:3021/config/migration'))
    throw Error('Use isolated fixture');
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails) throw Error(r.exceptionDetails.text);
    return r.result.value;
  };
  if (
    (await evaluate(
      "fetch('/api/v1/config/groups').then(r=>r.headers.get('x-homectl-fixture'))",
    )) !== 'true'
  )
    throw Error('Missing fixture marker');
  const pause = () => new Promise((r) => setTimeout(r, 200));
  const key = async (key, code, keyCode, text) => {
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      ...(text ? { text, unmodifiedText: text } : {}),
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key,
      code,
      windowsVirtualKeyCode: keyCode,
    });
    await pause();
  };
  const before = await evaluate(
    "fetch('/api/v1/config/groups').then(r=>r.text())",
  );
  await evaluate("document.querySelector('fieldset input').focus()");
  await key(' ', 'Space', 32, ' ');
  if (await evaluate("document.querySelector('fieldset input').checked"))
    throw Error('Keyboard did not toggle scope');
  await evaluate(
    `(()=>{document.querySelectorAll('fieldset input')[1].click();const file=new DataTransfer();file.items.add(new File(["[groups.living_room]\\nname='Reviewed room'\\n"],'keyboard.toml',{type:'text/plain'}));const input=document.querySelector('input[type=file]');input.files=file.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()`,
  );
  for (let n = 0; n < 80; n++) {
    if (await evaluate("!!document.querySelector('#migration-review')")) break;
    await pause();
  }
  if (
    !(await evaluate("document.activeElement?.id==='migration-review-title'"))
  )
    throw Error('Review heading did not receive focus');
  await evaluate(
    "[...document.querySelectorAll('button')].find(el=>el.textContent==='Import selected entries').focus()",
  );
  await key('Enter', 'Enter', 13, '\r');
  if (
    !(await evaluate(
      "!!document.querySelector('[role=dialog]')?.contains(document.activeElement)",
    ))
  )
    throw Error('Confirmation did not contain keyboard focus');
  await key('Escape', 'Escape', 27);
  if (await evaluate("!!document.querySelector('[role=dialog]')"))
    throw Error('Escape did not cancel import');
  if (
    before !==
    (await evaluate("fetch('/api/v1/config/groups').then(r=>r.text())"))
  )
    throw Error('Keyboard review or cancellation wrote configuration');
  await evaluate(
    "document.documentElement.style.zoom='2';document.getElementById('migration-review-title').scrollIntoView({block:'start'})",
  );
  await pause();
  if (
    !(await evaluate(
      'document.documentElement.scrollWidth<=document.documentElement.clientWidth',
    ))
  )
    throw Error('Page overflow at 200% CSS zoom');
  return {
    passed: true,
    checks: [
      'Native Space changes import scope',
      'Review moves focus to its heading',
      'Native confirmation traps focus and Escape cancels without writes',
      'Review fits at 200% CSS zoom',
    ],
  };
}
