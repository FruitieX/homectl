const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const readUiSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const dashboardSource = readUiSource('app/dashboard/page.tsx');
const editorSource = readUiSource('ui/DashboardGridEditor.tsx');
const navbarSource = readUiSource('ui/Navbar.tsx');
const settingsSource = readUiSource('ui/DashboardSettingsOverlay.tsx');
const routesSource = readUiSource('src/routes.tsx');
const configSectionsSource = readUiSource('app/config/sections.ts');
const gridSettingsPath = path.join(
  __dirname,
  '..',
  'hooks/dashboardEditing.ts',
);
const gridSettingsSource = fs.existsSync(gridSettingsPath)
  ? fs.readFileSync(gridSettingsPath, 'utf8')
  : '';

test('dashboard editing exposes settings from the AppMenu instead of config dashboard', () => {
  assert.match(navbarSource, /settings=1/);
  assert.match(navbarSource, /Dashboard editing settings/);
  assert.match(navbarSource, /Add dashboard widget/);
  assert.match(dashboardSource, /DashboardSettingsOverlay/);
  assert.match(dashboardSource, /searchParams\.get\('add-widget'\)/);
  assert.doesNotMatch(settingsSource, /title="Widgets"/);
  assert.doesNotMatch(settingsSource, /DashboardGridEditor/);
  assert.doesNotMatch(settingsSource, /WidgetOverlay/);
  assert.doesNotMatch(dashboardSource, /Link to="\/config\/dashboard"/);
  assert.doesNotMatch(routesSource, /ConfigDashboardPage/);
  assert.doesNotMatch(
    configSectionsSource,
    /href: ['"]\/config\/dashboard['"]/,
  );
});

test('dashboard editing keeps the normal card surface and removes editor notices', () => {
  assert.match(dashboardSource, /DashboardGridEditor[\s\S]*variant="inline"/);
  assert.doesNotMatch(dashboardSource, /Editing dashboard/);
  assert.doesNotMatch(editorSource, /Visual dashboard editor/);
  assert.doesNotMatch(editorSource, /rounded-3xl border border-dashed/);
  assert.doesNotMatch(editorSource, /dashboard-editor-card/);
  assert.doesNotMatch(editorSource, /dashboard-layout-item[\s\S]*\*:\s*h-full/);
  assert.match(
    editorSource,
    /absolute bottom-2 right-2[^\n]*size-10[^\n]*touch-none/,
  );
});

test('resize feedback is centered on the active card', () => {
  assert.match(editorSource, /activeInteractionKind/);
  assert.match(editorSource, /activeInteractionKind === 'resize'/);
  assert.match(editorSource, /place-items-center/);
  assert.match(editorSource, /tabular-nums/);
  assert.match(editorSource, /touch-none select-none/);
  assert.match(editorSource, /setPointerCapture\(event\.pointerId\)/);
});

test('dashboard editing settings default to the device viewport and quarter-unit snapping', () => {
  assert.match(gridSettingsSource, /screenSimulation: 'device'/);
  assert.match(gridSettingsSource, /gridSnap: 0\.25/);
  assert.match(editorSource, /screenSimulation/);
  assert.match(editorSource, /gridSnap/);
});
