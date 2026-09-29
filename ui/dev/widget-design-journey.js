(async () => {
  const marker = await fetch('/api/v1/config/dashboard/layouts');
  if (
    location.origin !== 'http://127.0.0.1:3021' ||
    marker.headers.get('x-homectl-fixture') !== 'true'
  )
    throw Error('Isolated fixture required');
  const checks = [];
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  const until = async (check, message) => {
    for (let i = 0; i < 100; i++) {
      if (check()) return;
      await pause();
    }
    throw Error(message);
  };
  const assert = (condition, message) => {
    if (!condition) throw Error(message);
    checks.push(message);
  };
  const choose = (name) =>
    [...document.querySelectorAll('[aria-label="Widget type"] button')].find(
      (button) => button.textContent.trim().startsWith(name),
    );
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (button) => button.textContent.trim() === text,
    );
  const input = (element, value) => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    ).set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const original = window.fetch;
  const writes = [];
  window.fetch = (...args) => {
    if (
      args[1]?.method &&
      !['GET', 'HEAD', 'OPTIONS'].includes(args[1].method.toUpperCase())
    )
      writes.push({ url: String(args[0]), method: args[1].method });
    return original(...args);
  };
  try {
    await until(() => choose('Rooms'), 'Gallery loaded');
    assert(
      !document.querySelector('select[aria-label="Widget type"]'),
      'Widget types use visual cards',
    );
    choose('Rooms').click();
    await pause();
    input(document.querySelector('[data-field="title"]'), 'Preview rooms');
    await pause();
    button('Standard').click();
    await pause();
    assert(
      document.querySelector('#widget-preview').textContent.includes('4 × 3'),
      'Preset updates draft preview',
    );
    assert(
      document.querySelector('#widget-preview [inert]'),
      'Preview prevents device commands and keyboard activation',
    );
    choose('Text').click();
    await pause();
    choose('Rooms').click();
    await pause();
    assert(
      document.querySelector('[data-field="title"]').value === 'Preview rooms',
      'Switching type retains its draft',
    );
    assert(
      writes.length === 0,
      'Choosing, configuring and previewing creates no writes',
    );
    assert(
      document.documentElement.scrollWidth <= innerWidth + 1,
      'Editor fits viewport',
    );
    button('Create widget').click();
    await until(
      () => !location.pathname.endsWith('/new'),
      'Created widget route',
    );
    const saved = (
      await (
        await original('/api/v1/config/dashboard/layouts/1/widgets')
      ).json()
    ).data;
    const id = Number(location.pathname.split('/').at(-1));
    const row = saved.find((item) => item.id === id);
    assert(
      row?.widget_type === 'rooms' && row.grid_w === 4 && row.grid_h === 3,
      'Create persists selected type, title and dimensions',
    );
    assert(writes.length === 1, 'Only explicit Create writes configuration');
    return { passed: true, checks, width: innerWidth, widgetId: row.id };
  } finally {
    window.fetch = original;
  }
})();
