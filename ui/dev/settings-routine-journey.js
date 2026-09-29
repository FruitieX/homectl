(async () => {
  const response = await fetch('/api/v1/config/routines');
  if (
    response.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the marked isolated fixture on port 3021.');
  const checks = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 200));
  const until = async (predicate, message) => {
    for (let i = 0; i < 60; i++) {
      if (predicate()) return;
      await pause();
    }
    throw Error(message);
  };
  const assert = (value, message) => {
    if (!value) throw Error(message);
    checks.push(message);
  };
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (el) => el.textContent.trim() === text,
    );
  const set = (el, value) => {
    if (!el) throw Error('Missing input');
    Object.getOwnPropertyDescriptor(
      el.tagName === 'SELECT'
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype,
      'value',
    ).set.call(el, value);
    el.dispatchEvent(
      new Event(el.tagName === 'SELECT' ? 'change' : 'input', {
        bubbles: true,
      }),
    );
  };
  const choose = async (label, option) => {
    const trigger = button(label);
    if (!trigger) throw Error('Missing ' + label);
    trigger.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerType: 'mouse',
      }),
    );
    await until(() => document.querySelector('[role="menu"]'), 'Menu opened');
    [...document.querySelectorAll('[role="menuitem"]')]
      .find((el) => el.textContent.trim() === option)
      .click();
    await pause();
  };
  const rows = async () =>
    (await (await fetch('/api/v1/config/routines')).json()).data;
  await until(
    () => document.querySelector('[data-field="name"]'),
    'New routine ready',
  );
  const suffix = String(Date.now()).slice(-7),
    name = 'Journey ' + suffix;
  set(document.querySelector('[data-field="name"]'), name);
  await pause();
  const routineId = document.querySelector('[data-field="id"]').value;
  assert(
    document.querySelector('#details input[type="checkbox"]').checked,
    'New routines enable after creation by default',
  );
  await choose('Add start', 'Manual only');
  await choose('Add action', 'Activate scene');
  const nodeId = document.querySelector('#then [data-node-id]').dataset.nodeId;
  const createScene = [...document.querySelectorAll('a')].find(
    (el) => el.textContent.trim() === 'Create a scene',
  );
  assert(
    Boolean(createScene),
    'Scene creation is linked directly from its action',
  );
  createScene.click();
  await until(
    () =>
      location.pathname === '/config/scenes/new' &&
      document.querySelector('h1')?.textContent === 'New scene' &&
      button('Create scene'),
    'Scene creation ready',
  );
  set(document.querySelector('[data-field="name"]'), name + ' scene');
  await pause();
  const sceneId = document.querySelector('[data-field="id"]').value;
  button('Create scene').click();
  await until(
    () =>
      location.pathname === '/config/routines/new' &&
      document.querySelector('#then [data-node-id]'),
    'Routine return ready',
  );
  await pause();
  assert(
    document.querySelector('[data-field="name"]').value === name,
    'Creating a scene retains the originating routine draft',
  );
  assert(
    document.querySelector('#then').textContent.includes(name + ' scene'),
    'Created scene is selected in the original action',
  );
  assert(
    document.querySelector('#then [data-node-id]').dataset.nodeId === nodeId,
    'Returning preserves stable action identity',
  );
  assert(
    !(await rows()).some((row) => row.id === routineId),
    'Cross-page creation does not save the routine',
  );
  await choose('Add action', 'Choose a branch');
  button('Add branch').click();
  await pause();
  await choose('Add branch action', 'Cancel named timer');
  const timerInput = document.querySelector('.flow-branch-actions input');
  set(timerInput, 'journey_timer');
  await pause();
  assert(
    ![...document.querySelectorAll('button')].some(
      (el) => el.textContent.trim() === 'Edit',
    ),
    'Nested routine controls need no Edit buttons',
  );
  button('Create routine').click();
  await until(
    () =>
      location.pathname === '/config/routines/' + routineId &&
      document.querySelector('h1')?.textContent === name &&
      document.querySelector('#then [data-node-id]'),
    'Routine created',
  );
  const saved = (await rows()).find((row) => row.id === routineId);
  assert(
    saved.enabled && saved.definition_v2.program.steps[0].scene_id === sceneId,
    'Creation saves the enabled routine with its selected scene',
  );
  assert(
    saved.definition_v2.program.steps[1].branches[0].steps[0].timer ===
      'journey_timer',
    'Nested branch timer settings survive save',
  );
  const first = document.querySelector('#then [data-node-id]');
  first.querySelector('button[aria-label^="Actions for"]').dispatchEvent(
    new PointerEvent('pointerdown', {
      bubbles: true,
      button: 0,
      pointerType: 'mouse',
    }),
  );
  await pause();
  [...document.querySelectorAll('[role="menuitem"]')]
    .find((el) => el.textContent.trim() === 'Move later')
    .click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Reorder saved');
  const reordered = (await rows()).find((row) => row.id === routineId);
  assert(
    reordered.definition_v2.program.steps[1].id === nodeId,
    'Reordering saves existing IDs without renumbering',
  );
  assert(
    JSON.stringify(reordered.definition_v2.program.steps[0]) ===
      JSON.stringify(saved.definition_v2.program.steps[1]),
    'Reordering preserves the complete branch subtree',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'No horizontal overflow',
  );
  document.querySelector('.routine-flow').scrollIntoView({ block: 'start' });
  await fetch('/api/v1/config/routines/' + routineId, { method: 'DELETE' });
  await fetch('/api/v1/config/scenes/' + sceneId, { method: 'DELETE' });
  return { passed: true, checks };
})().catch((error) => ({
  passed: false,
  error: error.message,
  stack: error.stack,
}));
