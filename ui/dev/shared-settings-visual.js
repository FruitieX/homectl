(async () => {
  const pause = () => new Promise((r) => setTimeout(r, 100));
  const until = async (fn, message) => {
    for (let i = 0; i < 100; i++) {
      if (fn()) return;
      await pause();
    }
    throw Error(message);
  };
  const goto = async (path) => {
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
    await pause();
  };
  const checks = [];
  await goto('/config/sensors');
  await until(
    () => document.querySelector('[role="combobox"]'),
    'Sensor source picker',
  );
  document.querySelector('[role="combobox"]').click();
  await until(
    () => document.querySelector('[cmdk-list] [role="option"]'),
    'Picker results',
  );
  const list = document.querySelector('[cmdk-list]'),
    item = list.querySelector('[role="option"]');
  const a = list.getBoundingClientRect(),
    b = item.getBoundingClientRect();
  if (b.left - a.left < 3 || a.right - b.right < 3)
    throw Error('Rounded results touch list edges');
  checks.push('Shared autocomplete results have an inset on both sides');
  document.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  await goto('/config/widget-sources');
  await until(
    () =>
      document.querySelectorAll('a[href^="/config/widget-sources/"]').length >
      1,
    'Widget sources loaded',
  );
  const rows = [
    ...document.querySelectorAll('a[href^="/config/widget-sources/"]'),
  ];
  const parent = rows[0].parentElement,
    outer = getComputedStyle(parent);
  const dividers = rows.map((row) => getComputedStyle(row));
  if (
    outer.borderTopWidth !== '1px' ||
    !dividers
      .slice(0, -1)
      .every(
        (s) =>
          s.borderBottomWidth === '1px' &&
          s.borderBottomColor === outer.borderTopColor,
      ) ||
    dividers.at(-1).borderBottomWidth !== '0px'
  )
    throw Error(
      'Source separators differ from the shared border token or duplicate the last border',
    );
  checks.push(
    'Widget sources use one shared-color divider per row and a single outer border',
  );
  if (document.documentElement.scrollWidth > innerWidth + 1)
    throw Error('Page overflow');
  checks.push('Source list and related links fit the viewport');
  return { passed: true, checks, width: innerWidth };
})();
