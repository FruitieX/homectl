export default async function (cdp, { url }) {
  if (!url.startsWith('http://127.0.0.1:3021/'))
    throw Error('Isolated fixture required');
  const evaluate = async (expression) => {
    const r = await cdp.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw Error(
        r.exceptionDetails.exception?.description ?? r.exceptionDetails.text,
      );
    return r.result.value;
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const marker = await evaluate(
    `fetch('/api/__fixture/live-controls').then(r=>r.headers.get('x-homectl-fixture'))`,
  );
  if (marker !== 'true') throw Error('Fixture required');
  await evaluate(
    `fetch('/api/__fixture/live-controls',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({clear:true,reject:false,delay:250})})`,
  );
  const before = await evaluate(
    `Number(document.querySelector('[role="slider"][aria-label="Living room lamp brightness"]').getAttribute('aria-valuenow'))`,
  );
  await evaluate(
    `document.querySelector('[role="slider"][aria-label="Living room lamp brightness"]').focus()`,
  );
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'ArrowLeft',
    code: 'ArrowLeft',
    windowsVirtualKeyCode: 37,
  });
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'ArrowLeft',
    code: 'ArrowLeft',
    windowsVirtualKeyCode: 37,
  });
  await pause(800);
  const commands = await evaluate(
    `fetch('/api/__fixture/live-controls').then(r=>r.json()).then(r=>r.commands)`,
  );
  const command = commands.find((c) => c.DeviceCommand)?.DeviceCommand;
  if (
    !command ||
    command.device_key !== 'zigbee2mqtt/living_room_lamp' ||
    Math.abs(command.brightness - (before - 1) / 100) > 0.00001 ||
    command.color !== null
  )
    throw Error(JSON.stringify(commands));
  const current = await evaluate(
    `Number(document.querySelector('[role="slider"][aria-label="Living room lamp brightness"]').getAttribute('aria-valuenow'))`,
  );
  if (current !== before - 1)
    throw Error('Acknowledged brightness not reflected');
  return {
    passed: true,
    checks: [
      'Inline brightness is keyboard operable',
      'Command targets only the selected light',
      'Color remains unchanged',
      'Acknowledged brightness appears in the slider',
    ],
    before,
    current,
  };
}
