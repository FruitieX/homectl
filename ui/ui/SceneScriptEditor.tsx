'use client';

import Editor from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { useEffect, useId, useState } from 'react';

interface SceneScriptBindingOption {
  key: string;
  label?: string;
}

interface SceneScriptEditorProps {
  deviceOptions: SceneScriptBindingOption[];
  groupOptions: SceneScriptBindingOption[];
  sceneIds: string[];
  value: string;
  onChange: (value: string) => void;
}

type MonacoApi = typeof MonacoEditor;

type CompletionContext =
  | 'general'
  | 'device-members'
  | 'group-members'
  | 'scene-result-keys'
  | 'native-members';

function quote(value: string) {
  return JSON.stringify(value);
}

function buildStringLiteralUnion(values: string[]) {
  if (values.length === 0) {
    return 'string';
  }

  return values.map((value) => quote(value)).join(' | ');
}

function escapeDocComment(value: string) {
  return value.replace(/\*\//g, '*\\/');
}

function indentBlock(value: string) {
  return value
    .split('\n')
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join('\n');
}

function buildBindingDescription(kind: 'device' | 'group', key: string, label?: string) {
  if (label && label !== key) {
    return `Live ${kind} binding for ${label} (${key}).`;
  }

  return `Live ${kind} binding for ${key}.`;
}

function buildDevicesDeclaration(deviceOptions: SceneScriptBindingOption[]) {
  if (deviceOptions.length === 0) {
    return 'declare const devices: Record<string, DeviceBinding>;';
  }

  const properties = deviceOptions
    .map(({ key, label }) => {
      if (label && label !== key) {
        return `  /** ${escapeDocComment(label)} */\n  ${quote(key)}: DeviceBinding;`;
      }

      return `  ${quote(key)}: DeviceBinding;`;
    })
    .join('\n');

  return [
    'declare const devices: Record<string, DeviceBinding> & {',
    properties,
    '};',
  ].join('\n');
}

function buildGroupsDeclaration(groupOptions: SceneScriptBindingOption[]) {
  if (groupOptions.length === 0) {
    return 'declare const groups: Record<string, GroupBinding>;';
  }

  const properties = groupOptions
    .map(({ key, label }) => {
      if (label && label !== key) {
        return `  /** ${escapeDocComment(label)} */\n  ${quote(key)}: GroupBinding;`;
      }

      return `  ${quote(key)}: GroupBinding;`;
    })
    .join('\n');

  return [
    'declare const groups: Record<string, GroupBinding> & {',
    properties,
    '};',
  ].join('\n');
}

function buildSceneScriptTypes(
  deviceOptions: SceneScriptBindingOption[],
  groupOptions: SceneScriptBindingOption[],
  sceneIds: string[],
) {
  const deviceKeys = deviceOptions.map((option) => option.key);
  const groupIds = groupOptions.map((option) => option.key);

  const body = [
    'type DeviceKey = ' + buildStringLiteralUnion(deviceKeys) + ';',
    'type GroupId = ' + buildStringLiteralUnion(groupIds) + ';',
    'type SceneId = ' + buildStringLiteralUnion(sceneIds) + ';',
    '',
    'interface XyColor {',
    '  Xy: { x: number; y: number };',
    '}',
    '',
    'interface DeviceBinding {',
    '  id: string;',
    '  name: string;',
    '  integration_id: string;',
    '  data: DeviceDataBinding;',
    '  raw: Record<string, unknown> | null;',
    '}',
    '',
    'interface HsColor {',
    '  h: number;',
    '  s: number;',
    '}',
    '',
    'interface RgbColor {',
    '  r: number;',
    '  g: number;',
    '  b: number;',
    '}',
    '',
    'interface CtColor {',
    '  ct: number;',
    '}',
    '',
    'type LiveDeviceColor = XyColor | HsColor | RgbColor | CtColor;',
    '',
    'interface ControllableBindingState {',
    '  power: boolean;',
    '  brightness: number | null;',
    '  color: LiveDeviceColor | null;',
    '  transition: number | null;',
    '}',
    '',
    'interface ControllableBinding {',
    '  scene_id: string | null;',
    '  capabilities?: unknown;',
    '  managed?: unknown;',
    '  state: ControllableBindingState;',
    '}',
    '',
    'type SensorBinding = { value: boolean | string | number } | ControllableBindingState;',
    '',
    'type DeviceDataBinding =',
    '  | { Controllable: ControllableBinding }',
    '  | { Sensor: SensorBinding };',
    '',
    'interface GroupBinding {',
    '  name: string;',
    '  power: boolean;',
    '  scene_id: string | null;',
    '}',
    '',
    'type SceneColor = XyColor | HsColor | RgbColor | CtColor;',
    '',
    'interface SceneDeviceState {',
    '  power?: boolean;',
    '  brightness?: number;',
    '  transition?: number;',
    '  color?: SceneColor;',
    '}',
    '',
    'interface SceneDeviceLink {',
    '  integration_id: string;',
    '  device_id?: string;',
    '  brightness?: number;',
    '}',
    '',
    'interface SceneLinkConfig {',
    '  scene_id: SceneId;',
    '  device_keys?: DeviceKey[];',
    '  group_keys?: GroupId[];',
    '}',
    '',
    'type SceneTargetConfig = SceneDeviceState | SceneDeviceLink | SceneLinkConfig;',
    'type SceneScriptResult = Partial<Record<DeviceKey | string, SceneTargetConfig>>;',
    '',
    'declare function defineSceneScript(factory: () => SceneScriptResult): SceneScriptResult;',
    'declare function deviceState(config: SceneDeviceState): SceneDeviceState;',
    'declare function deviceLink(config: SceneDeviceLink): SceneDeviceLink;',
    'declare function sceneLink(config: SceneLinkConfig): SceneLinkConfig;',
    '',
    buildDevicesDeclaration(deviceOptions),
    buildGroupsDeclaration(groupOptions),
  ].join('\n');

  return ['declare global {', indentBlock(body), '}', '', 'export {};'].join(
    '\n',
  );
}

function findPreviousNonEmptyLine(
  model: MonacoEditor.editor.ITextModel,
  lineNumber: number,
) {
  for (let currentLine = lineNumber - 1; currentLine >= 1; currentLine -= 1) {
    const line = model.getLineContent(currentLine).trim();
    if (line.length > 0) {
      return line;
    }
  }

  return '';
}

function getCompletionContext(
  model: MonacoEditor.editor.ITextModel,
  position: MonacoEditor.Position,
): CompletionContext {
  const linePrefix = model.getValueInRange({
    startLineNumber: position.lineNumber,
    startColumn: 1,
    endLineNumber: position.lineNumber,
    endColumn: position.column,
  });
  const trimmed = linePrefix.trimEnd();
  const currentLineTrimmed = linePrefix.trim();
  const previousNonEmptyLine = findPreviousNonEmptyLine(model, position.lineNumber);

  if (trimmed.endsWith('devices.')) {
    return 'device-members';
  }

  if (trimmed.endsWith('groups.')) {
    return 'group-members';
  }

  if (
    /\b(?:deviceState|deviceLink|sceneLink)\(\{$/.test(trimmed) ||
    /\b(?:deviceState|deviceLink|sceneLink)\(\{$/.test(previousNonEmptyLine)
  ) {
    return 'native-members';
  }

  if (currentLineTrimmed.length === 0) {
    if (
      /(?:return|const\s+\w+\s*=)\s*\{$/.test(previousNonEmptyLine)
    ) {
      return 'scene-result-keys';
    }

    if (previousNonEmptyLine.endsWith('{')) {
      return 'native-members';
    }
  }

  if (trimmed.endsWith('.') || trimmed.endsWith('?.')) {
    return 'native-members';
  }

  if (
    /^['"][^'"]*$/.test(currentLineTrimmed) &&
    /(?:return|const\s+\w+\s*=)\s*\{$/.test(previousNonEmptyLine)
  ) {
    return 'scene-result-keys';
  }

  return 'general';
}

function buildBindingLabel(insertText: string, label?: string) {
  return label && label !== insertText
    ? { description: label, label: insertText }
    : insertText;
}

function buildDeviceBindingCompletions(
  monaco: MonacoApi,
  deviceOptions: SceneScriptBindingOption[],
  context: CompletionContext,
) {
  const useMemberInsert = context === 'device-members';

  return deviceOptions.map(({ key, label }, index) => {
    const insertText = useMemberInsert ? `[${quote(key)}]` : `devices[${quote(key)}]`;

    return {
      label: buildBindingLabel(insertText, label),
      kind: useMemberInsert
        ? monaco.languages.CompletionItemKind.Property
        : monaco.languages.CompletionItemKind.Constant,
      insertText,
      detail: label && label !== key ? `Device binding: ${label}` : 'Device binding',
      documentation: buildBindingDescription('device', key, label),
      filterText: `${insertText} ${key} ${label ?? ''}`,
      sortText: `1${String(index).padStart(4, '0')}`,
    };
  });
}

function buildGroupBindingCompletions(
  monaco: MonacoApi,
  groupOptions: SceneScriptBindingOption[],
  context: CompletionContext,
) {
  const useMemberInsert = context === 'group-members';

  return groupOptions.map(({ key, label }, index) => {
    const insertText = useMemberInsert ? `[${quote(key)}]` : `groups[${quote(key)}]`;

    return {
      label: buildBindingLabel(insertText, label),
      kind: useMemberInsert
        ? monaco.languages.CompletionItemKind.Property
        : monaco.languages.CompletionItemKind.Constant,
      insertText,
      detail: label && label !== key ? `Group binding: ${label}` : 'Group binding',
      documentation: buildBindingDescription('group', key, label),
      filterText: `${insertText} ${key} ${label ?? ''}`,
      sortText: `2${String(index).padStart(4, '0')}`,
    };
  });
}

function buildSceneScriptCompletions(
  monaco: MonacoApi,
  deviceOptions: SceneScriptBindingOption[],
  groupOptions: SceneScriptBindingOption[],
  sceneIds: string[],
  context: CompletionContext,
) {
  const snippet = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  const deviceKeys = deviceOptions.map((option) => option.key);
  const groupIds = groupOptions.map((option) => option.key);

  if (context === 'native-members') {
    return [];
  }

  if (context === 'scene-result-keys') {
    return deviceOptions.map(({ key, label }, index) => ({
      label: buildBindingLabel(quote(key), label),
      kind: monaco.languages.CompletionItemKind.Property,
      insertTextRules: snippet,
      insertText:
        `${quote(key)}: deviceState({\n  power: \${1:true},\n  brightness: \${2:0.5},\n}),`,
      detail: label && label !== key ? `Scene target: ${label}` : 'Scene target',
      documentation: `Create an override entry for ${label && label !== key ? `${label} (${key})` : key}.`,
      filterText: `${key} ${label ?? ''}`,
      sortText: `0${String(index).padStart(4, '0')}`,
    }));
  }

  if (context === 'device-members') {
    return buildDeviceBindingCompletions(monaco, deviceOptions, context);
  }

  if (context === 'group-members') {
    return buildGroupBindingCompletions(monaco, groupOptions, context);
  }

  const completions = [
    {
      label: 'devices',
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: 'devices',
      detail: 'Global device state map',
      documentation: 'Live device bindings available to scene scripts.',
      sortText: '0000',
    },
    {
      label: 'groups',
      kind: monaco.languages.CompletionItemKind.Variable,
      insertText: 'groups',
      detail: 'Global group state map',
      documentation: 'Live group bindings available to scene scripts.',
      sortText: '0001',
    },
    {
      label: 'typed scene script',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: snippet,
      insertText:
        'defineSceneScript(() => {\n  /** @type {SceneScriptResult} */\n  const overrides = {\n    ${1:' +
        quote(deviceKeys[0] ?? 'integration/device') +
        '}: deviceState({\n      power: ${2:true},\n      brightness: ${3:0.5},\n    }),\n  };\n\n  return overrides;\n})',
      detail: 'Typed scene script snippet',
      documentation:
        'Wrap scene logic in defineSceneScript(() => ...) so return values and helper calls stay typed.',
      sortText: '0002',
    },
    {
      label: 'device state override',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: snippet,
      insertText:
        '{\n  power: ${1:true},\n  brightness: ${2:0.5},\n  transition: ${3:0.4},\n}',
      detail: 'Direct device state override',
      documentation: 'SceneDeviceState fields supported by the runtime.',
      sortText: '0003',
    },
    {
      label: 'device link override',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: snippet,
      insertText:
        '{\n  integration_id: ${1:' +
        quote((deviceKeys[0] ?? 'integration/device').split('/')[0] ?? 'integration') +
        '},\n  device_id: ${2:' +
        quote((deviceKeys[0] ?? 'integration/device').split('/')[1] ?? 'device') +
        '},\n  brightness: ${3:1},\n}',
      detail: 'Link scene target to another device',
      documentation: 'SceneDeviceLink fields supported by the runtime.',
      sortText: '0004',
    },
    {
      label: 'scene link override',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: snippet,
      insertText:
        '{\n  scene_id: ${1:' +
        quote(sceneIds[0] ?? 'scene-id') +
        '},\n  device_keys: [${2:' +
        quote(deviceKeys[0] ?? 'integration/device') +
        '}],\n  group_keys: [${3:' +
        quote(groupIds[0] ?? 'group-id') +
        '}],\n}',
      detail: 'Link scene target to another scene',
      documentation: 'SceneLinkConfig fields supported by the runtime.',
      sortText: '0005',
    },
    {
      label: 'HS color',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: snippet,
      insertText: '{ h: ${1:30}, s: ${2:1} }',
      detail: 'Hue/saturation color',
      sortText: '0006',
    },
    {
      label: 'RGB color',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: snippet,
      insertText: '{ r: ${1:255}, g: ${2:200}, b: ${3:120} }',
      detail: 'RGB color',
      sortText: '0007',
    },
    {
      label: 'CT color',
      kind: monaco.languages.CompletionItemKind.Snippet,
      insertTextRules: snippet,
      insertText: '{ ct: ${1:300} }',
      detail: 'Color temperature',
      sortText: '0008',
    },
    ...buildDeviceBindingCompletions(monaco, deviceOptions, context),
    ...buildGroupBindingCompletions(monaco, groupOptions, context),
    ...sceneIds.map((sceneId, index) => ({
      label: `scene_id: ${sceneId}`,
      kind: monaco.languages.CompletionItemKind.Value,
      insertText: quote(sceneId),
      detail: 'Scene identifier',
      documentation: `Insert the scene id ${sceneId}.`,
      sortText: `3${String(index).padStart(4, '0')}`,
    })),
  ];

  return completions;
}

export default function SceneScriptEditor({
  deviceOptions,
  groupOptions,
  sceneIds,
  value,
  onChange,
}: SceneScriptEditorProps) {
  const editorId = useId().replace(/:/g, '-');
  const [monaco, setMonaco] = useState<typeof MonacoEditor | null>(null);

  useEffect(() => {
    if (!monaco) {
      return undefined;
    }

    const monacoApi = monaco as typeof MonacoEditor;
    const javascriptDefaults = monacoApi.typescript.javascriptDefaults;
    javascriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      checkJs: true,
      lib: ['es2020'],
      noLib: false,
      strict: false,
      target: monacoApi.typescript.ScriptTarget.ES2020,
    });
    javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    const extraLibDisposable = javascriptDefaults.addExtraLib(
      buildSceneScriptTypes(deviceOptions, groupOptions, sceneIds),
      `file:///scene-script-${editorId}.d.ts`,
    );
    const completionProvider = monaco.languages.registerCompletionItemProvider(
      'javascript',
      {
        triggerCharacters: ['.', '[', '"', "'", '{'],
        provideCompletionItems(model, position) {
          const completionContext = getCompletionContext(model, position);
          const word = model.getWordUntilPosition(position);
          const range = {
            startColumn: word.startColumn,
            endColumn: word.endColumn,
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
          };

          return {
            suggestions: buildSceneScriptCompletions(
              monaco,
              deviceOptions,
              groupOptions,
              sceneIds,
              completionContext,
            ).map((item) => ({
              range,
              ...item,
            })),
          };
        },
      },
    );

    return () => {
      completionProvider.dispose();
      extraLibDisposable.dispose();
    };
  }, [deviceOptions, editorId, groupOptions, monaco, sceneIds]);

  return (
    <div className="overflow-hidden rounded-xl border border-base-300 bg-base-100/70">
      <Editor
        defaultLanguage="javascript"
        height="24rem"
        language="javascript"
        onMount={(_editor, mountedMonaco) => {
          setMonaco(mountedMonaco as typeof MonacoEditor);
        }}
        options={{
          automaticLayout: true,
          fontSize: 13,
          lineNumbersMinChars: 3,
          minimap: { enabled: false },
          padding: { top: 16, bottom: 16 },
          scrollBeyondLastLine: false,
          tabSize: 2,
          wordWrap: 'on',
        }}
        theme="vs-dark"
        value={value}
        onChange={(nextValue) => onChange(nextValue ?? '')}
      />
    </div>
  );
}