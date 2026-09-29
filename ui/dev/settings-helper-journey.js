(async () => {
  const root = '/api/v1/config/helpers',
    response = await fetch(root);
  if (
    response.headers.get('x-homectl-fixture') !== 'true' ||
    location.hostname !== '127.0.0.1' ||
    location.port !== '3021'
  )
    throw Error('Use the isolated fixture on port 3021.');
  const checks = [],
    id = `settings_helper_${innerWidth}_${Date.now()}`,
    pause = () => new Promise((resolve) => setTimeout(resolve, 150));
  const until = async (predicate, message) => {
    for (let i = 0; i < 80; i++) {
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
  const input = (el, value) => {
    if (!el) throw Error('Missing control');
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
  const kind = async (label) => {
    document
      .querySelector('[data-field=kind]')
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    await until(() => document.querySelector('[role=option]'), 'Helper types');
    [...document.querySelectorAll('[role=option]')]
      .find((el) => el.textContent.trim() === label)
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    await pause();
  };
  const saved = async () =>
    (await (await fetch(root)).json()).data.find((row) => row.id === id);
  await fetch(`${root}/${id}`, { method: 'DELETE' });
  await until(
    () => document.querySelector('[data-field=name]'),
    'Helper editor ready',
  );
  input(document.querySelector('[data-field=id]'), id);
  input(document.querySelector('[data-field=name]'), 'Evening mode');
  await kind('Enum (fixed options)');
  await pause();
  button('Add option').click();
  await pause();
  input(document.querySelector('[aria-label="Option 3"]'), 'away');
  await pause();
  document.querySelector('[aria-label="Move option 3 up"]').click();
  await pause();
  assert(
    document.querySelector('[aria-label="Option 2"]').value === 'away',
    'Enum options support multiple entries and ordering',
  );
  await kind('String');
  await pause();
  await kind('Enum (fixed options)');
  await pause();
  assert(
    document.querySelector('[aria-label="Option 2"]').value === 'away',
    'Changing type and returning preserves the previous variant draft',
  );
  button('Create helper').click();
  await until(
    () =>
      location.pathname.endsWith('/' + id) &&
      document.querySelector('#current'),
    'Helper created',
  );
  assert(
    (await saved()).kind.options.join(',') === 'on,away,off',
    'Create saves the complete ordered definition',
  );
  input(document.querySelector('[data-field=name]'), 'Pending name');
  await pause();
  const currentPicker = document.querySelector('#current [role=combobox]');
  currentPicker.click();
  await until(
    () => document.querySelector('[cmdk-item]'),
    'Current value picker opened',
  );
  const off = [...document.querySelectorAll('[cmdk-item]')].find(
    (el) => el.textContent.trim().replaceAll(/\s/g, '') === 'off',
  );
  if (!off) throw Error('Off option missing');
  off.click();
  await pause();
  button('Set current value').click();
  await until(
    () =>
      document
        .querySelector('#current')
        .innerText.includes('Current value updated.'),
    'Current command completed',
  );
  let row = await saved();
  assert(
    row.value === 'off' && row.name === 'Evening mode',
    'Immediate value command does not save pending definition changes',
  );
  assert(
    document.querySelector('[data-field=name]').value === 'Pending name',
    'Live value refresh preserves the configuration draft',
  );
  const parent = [
    ...document.querySelectorAll('a[href="/config/helpers"]'),
  ].find((el) => el.offsetParent !== null);
  parent.click();
  await until(
    () => location.pathname === '/config/helpers',
    'Helpers list opened',
  );
  const retained = () =>
    [...document.querySelectorAll('[aria-label="Retained drafts"] a')].find(
      (el) => el.href.endsWith('/' + id),
    );
  await until(retained, 'Draft return visible');
  retained().click();
  await until(
    () => document.querySelector('[data-field=name]'),
    'Returned to helper',
  );
  assert(
    document.querySelector('[data-field=name]').value === 'Pending name',
    'Navigation retains unsaved helper changes',
  );
  const { value: _value, revision: _revision, ...definition } = row;
  await fetch(`${root}/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...definition,
      persistence: 'session',
      expected: definition,
    }),
  });
  button('Save changes').click();
  await until(() => button('Review changes'), 'Conflict detected');
  button('Review changes').click();
  await until(() => button('Use reviewed choices'), 'Review open');
  button('Use reviewed choices').click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Reviewed save completed');
  row = await saved();
  assert(
    row.name === 'Pending name' &&
      row.persistence === 'session' &&
      row.value === 'off',
    'Reviewed save preserves remote persistence and current value',
  );
  input(document.querySelector('[aria-label="Option 3"]'), 'different');
  await pause();
  button('Save changes').click();
  await until(
    () => button('Save and reset value'),
    'Reset confirmation appears',
  );
  assert(
    document
      .querySelector('[role=alertdialog], [role=dialog]')
      .innerText.includes('does not fit'),
    'Changing options explains an incompatible current value before saving',
  );
  button('Cancel').click();
  await pause();
  assert(
    (await saved()).value === 'off',
    'Cancelling definition change leaves the live value alone',
  );
  button('Discard').click();
  await pause();
  assert(
    document.querySelector('[aria-label="Option 3"]').value === 'off',
    'Discard restores the saved options',
  );
  assert(
    ![
      ...document.querySelectorAll(
        'main input, main select, main [role=combobox]',
      ),
    ].some((el) => el.getBoundingClientRect().right > innerWidth + 1),
    'Helper controls fit the viewport',
  );
  return { passed: true, checks };
})();
