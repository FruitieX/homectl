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
const sensorChipSource = fs.readFileSync(
  path.join(__dirname, '../ui/SensorChip.tsx'),
  'utf8',
);
const homeCardSource = fs.readFileSync(
  path.join(__dirname, '../app/dashboard/HomeOverview.tsx'),
  'utf8',
);
const spotPriceCardSource = fs.readFileSync(
  path.join(__dirname, '../app/dashboard/SpotPriceCard.tsx'),
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
    /@container dashboard-widget \(min-width: 14rem\)/,
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
    weatherStylesSource,
    /@container dashboard-widget \(min-height: 10rem\) and\s+\(max-height: 13rem\)/,
  );
  assert.match(weatherStylesSource, /overflow-x: auto/);
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
    /dashboard-weather-content|\.dashboard-controls-content/,
  );
  assert.match(
    weatherStylesSource,
    /\.dashboard-train-row:nth-child\(n \+ 2\)/,
  );
  assert.match(weatherStylesSource, /\.dashboard-link-content/);
  assert.match(trainCardSource, /dashboard-train-heading-value/);
  assert.match(sensorsCardSource, /dashboard-sensors-heading/);
  assert.match(sensorsCardSource, /primarySensorId/);
  assert.match(sensorsCardSource, /dashboard-sensors-heading-value/);
  assert.match(weatherStylesSource, /dashboard-weather-current-card/);
  assert.match(
    weatherStylesSource,
    /dashboard-sensors-preview[\s\S]*?overflow-x: auto/,
  );
  assert.match(homeCardSource, /dashboard-home-title/);
});

test('moves spot price statistics into the card when the chart is too short', () => {
  assert.match(spotPriceCardSource, /dashboard-spot-card/);
  assert.match(spotPriceCardSource, /dashboard-spot-compact-stats/);
  assert.match(spotPriceCardSource, /formatPrice\(stats\?\.average\)/);
  assert.match(
    weatherStylesSource,
    /dashboard-spot-card \.dashboard-widget-heading-compact-value[\s\S]*?display: none;/,
  );
  assert.match(
    weatherStylesSource,
    /dashboard-spot-compact-stats[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    weatherStylesSource,
    /dashboard-spot-compact-stats[\s\S]*?display: none;/,
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

test('preserves quarter-unit widget dimensions in the rendered grid', () => {
  assert.equal(clampDashboardWidgetWidth(1.5), 1.5);
  assert.equal(clampDashboardWidgetHeight(0.1), 0.25);
  assert.deepEqual(getDashboardWidgetGridStyle(1.5, 1.25), {
    gridColumn: 'span 6 / span 6',
    gridRow: 'span 5 / span 5',
  });
});

function containerQueryBlocks(source, needle) {
  const blocks = [];
  let cursor = source.indexOf(needle);
  while (cursor !== -1) {
    const open = source.indexOf('{', cursor);
    if (open === -1) break;
    let depth = 1;
    let index = open + 1;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') depth -= 1;
      index += 1;
    }
    blocks.push(source.slice(open + 1, index - 1));
    cursor = source.indexOf(needle, index);
  }
  return blocks.join('\n');
}

const weatherHeightBands = containerQueryBlocks(
  weatherStylesSource,
  'dashboard-widget (min-height: 10rem) and',
);

test('keeps the medium-height weather strip on the tiles at every card width', () => {
  // Both card sizes in the report were nearly identical, yet the wider one
  // switched the strip to chips with the icon beside the text, which truncated
  // the day and the range. The strip must use the tiles for every width.
  assert.doesNotMatch(
    weatherStylesSource,
    /dashboard-widget \(max-width: 24rem\) and \(min-height: 10\.1rem\)/,
  );
  assert.match(
    weatherHeightBands,
    /dashboard-weather-forecast > \* \{\s*flex-direction: column;/,
  );
});

test('scales the medium-height current conditions so the meta line stays inside', () => {
  // The card keeps the strip in this height range, so the icon and the
  // temperature have to shrink with the card height; otherwise the wind/UV line
  // is clipped by the bottom edge. Both ramps meet the proportional sizes below
  // the range and the full sizes above it, so nothing jumps at either edge.
  assert.match(
    weatherHeightBands,
    /dashboard-weather-current \.dashboard-weather-icon \{\s*width: clamp\(2rem, calc\(51cqh - 2\.64rem\), 4rem\);/,
  );
  assert.match(
    weatherHeightBands,
    /dashboard-weather-current \.dashboard-weather-temperature \{\s*font-size: clamp\(1\.05rem, calc\(3\.92cqh \+ 0\.99rem\), 1\.5rem\);/,
  );
});

test('stacks the medium-height strip instead of truncating it on narrow cards', () => {
  const narrowBand = containerQueryBlocks(
    weatherStylesSource,
    'dashboard-widget (min-width: 14.1rem) and (max-width: 18rem) and',
  );
  assert.match(
    narrowBand,
    /dashboard-weather-forecast \{\s*grid-template-columns: minmax\(0, 1fr\);/,
  );
  assert.match(
    weatherStylesSource,
    /dashboard-widget \(max-width: 21rem\) and\s+\(min-height: 10rem\) and \(max-height: 13rem\)/,
  );
  assert.match(
    weatherStylesSource,
    /dashboard-widget \(max-width: 12rem\) and \(min-height: 10rem\) \{[\s\S]*?font-size: 0\.6rem;/,
  );
});

test('drops the humidity reading before the sensor sparkline is squeezed', () => {
  // The sparkline band is the chip's leftover space, so both readings plus the
  // chip padding leave nothing for the trend line. The humidity has to go
  // first, and the chip has to compact before the band is squeezed away.
  assert.match(
    weatherStylesSource,
    /@container dashboard-widget \(max-height: 13rem\) \{\s*\.dashboard-sensor-chip \.dashboard-sensor-humidity \{\s*display: none;/,
  );
  assert.match(
    weatherStylesSource,
    /@container dashboard-widget \(max-height: 11\.5rem\) \{[\s\S]*?\.dashboard-sensor-chip \{\s*padding: 0\.4rem 0\.5rem;/,
  );
});

test('drops the sensor sparkline instead of squeezing it into a sliver', () => {
  // The band is its own query container, so the sparkline disappears whenever
  // the band cannot hold a readable line, whatever the card size is.
  assert.match(sensorChipSource, /dashboard-sensor-sparkline-band/);
  assert.match(
    weatherStylesSource,
    /\.dashboard-sensor-sparkline-band \{\s*container: sensor-sparkline \/ size;/,
  );
  assert.match(
    weatherStylesSource,
    /@container sensor-sparkline \(max-height: 1rem\) \{\s*\.dashboard-sensor-sparkline \{\s*display: none;/,
  );
});

test('gives the two-column sensor preview its own thresholds', () => {
  // A narrow viewport wraps the preview into two columns and halves each chip,
  // so the humidity and the compact rows have to kick in much sooner there.
  assert.match(
    weatherStylesSource,
    /@media \(max-width: 599\.98px\) \{[\s\S]*?@container dashboard-widget \(min-width: 24\.1rem\) and \(max-height: 18\.25rem\)/,
  );
  assert.match(
    weatherStylesSource,
    /@media \(max-width: 599\.98px\) \{[\s\S]*?@container dashboard-widget \(min-width: 24\.1rem\) and \(max-height: 14rem\)/,
  );
});
