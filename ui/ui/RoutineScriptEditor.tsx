import Editor from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { useEffect, useId, useRef, useState } from 'react';

import { Button } from '@/ui/primitives/button';

type MonacoApi = typeof MonacoEditor;

interface RoutineScriptEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
}

const BODY_HEADER = 'function __homectl_body() {';
const BODY_FOOTER = '}';

function wrapBody(body: string) {
  return `${BODY_HEADER}\n${body}\n${BODY_FOOTER}`;
}

function unwrapBody(text: string) {
  if (
    text.startsWith(`${BODY_HEADER}\n`) &&
    text.endsWith(`\n${BODY_FOOTER}`)
  ) {
    return text.slice(
      BODY_HEADER.length + 1,
      text.length - BODY_FOOTER.length - 1,
    );
  }
  return text;
}

const ROUTINE_CONTEXT_TYPES = `type HomectlUnknown = { kind: 'unknown'; reason?: unknown };
type HomectlDeviceRef = { integration_id: string; device_id: string };
type HomectlTargets = { devices?: HomectlDeviceRef[]; groups?: string[] };

interface HomectlActionSpec {
  /** Optional stable step id; defaults to a generated one. */
  id?: string;
}

interface HomectlActions {
  setPower(spec: HomectlActionSpec & { device: HomectlDeviceRef; power: boolean }): unknown;
  activateScene(spec: HomectlActionSpec & { scene?: string; select?: unknown; targets?: HomectlTargets }): unknown;
  dim(spec: HomectlActionSpec & { targets?: HomectlTargets; step: number; transitionMs?: number }): unknown;
  randomizeColor(spec: HomectlActionSpec & { targets: HomectlTargets; minSaturation?: number; maxSaturation?: number; transitionMs?: number }): unknown;
  setHelper(spec: HomectlActionSpec & { helper: string; value: unknown }): unknown;
  scheduleTimer(spec: HomectlActionSpec & { key: string; afterMs: number }): unknown;
  replaceTimer(spec: HomectlActionSpec & { key: string; afterMs: number }): unknown;
  cancelTimer(spec: HomectlActionSpec & { key: string }): unknown;
  invokeRoutine(spec: HomectlActionSpec & { routine: string; mode?: 'fire_and_forget' | 'await_completion' }): unknown;
}

declare const ctx: {
  /** Injected frame time (epoch milliseconds). */
  now_ms: number;
  seed: number;
  event: {
    frame_id: number;
    origin: unknown;
    causation: unknown;
    mutations: Array<{
      device: string;
      origin: unknown;
      before: unknown;
      after: unknown;
    }>;
  };
  /** Declared devices (plus devices mutated by the triggering frame). */
  before: { devices: Record<string, unknown> };
  after: { devices: Record<string, unknown> };
  values: { helpers: Record<string, { kind: string; value: unknown }> };
  state: { memory: Record<string, unknown>; revision: number };
};

declare const api: {
  /** Frame time as epoch milliseconds (Date.now() is frozen to this). */
  now: number;
  /** Deterministic seeded randomness; Math.random() is frozen to this. */
  random(): number;
  unknown(reason?: unknown): HomectlUnknown;
  not(value: boolean | HomectlUnknown): boolean | HomectlUnknown;
  values: {
    get(helperId: string): { kind: string; value: unknown } | undefined;
    requireEnum(helperId: string): string;
  };
  actions: HomectlActions;
  timers: {
    schedule: HomectlActions['scheduleTimer'];
    replace: HomectlActions['replaceTimer'];
    cancel: HomectlActions['cancelTimer'];
  };
};
`;

type CompletionEntry = {
  label: string;
  detail: string;
  insertText: string;
  documentation: string;
};

