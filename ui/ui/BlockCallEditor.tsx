import type { AutomationBlock } from '@/bindings/AutomationBlock';
import type { BlockInput } from '@/bindings/BlockInput';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import type { DevicesState } from '@/bindings/DevicesState';
import type { FlattenedGroupsConfig } from '@/bindings/FlattenedGroupsConfig';
import type { HelperRuntimeStatus } from '@/bindings/HelperRuntimeStatus';
import { useBlocks } from '@/hooks/useConfig';
import { materializeBlock } from '@/lib/automationBlocks';
import { DraftNumberInput } from '@/ui/settings/DraftNumberInput';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { ConfigField } from '@/ui/config-form';
import {
  DeviceSelect,
  DeviceMultiSelect,
  GroupSelect,
  GroupMultiSelect,
  SceneSelect,
  ReferenceField,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { useRoutineAuthoring } from '@/ui/settings/FlowBlock';

export type BlockCatalogs = {
  devices: DevicesState;
  groups: FlattenedGroupsConfig;
  scenes: Array<{ id: string; name: string }>;
  helpers: HelperRuntimeStatus[];
};
export function BlockInputValue({
  input,
  value,
  onChange,
  devices,
  groups,
  scenes,
  helpers,
  path,
}: BlockCatalogs & {
  path?: string;
  input: BlockInput;
  value: JsonValue | undefined;
  onChange: (value: JsonValue) => void;
}) {
  const { draftKey } = useRoutineAuthoring();
  const text = typeof value === 'string' ? value : '';
  switch (input.kind.kind) {
    case 'group':
      return <GroupSelect groups={groups} value={text} onChange={onChange} />;
    case 'scene':
      return <SceneSelect scenes={scenes} value={text} onChange={onChange} />;
    case 'helper':
      return (
        <SearchablePicker
          options={helpers.map((h) => ({ value: h.id, label: h.name ?? h.id }))}
          value={text}
          onChange={onChange}
          placeholder="Select helper…"
        />
      );
    case 'device': {
      const ref =
        value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : {};
      return (
        <DeviceSelect
          devices={devices}
          value={
            typeof ref.integration_id === 'string' &&
            typeof ref.device_id === 'string'
              ? `${ref.integration_id}/${ref.device_id}`
              : ''
          }
          onChange={(key) => onChange(splitDeviceKey(key) ?? {})}
        />
      );
    }
    case 'targets': {
      const targets =
        value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : {};
      const refs = Array.isArray(targets.devices) ? targets.devices : [];
      return (
        <div className="space-y-2">
          <GroupMultiSelect
            groups={groups}
            value={
              Array.isArray(targets.groups)
                ? targets.groups.filter(
                    (v): v is string => typeof v === 'string',
                  )
                : []
            }
            onChange={(groups) => onChange({ ...targets, groups })}
          />
          <DeviceMultiSelect
            devices={devices}
            value={refs.flatMap((ref) =>
              ref &&
              typeof ref === 'object' &&
              !Array.isArray(ref) &&
              typeof ref.integration_id === 'string' &&
              typeof ref.device_id === 'string'
                ? [`${ref.integration_id}/${ref.device_id}`]
                : [],
            )}
            onChange={(keys) =>
              onChange({
                ...targets,
                devices: keys.map((key) => splitDeviceKey(key) ?? {}),
              })
            }
          />
        </div>
      );
    }
    case 'rollout': {
      const rollout =
        value && typeof value === 'object' && !Array.isArray(value)
          ? value
          : null;
      const source =
        rollout?.source &&
        typeof rollout.source === 'object' &&
        !Array.isArray(rollout.source)
          ? rollout.source
          : {};
      const origin =
        source.device &&
        typeof source.device === 'object' &&
        !Array.isArray(source.device)
          ? source.device
          : {};
      return (
        <div className="space-y-2">
          <SettingsSelect
            aria-label={input.label}
            value={rollout ? 'spatial' : 'none'}
            options={[
              { value: 'none', label: 'Apply together' },
              { value: 'spatial', label: 'Spread across the floorplan' },
            ]}
            onValueChange={(v) =>
              onChange(
                v === 'none'
                  ? null
                  : {
                      style: 'spatial',
                      duration_ms: 1500,
                      source: { kind: 'triggering_device' },
                    },
              )
            }
          />
          {rollout && (
            <>
              <SettingsSelect
                aria-label="Spread origin"
                value={
                  source.kind === 'device' ? 'device' : 'triggering_device'
                }
                options={[
                  { value: 'triggering_device', label: 'Triggering device' },
                  { value: 'device', label: 'Fixed device' },
                ]}
                onValueChange={(kind) =>
                  onChange({
                    ...rollout,
                    source:
                      kind === 'device'
                        ? {
                            kind,
                            device: { integration_id: '', device_id: '' },
                          }
                        : { kind },
                  })
                }
              />
              {source.kind === 'device' && (
                <DeviceSelect
                  devices={devices}
                  value={
                    String(origin.integration_id ?? '') +
                    '/' +
                    String(origin.device_id ?? '')
                  }
                  onChange={(key) =>
                    onChange({
                      ...rollout,
                      source: {
                        kind: 'device',
                        device: splitDeviceKey(key) ?? {},
                      },
                    })
                  }
                />
              )}
              {draftKey && path ? (
                <DraftNumberInput
                  aria-label="Spread duration (ms)"
                  draftKey={draftKey}
                  path={path + '/duration'}
                  value={
                    typeof rollout.duration_ms === 'number'
                      ? rollout.duration_ms
                      : undefined
                  }
                  validate={(n) =>
                    !Number.isSafeInteger(n) || n < 0 || n > 600000
                      ? 'Enter a whole duration between 0 and 600000 ms.'
                      : undefined
                  }
                  onValueChange={(duration_ms) => {
                    if (duration_ms !== undefined)
                      onChange({ ...rollout, duration_ms });
                  }}
                />
              ) : (
                <Input
                  aria-label="Spread duration (ms)"
                  type="number"
                  value={Number(rollout.duration_ms ?? 1500)}
                  onChange={(e) =>
                    onChange({
                      ...rollout,
                      duration_ms: Number(e.target.value),
                    })
                  }
                />
              )}
            </>
          )}
        </div>
      );
    }
    case 'boolean':
      return (
        <SettingsSelect
          aria-label={input.label}
          value={
            value === undefined ? 'unset' : value === true ? 'true' : 'false'
          }
          options={[
            { value: 'unset', label: 'Select…' },
            { value: 'true', label: 'True' },
            { value: 'false', label: 'False' },
          ]}
          onValueChange={(v) => {
            if (v !== 'unset') onChange(v === 'true');
          }}
        />
      );
    case 'enum':
      return (
        <SettingsSelect
          aria-label={input.label}
          value={text}
          options={[
            { value: '', label: 'Select…' },
            ...input.kind.options.map((v) => ({ value: v, label: v })),
          ]}
          onValueChange={onChange}
        />
      );
    case 'number':
    case 'duration':
      return draftKey && path ? (
        <DraftNumberInput
          aria-label={input.label}
          value={typeof value === 'number' ? value : undefined}
          draftKey={draftKey}
          path={path}
          validate={(n) =>
            input.kind.kind === 'duration' &&
            (!Number.isSafeInteger(n) || n < 0 || n > 604800000)
              ? 'Enter a whole duration between 0 and 604800000 ms.'
              : undefined
          }
          onValueChange={(n) => {
            if (n !== undefined) onChange(n);
          }}
        />
      ) : (
        <Input
          aria-label={input.label}
          type="number"
          min={input.kind.kind === 'duration' ? 0 : undefined}
          step={input.kind.kind === 'duration' ? 1 : 'any'}
          value={typeof value === 'number' ? value : ''}
          onChange={(e) => {
            if (e.target.value !== '') onChange(Number(e.target.value));
          }}
        />
      );
    default:
      return (
        <Input
          aria-label={input.label}
          value={text}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

function Preview({
  body,
  catalogs,
}: {
  body: JsonValue;
  catalogs: BlockCatalogs;
}) {
  if (Array.isArray(body))
    return (
      <ul className="space-y-2">
        {body.map((step, i) => (
          <li key={i}>
            <Preview catalogs={catalogs} body={step} />
          </li>
        ))}
      </ul>
    );
  if (!body || typeof body !== 'object') return null;
  if (body.action === 'choose' && Array.isArray(body.branches))
    return (
      <div className="space-y-2">
        {body.branches.map((branch, i) =>
          branch && typeof branch === 'object' && !Array.isArray(branch) ? (
            <div key={i}>
              <p className="text-xs font-medium">
                {i === 0 ? 'If' : 'Otherwise, if'}{' '}
                <Preview catalogs={catalogs} body={branch.condition ?? null} />
              </p>
              <div className="ml-3">
                <Preview catalogs={catalogs} body={branch.steps ?? []} />
              </div>
            </div>
          ) : null,
        )}
      </div>
    );
  if (body.kind === 'group')
    return (
      <span>
        {(
          {
            all: 'All',
            any: 'Some',
            none: 'No',
            partial: 'Some, but not all',
          } as Record<string, string>
        )[String(body.quantifier)] ?? String(body.quantifier)}{' '}
        members of{' '}
        {catalogs.groups[String(body.group_id)]?.name ?? String(body.group_id)}{' '}
        {body.scene !== undefined
          ? `follow ${catalogs.scenes.find((s) => s.id === body.scene)?.name ?? String(body.scene)}`
          : `are ${body.power ? 'on' : 'off'}`}
      </span>
    );
  if (body.kind === 'all' || body.kind === 'any')
    return (
      <span>
        {Array.isArray(body.conditions)
          ? body.conditions.map((c, i) => (
              <span key={i}>
                {i > 0 ? (body.kind === 'all' ? ' and ' : ' or ') : ''}
                <Preview catalogs={catalogs} body={c} />
              </span>
            ))
          : null}
      </span>
    );
  if (body.kind === 'not')
    return (
      <span>
        Not <Preview catalogs={catalogs} body={body.condition ?? null} />
      </span>
    );
  if (body.kind === 'literal')
    return <span>{body.value ? 'Always' : 'Never'}</span>;
  if (body.kind === 'comparison')
    return <span>Compare a value using {String(body.operator)}</span>;
  if (body.kind === 'block' || body.action === 'call_block')
    return <span>Use block {String(body.block_id)}</span>;
  if (body.action === 'activate_scene')
    return (
      <span>
        Activate{' '}
        {catalogs.scenes.find((s) => s.id === body.scene_id)?.name ??
          String(body.scene_id ?? 'selected scene')}
      </span>
    );
  if (body.action === 'cycle_scenes')
    return (
      <span>
        Cycle{' '}
        {Array.isArray(body.scenes)
          ? body.scenes
              .map((s) =>
                s && typeof s === 'object' && !Array.isArray(s)
                  ? (catalogs.scenes.find((scene) => scene.id === s.scene_id)
                      ?.name ?? String(s.scene_id))
                  : '',
              )
              .join(' → ')
          : ''}
        {body.nowrap ? ' · Stop at last scene' : ''}
      </span>
    );
  return (
    <span>
      {String(body.action ?? body.kind ?? 'Block definition').replaceAll(
        '_',
        ' ',
      )}
    </span>
  );
}
export function BlockCallEditor({
  kind,
  blockId,
  inputs = {},
  onChange,
  path = 'block',
  ...catalogs
}: BlockCatalogs & {
  path?: string;
  kind: AutomationBlock['kind'];
  blockId: string;
  inputs: Record<string, JsonValue>;
  onChange: (id: string, inputs: Record<string, JsonValue>) => void;
}) {
  const api = useBlocks();
  const { blockId: editingBlock } = useRoutineAuthoring();
  const block = api.data.find((b) => b.id === blockId);
  return (
    <div className="space-y-3">
      <ConfigField label={kind === 'action' ? 'Run block' : 'Check block'}>
        <ReferenceField kind="block" value={blockId}>
          <SearchablePicker
            value={blockId}
            options={api.data
              .filter((b) => b.kind === kind && b.id !== editingBlock)
              .map((b) => ({
                value: b.id,
                label: b.name,
                detail: b.description,
              }))}
            placeholder="Select block…"
            onChange={(id) => onChange(id, {})}
          />
        </ReferenceField>
      </ConfigField>
      {api.error ? (
        <p role="alert">
          {api.error}{' '}
          <Button
            size="sm"
            variant="outline"
            onClick={() => void api.refetch()}
          >
            Retry
          </Button>
        </p>
      ) : api.loading ? (
        <p>Loading blocks…</p>
      ) : blockId && !block ? (
        <p role="alert">
          This block is missing. Choose another block or restore it.
        </p>
      ) : null}
      {block && (
        <>
          <p className="text-xs text-muted-foreground">{block.description}</p>
          {Object.entries(block.inputs).map(([name, input]) => (
            <ConfigField
              key={name}
              label={input.label}
              description={
                input.kind.kind === 'duration' ? 'Milliseconds' : undefined
              }
            >
              <BlockInputValue
                {...catalogs}
                path={`${path}/inputs/${name}`}
                input={input}
                value={
                  Object.hasOwn(inputs, name) ? inputs[name] : input.default
                }
                onChange={(value) =>
                  onChange(blockId, { ...inputs, [name]: value })
                }
              />
              {input.default !== undefined && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    const next = { ...inputs };
                    delete next[name];
                    onChange(blockId, next);
                  }}
                >
                  Use block default
                </Button>
              )}
            </ConfigField>
          ))}
          <details className="rounded border border-border p-3 text-sm">
            <summary className="cursor-pointer">
              View behavior with these inputs
            </summary>
            <div className="mt-3">
              <Preview
                catalogs={catalogs}
                body={materializeBlock(
                  block.body,
                  block.inputs,
                  Object.fromEntries(
                    Object.entries(inputs).filter(
                      (e): e is [string, JsonValue] => e[1] !== undefined,
                    ),
                  ),
                )}
              />
            </div>
          </details>
        </>
      )}
    </div>
  );
}
