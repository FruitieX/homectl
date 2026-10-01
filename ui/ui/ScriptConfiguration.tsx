import type { ScriptSpec } from '@/bindings/ScriptSpec';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import { useBlocks } from '@/hooks/useConfig';
import RoutineScriptEditor from '@/ui/RoutineScriptEditor';
import { RoutineScriptDeclarations } from '@/ui/RoutineScriptDeclarations';
import { SearchableMultiPicker } from '@/ui/SearchablePicker';
import { ConfigField } from '@/ui/config-form';

export function newScript(
  contract: 'action' | 'condition' | 'function' | 'helper',
): ScriptSpec {
  return {
    api_version: 1,
    source_body:
      contract === 'action'
        ? 'return { actions: [] };'
        : contract === 'condition'
          ? 'return true;'
          : 'return 0;',
    functions: [],
    inputs: {},
    declarations: [],
    limits_profile: 'default',
  };
}

export function FunctionDependencies({
  value,
  onChange,
  excludeId,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  excludeId?: string;
}) {
  const blocks = useBlocks();
  return (
    <ConfigField
      label="Shared functions"
      description="Call a selected function with api.functions.call(id, { namedInputs })."
    >
      <SearchableMultiPicker
        options={blocks.data
          .filter(
            (block) => block.kind === 'function' && block.id !== excludeId,
          )
          .map((block) => ({
            value: block.id,
            label: block.name,
            detail: block.id,
          }))}
        value={value}
        onChange={onChange}
        placeholder="Add function dependencies…"
        hrefFor={(id) => `/config/blocks/${encodeURIComponent(id)}`}
      />
      {blocks.error && (
        <p role="alert" className="text-xs text-destructive">
          {blocks.error}
        </p>
      )}
    </ConfigField>
  );
}

export function ScriptConfiguration({
  spec,
  onChange,
  devices = {},
  groups = {},
  contract = 'action',
  excludeId,
  path = 'script',
}: {
  spec: ScriptSpec;
  onChange: (spec: ScriptSpec) => void;
  devices?: DevicesState;
  groups?: FlattenedGroupsConfig;
  contract?: 'action' | 'condition' | 'function' | 'helper';
  excludeId?: string;
  path?: string;
}) {
  const description =
    contract === 'action'
      ? 'Return { actions, next_state? }. Actions are validated and planned before dispatch.'
      : contract === 'condition'
        ? 'Return true, false, or api.unknown(reason). Conditions cannot dispatch actions.'
        : contract === 'function'
          ? 'Return the declared output type. Use inputs for typed arguments; functions have no device subscriptions.'
          : 'Return a value matching the helper type. The helper is read-only; failures retain its last good value as stale.';
  return (
    <div className="space-y-4">
      <ConfigField label="JavaScript function body" description={description}>
        <RoutineScriptEditor
          value={spec.source_body}
          height={
            contract === 'function' || contract === 'condition'
              ? '320px'
              : '360px'
          }
          onChange={(source_body) => onChange({ ...spec, source_body })}
        />
      </ConfigField>
      <FunctionDependencies
        value={spec.functions ?? []}
        onChange={(functions) => onChange({ ...spec, functions })}
        excludeId={excludeId}
      />
      {contract !== 'function' && (
        <RoutineScriptDeclarations
          declarations={spec.declarations ?? []}
          onChange={(declarations) => onChange({ ...spec, declarations })}
          devices={devices}
          groups={groups}
          path={path + '/declarations'}
          purpose={contract === 'helper' ? 'helper' : 'routine'}
        />
      )}
    </div>
  );
}