const ACTION_COMPLETIONS: CompletionEntry[] = [
  {
    label: 'activateScene',
    detail: 'activate_scene',
    insertText:
      "activateScene({ scene: '${1:scene_id}', targets: { groups: ['${2:group}'] } })",
    documentation: 'Activate a scene on the given targets.',
  },
  {
    label: 'setPower',
    detail: 'set_power',
    insertText:
      "setPower({ device: { integration_id: '${1:integration}', device_id: '${2:device}' }, power: ${3:true} })",
    documentation: 'Set one device on or off.',
  },
  {
    label: 'dim',
    detail: 'dim',
    insertText: 'dim({ targets: { devices: [] }, step: ${1:-0.1} })',
    documentation: 'Relative dim step in the -1.0..=1.0 range.',
  },
  {
    label: 'randomizeColor',
    detail: 'randomize_color',
    insertText:
      'randomizeColor({ targets: { devices: [] }, minSaturation: 0.2, maxSaturation: 1, transitionMs: ${1:250} })',
    documentation: 'Randomize hue and saturation once for the targets.',
  },
  {
    label: 'setHelper',
    detail: 'set_helper',
    insertText: "setHelper({ helper: '${1:helper_id}', value: ${2:null} })",
    documentation: 'Write a helper value.',
  },
  {
    label: 'scheduleTimer',
    detail: 'schedule_timer',
    insertText: "scheduleTimer({ key: '${1:timer}', afterMs: ${2:60000} })",
    documentation: 'Create a named timer; fails if one is live.',
  },
  {
    label: 'replaceTimer',
    detail: 'replace_timer',
    insertText: "replaceTimer({ key: '${1:timer}', afterMs: ${2:60000} })",
    documentation: 'Replace a named timer generation.',
  },
  {
    label: 'cancelTimer',
    detail: 'cancel_timer',
    insertText: "cancelTimer({ key: '${1:timer}' })",
    documentation: 'Cancel a named timer.',
  },
  {
    label: 'invokeRoutine',
    detail: 'invoke_routine',
    insertText: "invokeRoutine({ routine: '${1:routine_id}' })",
    documentation: 'Invoke another routine by id.',
  },
];

const API_COMPLETIONS: CompletionEntry[] = [
  ...ACTION_COMPLETIONS,
  {
    label: 'values',
    detail: 'helper values',
    insertText: "values.requireEnum('${1:helper_id}')",
    documentation: 'Read a helper value; requireEnum throws when unknown.',
  },
  {
    label: 'unknown',
    detail: 'three-valued logic',
    insertText: "unknown({ reason: '${1:missing}' })",
    documentation: 'Explicit unknown condition value.',
  },
  {
    label: 'now',
    detail: 'number',
    insertText: 'now',
    documentation: 'Injected frame time in epoch milliseconds.',
  },
  {
    label: 'random',
    detail: '() => number',
    insertText: 'random()',
    documentation: 'Deterministic seeded randomness.',
  },
];

const CONTEXT_COMPLETIONS: CompletionEntry[] = [
  {
    label: 'now_ms',
    detail: 'number',
    insertText: 'now_ms',
    documentation: 'Injected frame time in epoch milliseconds.',
  },
  {
    label: 'state',
    detail: 'memory and revision',
    insertText: 'state.memory',
    documentation: 'Per-owner bounded memory; return next_state to change it.',
  },
  {
    label: 'values',
    detail: 'helpers',
    insertText: 'values.helpers',
    documentation: 'Declared helper values keyed by helper id.',
  },
  {
    label: 'after',
    detail: 'devices',
    insertText: 'after.devices',
    documentation: 'Declared devices after the triggering frame.',
  },
  {
    label: 'before',
    detail: 'devices',
    insertText: 'before.devices',
    documentation: 'Declared devices before the triggering frame.',
  },
];

function completionContext(line: string): CompletionEntry[] | null {
  if (/(^|[^\w.])api\.actions\.\w*$/.test(line)) {
    return ACTION_COMPLETIONS;
  }
  if (/(^|[^\w.])api\.values\.\w*$/.test(line)) {
    return API_COMPLETIONS.filter((entry) => entry.label === 'values');
  }
  if (/(^|[^\w.])api\.\w*$/.test(line)) {
    return API_COMPLETIONS;
  }
  if (/(^|[^\w.])ctx\.\w*$/.test(line)) {
    return CONTEXT_COMPLETIONS;
  }
  return null;
}

export const ROUTINE_SCRIPT_STARTER = `// ctx is frozen: ctx.now_ms, ctx.state.memory, ctx.state.revision.
// api is pure: api.now, api.random(), api.actions.*.
const memory = ctx.state.memory;
return {
  actions: [],
  next_state: { runs: (memory.runs ?? 0) + 1 },
};
`;

export const ROUTINE_SCRIPT_FIXTURES: Array<{
  id: string;
  label: string;
  body: string;
}> = [
  {
    id: 'starter',
    label: 'Starter (memory counter)',
    body: ROUTINE_SCRIPT_STARTER,
  },
  {
    id: 'timer',
    label: 'Arm a named timer and a cooldown helper',
    body: `// Timers are plan operations; timer_fired triggers report the deadline.
return {
  actions: [
    api.actions.replaceTimer({ key: 'entryway_timer', afterMs: 300000 }),
    api.actions.setHelper({ helper: 'entryway_cooldown', value: true }),
  ],
};
`,
  },
  {
    id: 'randomize',
    label: 'Randomize a lamp color outside daytime',
    body: `// Seeded Date/Math.random keep runs deterministic per invocation.
var hour = new Date().getHours();
if (hour >= 7 && hour < 20) {
  return { actions: [] };
}
return {
  actions: [
    api.actions.randomizeColor({
      targets: {
        devices: [
          { integration_id: 'zigbee2mqtt', device_id: '0x0000000000000000' },
        ],
      },
      minSaturation: 0.2,
      maxSaturation: 1,
      transitionMs: 250,
    }),
  ],
};
`,
  },
  {
    id: 'mode',
    label: 'Read a mode helper before acting',
    body: `// api.values.requireEnum throws when the helper has no known value.
var mode = api.values.requireEnum('staircase_mode');
if (mode === 'away') {
  return { actions: [] };
}
return {
  actions: [
    api.actions.activateScene({
      scene: 'normal',
      targets: { groups: ['downstairs'] },
    }),
  ],
};
`,
  },
];

