(async () => {
  if (location.hostname !== '127.0.0.1' || location.port !== '3021')
    throw Error('Use the isolated fixture on port 3021.');
  const checks = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 150));
  const until = async (fn, message) => {
    for (let i = 0; i < 80; i++) {
      if (fn()) return;
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
  const radio = (name, value) =>
    document.querySelector(
      `input[name="appearance-${name}"][value="${value}"]`,
    );
  const tab = (name) =>
    button(name).dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 }),
    );
  await until(() => radio('theme', 'dark'), 'Appearance loaded');
  const oldTheme = document.documentElement.classList.contains('dark')
    ? 'dark'
    : 'light';
  const nextTheme = oldTheme === 'dark' ? 'light' : 'dark';
  const oldStorage = localStorage.getItem('homectl-theme');
  radio('theme', nextTheme).click();
  radio('accent', 'rose').click();
  await pause();
  assert(
    localStorage.getItem('homectl-theme') === oldStorage &&
      document.documentElement.classList.contains('dark') ===
        (oldTheme === 'dark'),
    'Appearance edits do not change the saved browser theme',
  );
  tab('Behavior');
  await until(
    () => document.querySelector('[data-field="warmup_time_seconds"]'),
    'Behavior opened',
  );
  tab('Appearance');
  await until(() => radio('theme', nextTheme), 'Appearance returned');
  assert(
    radio('theme', nextTheme).checked && radio('accent', 'rose').checked,
    'Appearance draft survives tab navigation',
  );
  button('Discard').click();
  await pause();
  assert(
    !button('Save changes') &&
      localStorage.getItem('homectl-theme') === oldStorage,
    'Discard restores the saved appearance',
  );
  radio('theme', nextTheme).click();
  radio('accent', 'sky').click();
  radio('density', 'compact').click();
  await pause();
  button('Save changes').click();
  await until(() => !button('Save changes'), 'Appearance saved');
  assert(
    JSON.parse(localStorage.getItem('homectl-theme')) === nextTheme &&
      document.documentElement.classList.contains('dark') ===
        (nextTheme === 'dark') &&
      document.documentElement.dataset.accent === 'sky' &&
      document.documentElement.dataset.density === 'compact',
    'Explicit Save applies and stores theme, accent and density',
  );
  assert(
    document.querySelector('#browser-tools input').getBoundingClientRect()
      .height > 0,
    'Display and troubleshooting controls are directly available',
  );
  const themeInputs = [
    ...document.querySelectorAll('[name="appearance-theme"]'),
  ];
  assert(
    themeInputs.every((el) => el.type === 'radio' && el.labels.length === 1),
    'Theme choices use labeled native radio controls',
  );
  assert(
    document.documentElement.scrollWidth <= innerWidth,
    'Appearance controls fit the viewport',
  );
  return { passed: true, checks };
})();
