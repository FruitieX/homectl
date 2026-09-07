const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(name) {
  const source = fs.readFileSync(path.join(__dirname, '../lib', name + '.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const module = { exports: {} };
  new Function('module', 'exports', compiled.outputText)(module, module.exports);
  return module.exports;
}
const { calculateTemperatureStats: temperature, calculateHumidityStats: humidity } = load('sensorStats');
const { latestTemperature, priceWindow, precipitationPeriods } = load('widgetData');
const now = Date.UTC(2026, 8, 7, 12);
const readings = (slope) => Array.from({ length: 7 }, (_, i) => ({ time: new Date(now - (6-i)*600000), value: 20 + slope*i/6 }));
test('trends account for elapsed time, ordering and direction', () => {
  assert.equal(temperature(readings(1).reverse(), now).trend, 'up');
  assert.equal(temperature(readings(-1), now).trend, 'down');
  assert.equal(temperature(readings(0.1), now).trend, 'stable');
  assert.equal(humidity(readings(0.5), now).trend, 'stable');
  assert.equal(humidity(readings(3), now).trend, 'up');
});
test('isolated spikes and bursts do not create a trend', () => {
  const rows = readings(0); rows[3].value = 100;
  assert.equal(temperature(rows, now).trend, 'stable');
  assert.equal(temperature([...readings(1), ...Array(50).fill(readings(1)[2])], now).trend, 'up');
});
test('sparse, stale and gapped readings are unknown, not steady', () => {
  assert.equal(temperature(readings(1).slice(-3), now).trend, 'unknown');
  assert.equal(temperature(readings(1), now + 3600000).trend, 'unknown');
  assert.equal(temperature(readings(1).filter((_, i) => i < 2 || i > 4), now).trend, 'unknown');
  assert.equal(temperature([], now), null);
});
test('weather temperature excludes humidity and retains zero', () => {
  const rows = [{ device_id:'yard', _field:'tempc', _time:new Date(now), _value:0 }, { device_id:'yard', _field:'hum', _time:new Date(now), _value:85 }];
  assert.equal(latestTemperature(rows, 'yard', now), 0);
  assert.equal(latestTemperature(rows, 'yard', now + 3600000), undefined);
});
test('prices identify current intervals, preserve negatives and do not stretch stale data', () => {
  const rows = [0,1,2].map((i) => ({_time:new Date(now+i*900000), _value:i-1}));
  const result=priceWindow(rows, now+450000);
  assert.equal(result.current.value, -1);
  assert.equal(result.data.at(-1).end, now+2700000);
  assert.equal(result.average, 0.2);
  assert.equal(priceWindow(rows, now+3600000).current, undefined);
  assert.equal(priceWindow([], now).average, undefined);
});
test('precipitation keeps dry hours, missing uncertainty and nonoverlapping periods', () => {
  const period=(amount,max)=>({details:{precipitation_amount:amount,precipitation_amount_max:max}});
  const rows=[
    {time:new Date(now),data:{next_1_hours:period(0),next_6_hours:period(9,12)}},
    {time:new Date(now+3600000),data:{next_6_hours:period(2,4)}},
    {time:new Date(now+7200000),data:{next_6_hours:period(3,5)}},
  ];
  const result=precipitationPeriods(rows);
  assert.equal(result.length,2);
  assert.equal(result[0].precipitation_amount,0);
  assert.equal(result[0].precipitation_amount_max,undefined);
  assert.equal(result[1].period_hours,6);
  assert.equal(result[1].precipitation_amount_max,4);
});