export default function RoutineScriptEditor({
  value,
  onChange,
  height = '24rem',
  readOnly = false,
}: RoutineScriptEditorProps) {
  const editorId = useId().replace(/:/g, '-');
  const [monaco, setMonaco] = useState<MonacoApi | null>(null);
  const [fixtureId, setFixtureId] = useState(ROUTINE_SCRIPT_FIXTURES[0].id);
  const editorRef = useRef<MonacoEditor.editor.IStandaloneCodeEditor | null>(
    null,
  );

  useEffect(() => {
    if (!monaco) {
      return undefined;
    }

    const javascriptDefaults = monaco.typescript.javascriptDefaults;
    javascriptDefaults.setCompilerOptions({
      allowNonTsExtensions: true,
      checkJs: true,
      lib: ['es2020'],
      noLib: false,
      strict: false,
      target: monaco.typescript.ScriptTarget.ES2020,
    });
    javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    });

    const extraLibDisposable = javascriptDefaults.addExtraLib(
      ROUTINE_CONTEXT_TYPES,
      `file:///routine-script-${editorId}.d.ts`,
    );
    const completionProvider = monaco.languages.registerCompletionItemProvider(
      'javascript',
      {
        triggerCharacters: ['.'],
        provideCompletionItems(model, position) {
          const line = model.getValueInRange({
            startLineNumber: position.lineNumber,
            startColumn: 1,
            endLineNumber: position.lineNumber,
            endColumn: position.column,
          });
          const entries = completionContext(line);
          if (!entries) {
            return { suggestions: [] };
          }
          const word = model.getWordUntilPosition(position);
          const range = {
            startColumn: word.startColumn,
            endColumn: word.endColumn,
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
          };
          return {
            suggestions: entries.map((entry) => ({
              label: entry.label,
              kind: monaco.languages.CompletionItemKind.Function,
              insertText: entry.insertText,
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: entry.detail,
              documentation: entry.documentation,
              range,
            })),
          };
        },
      },
    );

    return () => {
      completionProvider.dispose();
      extraLibDisposable.dispose();
    };
  }, [editorId, monaco]);

  const insertFixture = () => {
    const fixture = ROUTINE_SCRIPT_FIXTURES.find(
      (candidate) => candidate.id === fixtureId,
    );
    const editor = editorRef.current;
    if (!fixture || !editor) {
      return;
    }
    const selection = editor.getSelection();
    if (!selection) {
      return;
    }
    editor.executeEdits('routine-fixture', [
      { range: selection, text: fixture.body, forceMoveMarkers: true },
    ]);
    editor.focus();
  };

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-xl border border-border bg-card/70">
        <Editor
          defaultLanguage="javascript"
          height={height}
          language="javascript"
          onMount={(editor, mountedMonaco) => {
            editorRef.current = editor;
            setMonaco(mountedMonaco as MonacoApi);
          }}
          options={{
            automaticLayout: true,
            fontSize: 13,
            lineNumbersMinChars: 3,
            minimap: { enabled: false },
            padding: { top: 16, bottom: 16 },
            readOnly,
            scrollBeyondLastLine: false,
            tabSize: 2,
            wordWrap: 'on',
          }}
          theme="vs-dark"
          value={wrapBody(value)}
          onChange={(nextValue) => onChange(unwrapBody(nextValue ?? ''))}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          className="h-9 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          value={fixtureId}
          onChange={(event) => setFixtureId(event.target.value)}
        >
          {ROUTINE_SCRIPT_FIXTURES.map((fixture) => (
            <option key={fixture.id} value={fixture.id}>
              {fixture.label}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={insertFixture}
          disabled={readOnly}
        >
          Insert example
        </Button>
        <span className="text-xs text-muted-foreground">
          The editor wraps the body in a function so `return` is valid; only the
          body is saved. Examples insert at the cursor.
        </span>
      </div>
    </div>
  );
}
