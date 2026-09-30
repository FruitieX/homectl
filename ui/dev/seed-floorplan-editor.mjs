/** Rich synthetic floorplan for visual comparison; fixture server only. */
import { readFile } from 'node:fs/promises';
const origin = process.env.FLOORPLAN_FIXTURE_ORIGIN ?? 'http://127.0.0.1:45921';
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin))
  throw Error('Loopback fixture only.');
const endpoint = '/api/v1/config/floorplans/ground_floor/editor';
const marker = await fetch(origin + endpoint);
if (marker.headers.get('x-homectl-fixture') !== 'true')
  throw Error('Fixture marker missing.');
await fetch(origin + '/__fixture/normal', { method: 'POST' });
const saved = (await (await fetch(origin + endpoint)).json()).data;
const devices = (await (await fetch(origin + '/api/v1/devices')).json())
  .devices;
const choose = (text) =>
  devices.find((d) => d.name.toLowerCase().includes(text));
const selected = [
  choose('living room lamp'),
  choose('kitchen pendant'),
  choose('temperature') ?? choose('outdoor'),
  choose('motion'),
  choose('bedroom lamp'),
  choose('kitchen counter'),
];
if (selected.some((d) => !d)) throw Error('Fixture devices missing.');
const keys = selected.map((d) => `${d.integration_id}/${d.id}`),
  positions = [
    [7.5, 7.5],
    [20.5, 5.5],
    [23.5, 7.5],
    [9.5, 13.5],
    [18, 14.5],
    [25, 14],
  ];
const rooms = [
  ['living_room', 'Living room', [4, 4, 15, 11], [0]],
  ['kitchen', 'Kitchen', [16, 4, 27, 11], [1, 2]],
  ['hallway', 'Hallway', [4, 12, 15, 17], [3]],
  ['bedroom', 'Bedroom', [16, 12, 22, 17], [4]],
  ['bathroom', 'Bathroom', [24, 12, 27, 17], [5]],
];
const existing = (await (await fetch(origin + '/api/v1/config/groups')).json())
  .data;
for (const [id, name, , indices] of rooms) {
  const row = {
    id,
    name,
    hidden: false,
    devices: indices.map((i) => ({
      integration_id: selected[i].integration_id,
      device_id: selected[i].id,
    })),
    linked_groups: [],
    device_keys: indices.map((i) => keys[i]),
  };
  const before = existing.find((g) => g.id === id);
  const response = await fetch(
    origin + '/api/v1/config/groups' + (before ? '/' + id : ''),
    {
      method: before ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...row,
        ...(before
          ? {
              expected: Object.fromEntries(
                Object.entries(before).filter(([key]) => key !== 'device_keys'),
              ),
            }
          : {}),
      }),
    },
  );
  if (!response.ok) throw Error(await response.text());
}
const study = await readFile(
  new URL(
    '../../docs/settings-overhaul-2026-09/floorplan-editor.js',
    import.meta.url,
  ),
  'utf8',
);
const architecture = study
  .slice(study.indexOf('function drawArchitecture()'))
  .match(/`([^`]+)`/s)?.[1];
if (!architecture || architecture.includes('${'))
  throw Error('Static study architecture changed.');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">${architecture}</svg>`;
const masks = Object.fromEntries(
  rooms.map(([id, , [x1, y1, x2, y2]]) => {
    const points = [];
    for (let y = y1; y <= y2; y++)
      for (let x = x1; x <= x2; x++) points.push({ x, y });
    return [id, points];
  }),
);
const grid = {
  width: 32,
  height: 20,
  tileSize: 30,
  deviceScale: 1,
  labelMode: 'all',
  tiles: Array.from({ length: 20 }, () => Array(32).fill('floor')),
  groups: masks,
  devices: selected.map((d, i) => ({
    deviceKey: keys[i],
    deviceName: d.name,
    x: positions[i][0],
    y: positions[i][1],
  })),
  future: { keep: [2, 1] },
};
const response = await fetch(origin + endpoint, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    ...saved,
    name: 'Ground floor',
    grid_data: JSON.stringify(grid),
    image: {
      kind: 'upload',
      mime_type: 'image/svg+xml',
      data_base64: Buffer.from(svg).toString('base64'),
    },
    expected: saved.revision_token,
  }),
});
if (!response.ok) throw Error(await response.text());
console.log(
  'Seeded synthetic floorplan, five room masks and six real fixture placements.',
);
