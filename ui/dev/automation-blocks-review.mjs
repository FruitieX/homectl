// Drive only a marked local fixture. No household writes.
import { writeFile } from 'node:fs/promises';
export default async function (cdp, { width, url }) {
  const origin = 'http://127.0.0.1:3031',
    base = origin + '/api/v1/config';
  const marker = await fetch(base + '/blocks');
  if (
    !url.startsWith(origin + '/') ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Marked local fixture required');
  const id = 'block-review-' + width + '-' + Date.now();
  const scenes = (await (await fetch(base + '/scenes')).json()).data;
  const groups = (await (await fetch(base + '/groups')).json()).data;
  const room = groups[0],
    scene = scenes[0];
  const block = {
    id,
    name: 'Review normal lights',
    description: 'Shared scene action',
    kind: 'action',
    revision: 1,
    inputs: { room: { label: 'Room', kind: { kind: 'group' } } },
    body: [
      {
        action: 'activate_scene',
        id: 'activate',
        scene_id: scene.id,
        targets: { groups: [{ $input: 'room' }] },
        use_scene_transition: false,
      },
    ],
  };
  const routine = {
    id: id + '-caller',
    name: 'Review caller',
    enabled: false,
    semantics_version: 2,
    revision: 1,
    rules: [],
    actions: [],
    definition_v2: {
      triggers: [{ kind: 'manual', id: 'manual' }],
      condition: { kind: 'literal', value: true },
      program: {
        kind: 'native',
        steps: [
          {
            action: 'call_block',
            id: 'call',
            block_id: id,
            inputs: { room: room.id },
          },
        ],
      },
    },
  };
  const put = async (kind, value) => {
    const r = await fetch(base + '/' + kind + '/' + value.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...value, create_only: true }),
    });
    if (!r.ok) throw Error(await r.text());
  };
  await put('blocks', block);
  await put('routines', routine);
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
  const pause = () => new Promise((r) => setTimeout(r, 100));
  const until = async (expr, name) => {
    for (let i = 0; i < 100; i++) {
      if (await evaluate(expr)) return;
      await pause();
    }
    throw Error(name);
  };
  const button = (text) =>
    `[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;
  const click = async (expr) => {
    const point = await evaluate(
      `(()=>{const e=${expr};if(!e)throw Error('Missing control');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
    );
    for (const type of ['mousePressed', 'mouseReleased'])
      await cdp.send('Input.dispatchMouseEvent', {
        type,
        ...point,
        button: 'left',
        clickCount: 1,
      });
    await pause();
  };
  const go = async (path) => {
    await cdp.send('Page.navigate', { url: origin + path });
    await until(`document.body.innerText.includes('Review')`, 'Page loaded');
    await pause();
  };
  const checks = [];
  const assert = (name, ok) => {
    if (!ok) throw Error(name);
    checks.push({ name, passed: true });
  };
  try {
    await go('/config/blocks/' + id);
    await until(
      `document.body.innerText.includes('Review caller')`,
      'Caller usage',
    );
    assert(
      'input placeholder and caller usage visible',
      await evaluate(
        `document.body.innerText.includes('Input: Room')&&!!document.querySelector('a[href="/config/routines/${routine.id}"]')`,
      ),
    );
    assert(
      'block choices exclude scripts',
      await evaluate(`!document.body.innerText.includes('Sandboxed script')`),
    );
    await click(
      `[...document.querySelectorAll('input')].find(e=>e.value==='Shared scene action')`,
    );
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key: 'a',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp',
      key: 'a',
      windowsVirtualKeyCode: 65,
      modifiers: 2,
    });
    await cdp.send('Input.insertText', { text: 'Edited shared action' });
    await pause();
    await click(button('Save changes'));
    await until(`!${button('Discard')}`, 'Block saved');
    const saved = (await (await fetch(base + '/blocks')).json()).data.find(
      (b) => b.id === id,
    );
    assert(
      'saving preserves the input binding',
      saved.description === 'Edited shared action' &&
        saved.body[0].targets.groups[0].$input === 'room',
    );
    assert(
      'layout fits viewport',
      await evaluate('document.documentElement.scrollWidth<=innerWidth'),
    );
    await go('/config/routines/' + routine.id);
    await until(
      `document.body.innerText.includes('Review normal lights')`,
      'Named block picker',
    );
    assert(
      'caller has block editor and argument controls',
      await evaluate(
        `document.body.innerText.includes('Run block')&&document.body.innerText.includes('Room')`,
      ),
    );
    await click(
      `[...document.querySelectorAll('summary')].find(e=>e.textContent.includes('View behavior with these inputs'))`,
    );
    assert(
      'preview resolves scene names',
      await evaluate(
        `document.body.innerText.includes(${JSON.stringify(scene.name)})`,
      ),
    );
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await writeFile(
      '/tmp/homectl-blocks-review-' + width + '.png',
      Buffer.from(shot.data, 'base64'),
    );
    return { passed: true, checks };
  } finally {
    await fetch(base + '/routines/' + routine.id, { method: 'DELETE' });
    await fetch(base + '/blocks/' + id, { method: 'DELETE' });
  }
}
