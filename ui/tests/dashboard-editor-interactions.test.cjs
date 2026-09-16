const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const readUiSource = (relativePath) =>
  fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const dashboardSource = readUiSource('app/dashboard/page.tsx');
const editorSource = readUiSource('ui/DashboardGridEditor.tsx');
const configDashboardSource = readUiSource('app/config/dashboard/page.tsx');

test('inline widget edit opens the widget settings overlay', () => {
  assert.match(dashboardSource, /WidgetOverlay/);
  assert.match(dashboardSource, /onEdit=\{setEditingWidget\}/);
  assert.match(dashboardSource, /updateWidget\(editingWidget\.id, updated\)/);
  assert.doesNotMatch(
    dashboardSource,
    /onEdit=\{\(\) => navigate\('\/config\/dashboard'\)\}/,
  );
});

test('dashboard editing does not render editor notices', () => {
  assert.doesNotMatch(dashboardSource, /Editing dashboard/);
  assert.doesNotMatch(editorSource, /Visual dashboard editor/);
  assert.doesNotMatch(configDashboardSource, /visual editor/);
});

test('resize handle captures touch input without allowing text selection', () => {
  assert.match(editorSource, /touch-none select-none/);
  assert.match(editorSource, /setPointerCapture\(event\.pointerId\)/);
});
