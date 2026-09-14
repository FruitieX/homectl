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

const {
  clampDashboardWidgetHeight,
  clampDashboardWidgetWidth,
  getDashboardWidgetGridStyle,
  getDashboardWidgetMinimumWidth,
  getDashboardWidgetSpanClass,
} = load('dashboard-layout');
const weatherCardSource = fs.readFileSync(
  path.join(__dirname, '../app/dashboard/WeatherCard.tsx'),
  'utf8',
);
const weatherStylesSource = fs.readFileSync(
  path.join(__dirname, '../styles/globals.css'),
  'utf8',
);
const trainCardSource = fs.readFileSync(
  path.join(__dirname, '../app/dashboard/TrainScheduleCard.tsx'),
  'utf8',
);
const sensorsCardSource = fs.readFileSync(
  path.join(__dirname, '../app/dashboard/SensorsCard.tsx'),
  'utf8',
);
const homeCardSource = fs.readFileSync(
  path.join(__dirname, '../app/dashboard/HomeOverview.tsx'),
  'utf8',
);

test('keeps the weather container query free of display conflicts', () => {
  assert.match(weatherCardSource, /dashboard-weather-layout grid grid-cols-1/);
  assert.doesNotMatch(
    weatherCardSource,
    /dashboard-weather-layout flex flex-col/,
  );
  assert.match(
    weatherStylesSource,
    /@container dashboard-widget \(min-width: 20rem\)/,
  );
  assert.match(
    weatherStylesSource,
    /@container dashboard-widget \(max-height: 10rem\)/,
  );
  assert.match(weatherStylesSource, /dashboard-weather-icon/);
  assert.match(weatherStylesSource, /dashboard-clock-display/);
  assert.match(weatherStylesSource, /dashboard-widget-heading-compact-value/);
  assert.doesNotMatch(
    weatherStylesSource,
    /dashboard-weather-forecast\s*\{\s*display: flex;\s*flex-direction: row/,
  );
  assert.match(
    weatherStylesSource,
    /@container dashboard-widget \(max-height: 12rem\)/,
  );
  assert.match(
    fs.readFileSync(
      path.join(__dirname, '../app/dashboard/ClockCard.tsx'),
      'utf8',
    ),
    /14cqw/,
  );
  assert.match(
    fs.readFileSync(
      path.join(__dirname, '../app/dashboard/TrainScheduleCard.tsx'),
      'utf8',
    ),
    /overflow-y-auto overscroll-contain scrollbar-none/,
  );
});

test('gives compact cards a summary-only fallback before content can clip', () => {
  assert.match(
    weatherStylesSource,
    /@container dashboard-widget \(max-height: 8rem\)/,
  );
  assert.match(
    weatherStylesSource,
    /dashboard-weather-content,\n\s+\.dashboard-controls-content/,
  );
  assert.match(
    weatherStylesSource,
    /\.dashboard-train-row:nth-child\(n \+ 2\)/,
  );
  assert.match(weatherStylesSource, /\.dashboard-link-content/);
  assert.match(trainCardSource, /dashboard-train-heading-value/);
  assert.match(sensorsCardSource, /dashboard-sensors-heading/);
  assert.match(homeCardSource, /dashboard-home-title/);
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

test('preserves quarter-unit widget dimensions in the rendered grid', () => {
  assert.equal(clampDashboardWidgetWidth(1.5), 1.5);
  assert.equal(clampDashboardWidgetHeight(0.1), 0.25);
  assert.deepEqual(getDashboardWidgetGridStyle(1.5, 1.25), {
    gridColumn: 'span 6 / span 6',
    gridRow: 'span 5 / span 5',
  });
});
