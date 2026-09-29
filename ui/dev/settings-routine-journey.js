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
        : el.tagName === 'TEXTAREA'
          ? HTMLTextAreaElement.prototype
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
  await choose('Add branch action', 'Sandboxed script');
  const scriptNode = [
    ...document.querySelectorAll('.flow-branch-actions [data-node-id]'),
  ].at(-1);
  await until(
    () => scriptNode.querySelector('.monaco-editor'),
    'Locally bundled code editor renders',
  );
  assert(
    !performance
      .getEntriesByType('resource')
      .some((entry) =>
        /cdn\.jsdelivr\.net.*monaco|cdnjs.*monaco/.test(entry.name),
      ),
    'Code editor loads without a remote Monaco CDN',
  );
  const plain = [...scriptNode.querySelectorAll('button')].find(
    (el) => el.textContent.trim() === 'Plain text',
  );
  if (plain) {
    plain.click();
    await pause();
  }
  const body =
    'return { actions: [api.actions.cancelTimer({key: "from_script"})], next_state: {visits: 1} };';
  set(scriptNode.querySelector('textarea[aria-label="Script body"]'), body);
  await pause();
  [...scriptNode.querySelectorAll('button')]
    .find((el) => el.textContent.trim() === 'Code editor')
    .click();
  await until(
    () =>
      scriptNode
        .querySelector('.view-lines')
        ?.textContent.includes('from_script'),
    'Plain text changes reach the code editor',
  );
  assert(true, 'Switching between plain text and code keeps the script body');
  const scriptId = scriptNode.dataset.nodeId;
  assert(
    !!scriptNode &&
      !!document.querySelector(
        '.flow-branch-actions input[value="journey_timer"]',
      ),
    'Script and native controls coexist inside a branch',
  );
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
  assert(
    saved.definition_v2.program.steps[1].branches[0].steps[1].spec
      .source_body === body,
    'Mixed script body persists without replacing the native program',
  );
  const scriptSaved = document.querySelector(`[data-node-id="${scriptId}"]`);
  const openActions = async (node) => {
    node.querySelector('button[aria-label^="Actions for"]').dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        button: 0,
        pointerType: 'mouse',
      }),
    );
    await until(
      () => document.querySelector('[role="menu"]'),
      'Action menu opened',
    );
  };
  await openActions(scriptSaved);
  [...document.querySelectorAll('[role="menuitem"]')]
    .find((el) => el.textContent.trim() === 'Duplicate')
    .click();
  await pause();
  const scriptNodes = [
    ...document.querySelectorAll('.flow-branch-actions [data-node-id]'),
  ].filter((node) => node.textContent.includes('Sandboxed script'));
  assert(
    scriptNodes.length === 2 &&
      scriptNodes[0].dataset.nodeId !== scriptNodes[1].dataset.nodeId,
    'Duplicating script action allocates a separate stable identity',
  );
  await openActions(scriptNodes[1]);
  [...document.querySelectorAll('[role="menuitem"]')]
    .find((el) => el.textContent.trim() === 'Remove')
    .click();
  await pause();
  assert(
    [
      ...document.querySelectorAll('.flow-branch-actions [data-node-id]'),
    ].filter((node) => node.textContent.includes('Sandboxed script')).length ===
      1,
    'Deleting the duplicate preserves the original script action',
  );
  const first = document.querySelector('#then [data-node-id]');
  first
    .querySelector('button[aria-label^="Move "][aria-label$=" down"]')
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
  const switchType = async (label) => {
    document
      .querySelector(`[data-node-id="${scriptId}"] [aria-label="Step type"]`)
      .dispatchEvent(
        new PointerEvent('pointerdown', {
          bubbles: true,
          button: 0,
          pointerType: 'mouse',
        }),
      );
    await until(
      () => document.querySelector('[role="option"]'),
      'Types opened',
    );
    [...document.querySelectorAll('[role="option"]')]
      .find((el) => el.textContent.trim() === label)
      .click();
    await pause();
  };
  await switchType('Cancel named timer');
  set(
    document.querySelector(`[data-node-id="${scriptId}"] input`),
    'temporary_type',
  );
  await pause();
  await switchType('Sandboxed script');
  const restoredNode = document.querySelector(`[data-node-id="${scriptId}"]`);
  [...restoredNode.querySelectorAll('button')]
    .find((el) => el.textContent.trim() === 'Plain text')
    .click();
  await pause();
  assert(
    restoredNode.querySelector('textarea[aria-label="Script body"]').value ===
      body,
    'Switching action types and back restores script details and identity',
  );
  await switchType('Cancel named timer');
  assert(
    document.querySelector(`[data-node-id="${scriptId}"] input`).value ===
      'temporary_type',
    'Each action type retains its own unsaved controls',
  );
  button('Discard').click();
  await until(() => !button('Save changes'), 'Draft discarded');
  assert(
    document
      .querySelector(`[data-node-id="${scriptId}"]`)
      .textContent.includes('Sandboxed script') &&
      JSON.stringify((await rows()).find((row) => row.id === routineId)) ===
        JSON.stringify(reordered),
    'Discard restores the saved script and leaves persisted configuration unchanged',
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
