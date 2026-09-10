const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const Color = require('color');

// Exercise rendered controls and event handlers without contacting devices.
function harness(data, temperatureOnly = false, calibrated = false) {
  let cursor = 0;
  const state = [];
  const commands = [];
  const context = {
    exports: {},
    require(name) {
      if (name === '@/hooks/useConfig')
        return {
          useDeviceColorCalibrations: () => ({
            loading: false,
            data: calibrated ? [{ device_key: 'mqtt/lamp', points: [{}] }] : [],
          }),
        };
      if (name === 'react')
        return {
          useEffect() {},
          useMemo(factory) {
            return factory();
          },
          useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [
              state[index],
              (value) => {
                state[index] = value;
              },
            ];
          },
        };
      if (name === '@/lib/colors') return { getColor: () => Color('#66bb88') };
      if (name === '@/lib/deviceCapabilities')
        return {
          isDeviceReadOnly: (d) => Boolean(d.data.Controllable.disabled),
        };
      if (name.endsWith('/slider')) return { Slider: 'slider' };
      if (name.endsWith('/button')) return { Button: 'button' };
      return require(name);
    },
  };
  vm.runInNewContext(
    ts.transpileModule(
      fs.readFileSync(require.resolve('../ui/DeviceColorMode.tsx'), 'utf8'),
      {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          esModuleInterop: true,
          jsx: ts.JsxEmit.ReactJSX,
          target: ts.ScriptTarget.ES2022,
        },
      },
    ).outputText,
    context,
  );
  return {
    commands,
    render() {
      cursor = 0;
      const nodes = [];
      function walk(node) {
        if (Array.isArray(node)) return node.forEach(walk);
        if (!node || typeof node !== 'object') return;
        nodes.push(node);
        walk(node.props?.children);
      }
      walk(
        context.exports.DeviceColorMode({
          devices: [
            {
              id: 'lamp',
              integration_id: 'mqtt',
              data: { Controllable: data },
            },
          ],
          connected: true,
          temperatureOnly,
          onChange: (...args) => commands.push(args),
        }),
      );
      return nodes;
    },
  };
}
const fixture = () => ({
  capabilities: {
    ct: { start: 2200, end: 6500 },
    hs: true,
    xy: true,
    rgb: false,
  },
  state: { power: false, color: { ct: 3000 } },
  requested_at_ms: 100,
  last_report: {
    retained: false,
    received_at_ms: 90,
    state: { color: { x: 0.3, y: 0.3 } },
  },
});
const sliders = (nodes) => nodes.filter((n) => n.type === 'slider');

test('calibrated lamps edit reference HSV instead of already-corrected reports', () => {
  const data = fixture();
  data.state.color = { h: 30, s: 0.25 };
  data.last_report.received_at_ms = 110;
  data.last_report.state.color = { h: 55, s: 0.1 };
  const h = harness(data, false, true);
  const controls = sliders(h.render());
  assert.equal(controls[0].props.value[0], 30);
  assert.equal(controls[1].props.value[0], 0.25);
});

test('XY adjustments keep the other coordinate and track scale fixed', () => {
  const data = fixture();
  data.last_report.received_at_ms = 110;
  const h = harness(data);
  let controls = sliders(h.render());
  controls[0].props.onValueChange([0.5]);
  controls = sliders(h.render());
  assert.equal(controls[0].props.value[0], 0.5);
  assert.equal(controls[1].props.value[0], 0.3);
  assert.equal(controls[1].props.max, 1);
  controls[1].props.onValueChange([0.4]);
  controls = sliders(h.render());
  assert.equal(controls[0].props.value[0], 0.5);
  assert.equal(controls[0].props.max, 1);
  assert.equal(controls[1].props.value[0], 0.4);
  controls[0].props.onValueCommit([0.9]);
  const sent = h.commands[0][3];
  assert.equal(sent.y, 0.4);
  assert.equal(sent.x, 0.6);
});

test('mode selection changes controls immediately and only commits slider releases', () => {
  const h = harness(fixture());
  let nodes = h.render();
  assert.equal(sliders(nodes)[0].props['aria-label'], 'Color temperature');
  assert.deepEqual(
    nodes.filter((n) => n.type === 'option').map((n) => n.props.value),
    ['', 'ct', 'hs', 'xy'],
  );
  nodes
    .find((n) => n.type === 'select')
    .props.onChange({ target: { value: 'hs' } });
  nodes = h.render();
  assert.deepEqual(
    sliders(nodes).map((n) => n.props['aria-label']),
    ['Hue', 'Saturation'],
  );
  assert.equal(h.commands.length, 1);
  sliders(nodes)[0].props.onValueChange([125]);
  nodes = h.render();
  assert.equal(h.commands.length, 1);
  assert.equal(sliders(nodes)[0].props.value[0], 125);
  sliders(nodes)[0].props.onValueCommit([125]);
  assert.equal(h.commands.length, 2);
  assert.equal(h.commands[1][1], false);
  assert.equal(h.commands[1][3].h, 125);
  nodes
    .find((n) => n.type === 'select')
    .props.onChange({ target: { value: 'xy' } });
  assert.deepEqual(
    sliders(h.render()).map((n) => n.props['aria-label']),
    ['X', 'Y'],
  );
});

test('fresh reported mode is reflected and temperature tab is independently available', () => {
  const data = fixture();
  data.last_report.received_at_ms = 110;
  assert.deepEqual(
    sliders(harness(data).render()).map((n) => n.props['aria-label']),
    ['X', 'Y'],
  );
  const nodes = harness(data, true).render();
  assert.equal(
    nodes.some((n) => n.type === 'select'),
    false,
  );
  assert.deepEqual(
    sliders(nodes).map((n) => n.props['aria-label']),
    ['Color temperature'],
  );
  data.capabilities.ct = null;
  assert.equal(harness(data, true).render().length, 0);
});
