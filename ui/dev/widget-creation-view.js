(async () => {
  if (location.origin !== 'http://127.0.0.1:3021')
    throw Error('Fixture required');
  const button = (text) =>
    [...document.querySelectorAll('button')].find(
      (b) => b.textContent.trim() === text,
    );
  [...document.querySelectorAll('[aria-label="Widget type"] button')]
    .find((b) => b.textContent.trim().startsWith('Rooms'))
    .click();
  await new Promise((r) => setTimeout(r, 200));
  button('Standard').click();
  await new Promise((r) => setTimeout(r, 300));
  document
    .querySelector(
      location.hash === '#preview' ? '#widget-preview' : '.settings-page',
    )
    .scrollIntoView({ block: 'start' });
  if (!button('Create widget') || !location.pathname.endsWith('/new'))
    throw Error('Expected unsaved creation view');
  return {
    passed: true,
    view: location.hash || 'gallery',
    writes: 'none; draft only',
  };
})();
