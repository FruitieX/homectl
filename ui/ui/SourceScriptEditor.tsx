import Editor from '@monaco-editor/react';
import type * as MonacoEditor from 'monaco-editor';
import { useEffect, useId, useState } from 'react';

type MonacoApi = typeof MonacoEditor;

interface SourceScriptEditorProps {
  value: string;
  onChange: (value: string) => void;
  height?: string;
  readOnly?: boolean;
}

const SOURCE_CONTEXT_TYPES = `declare const ctx: {
  /** Injected wall-clock time of this invocation (epoch milliseconds). */
  now_ms: number;
  seed: number;
  /** Timezone-aware civil time; never guessed from Date. */
  local: {
    timezone: string;
    time: string;
    minutes_of_day: number;
    seconds_of_day: number;
    day_fraction: number;
  };
  /** The definition's parameter object, verbatim. */
  params: any;
  source: { id: string; name: string };
};

declare const api: {
  time: {
    /** Strict HH:MM to minutes since midnight. Throws on invalid input. */
    parseHHMM(text: string): number;
    minutes(): number;
    seconds(): number;
    dayFraction(): number;
    lerp(from: number, to: number, t: number): number;
    easeSine(t: number): number;
  };
  color: {
    kelvin(kelvin: number): { ct: number };
    hs(hue: number, saturation: number): { h: number; s: number };
    isKelvin(color: any): boolean;
    isHs(color: any): boolean;
    mix(from: any, to: any, t: number): any;
  };
};
`;

export const SOURCE_SCRIPT_STARTER = `// Return one light profile for the injected civil time.
var p = ctx.params;
return {
  value: {
    color: api.color.kelvin(2700),
    brightness: 0.4,
    transition_ms: 60000
  }
};
`;

type CompletionEntry = {
  label: string;
  detail: string;
  insertText: string;
  documentation: string;
};

const TIME_COMPLETIONS: CompletionEntry[] = [
  {
    label: 'parseHHMM',
    detail: 'parseHHMM(text: string): number',
    insertText: 'parseHHMM(${1:"07:00"})',
    documentation: 'Strict HH:MM civil time to minutes since midnight.',
  },
  {
    label: 'minutes',
    detail: 'minutes(): number',
    insertText: 'minutes()',
    documentation: 'Injected civil time in minutes since midnight.',
  },
  {
    label: 'seconds',
    detail: 'seconds(): number',
    insertText: 'seconds()',
    documentation: 'Injected civil time in seconds since midnight.',
  },
  {
    label: 'dayFraction',
    detail: 'dayFraction(): number',
    insertText: 'dayFraction()',
    documentation: 'Fraction of the civil day in 0..1.',
  },
  {
    label: 'lerp',
    detail: 'lerp(from: number, to: number, t: number): number',
    insertText: 'lerp(${1:from}, ${2:to}, ${3:t})',
    documentation: 'Linear interpolation.',
  },
  {
    label: 'easeSine',
    detail: 'easeSine(t: number): number',
    insertText: 'easeSine(${1:t})',
    documentation: 'Sine easing used by the shipped circadian preset.',
  },
];

const COLOR_COMPLETIONS: CompletionEntry[] = [
  {
    label: 'kelvin',
    detail: 'kelvin(kelvin: number): { ct: number }',
    insertText: 'kelvin(${1:2700})',
    documentation: 'A color-temperature color in Kelvin.',
  },
  {
    label: 'hs',
    detail: 'hs(hue: number, saturation: number): { h: number; s: number }',
    insertText: 'hs(${1:30}, ${2:1})',
    documentation: 'A hue/saturation color.',
  },
  {
    label: 'isKelvin',
    detail: 'isKelvin(color: any): boolean',
    insertText: 'isKelvin(${1:color})',
    documentation: 'True when the value is a Kelvin color.',
  },
  {
    label: 'isHs',
    detail: 'isHs(color: any): boolean',
    insertText: 'isHs(${1:color})',
    documentation: 'True when the value is a hue/saturation color.',
  },
  {
    label: 'mix',
    detail: 'mix(from: any, to: any, t: number): any',
    insertText: 'mix(${1:from}, ${2:to}, ${3:t})',
    documentation:
      'Mix two Kelvin or two HS colors; rounds Kelvin to whole Kelvin.',
  },
];

const CONTEXT_COMPLETIONS: CompletionEntry[] = [
  {
    label: 'now_ms',
    detail: 'now_ms: number',
    insertText: 'now_ms',
    documentation: 'Injected wall-clock time (epoch milliseconds).',
  },
  {
    label: 'local',
    detail: 'local: { timezone, time, minutes_of_day, seconds_of_day, day_fraction }',
    insertText: 'local',
    documentation: 'Timezone-aware civil time for this invocation.',
  },
  {
    label: 'params',
    detail: 'params: any',
    insertText: 'params',
    documentation: 'The definition parameter object.',
  },
  {
    label: 'source',
    detail: 'source: { id, name }',
    insertText: 'source',
    documentation: 'Identity of the computed source.',
  },
];

function completionContext(line: string): CompletionEntry[] | null {
  if (/(^|[^\w.])api\.time\.\w*$/.test(line)) {
    return TIME_COMPLETIONS;
  }
  if (/(^|[^\w.])api\.color\.\w*$/.test(line)) {
    return COLOR_COMPLETIONS;
  }
  if (/(^|[^\w.])ctx\.\w*$/.test(line)) {
    return CONTEXT_COMPLETIONS;
  }
  return null;
}

export default function SourceScriptEditor({
  value,
  onChange,
  height = '24rem',
  readOnly = false,
}: SourceScriptEditorProps) {
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
      SOURCE_CONTEXT_TYPES,
      `file:///source-script-${editorId}.d.ts`,
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
              kind: monacoApi.languages.CompletionItemKind.Function,
              insertText: entry.insertText,
              insertTextRules:
                monacoApi.languages.CompletionItemInsertTextRule.InsertAsSnippet,
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

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card/70">
      <Editor
        defaultLanguage="javascript"
        height={height}
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
          readOnly,
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
