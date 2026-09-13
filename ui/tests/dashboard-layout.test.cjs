const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function load(name) {
  const source = fs.readFileSync(
    path.join(__dirname, '../lib', `${name}.ts`),
    'utf8',
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  const module = { exports: {} };
  new Function('module', 'exports', compiled.outputText)(
    module,
    module.exports,
  );
  return module.exports;
}

const { getDashboardWidgetMinimumWidth, getDashboardWidgetSpanClass } =
  load('dashboard-layout');
const weatherCardSource = fs.readFileSync(
  path.join(__dirname, '../app/dashboard/WeatherCard.tsx'),
  'utf8',
);

test('keeps the weather container query free of display conflicts', () => {
  assert.match(weatherCardSource, /dashboard-weather-layout grid grid-cols-1/);
  assert.doesNotMatch(
    weatherCardSource,
    /dashboard-weather-layout flex flex-col/,
  );
});

test('gives dense widgets a usable minimum width', () => {
  assert.equal(getDashboardWidgetMinimumWidth('weather'), 2);
  assert.equal(getDashboardWidgetMinimumWidth('controls'), 2);
  assert.equal(getDashboardWidgetMinimumWidth('sensors'), 3);
  assert.equal(getDashboardWidgetMinimumWidth('train_schedule'), 4);
  assert.equal(getDashboardWidgetMinimumWidth('image'), 2);
});

test('uses the widget minimum when rendering a narrow configured width', () => {
  assert.equal(
    getDashboardWidgetSpanClass(1, 'weather'),
    'col-span-4 min-[37.5rem]:col-span-2 lg:col-span-2',
  );
  assert.equal(
    getDashboardWidgetSpanClass(1, 'train_schedule'),
    'col-span-4 min-[37.5rem]:col-span-4 lg:col-span-4',
  );
  assert.match(
    getDashboardWidgetSpanClass(5, 'weather'),
    /min-\[37\.5rem\]:col-span-5 lg:col-span-5/,
  );
});
