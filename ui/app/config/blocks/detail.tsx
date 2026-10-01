import { useMemo, useState } from 'react';
import type { ScriptSpec } from '@/bindings/ScriptSpec';
import { ScriptConfiguration, newScript } from '@/ui/ScriptConfiguration';
import { ReusePreview } from '@/ui/ReusePreview';
import {
  Link,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { toast } from 'sonner';
import type { AutomationBlock } from '@/bindings/AutomationBlock';
import type { BlockInputKind } from '@/bindings/BlockInputKind';
import type { ConditionExpr } from '@/bindings/ConditionExpr';
import type { NativeAction } from '@/bindings/NativeAction';
import type { JsonValue } from '@/bindings/serde_json/JsonValue';
import {
  useBlocks,
  useRoutines,
  useScenes,
  useHelpers,
  useHelperDefinitions,
  useSources,
} from '@/hooks/useConfig';
import { useAppConfig } from '@/hooks/appConfig';
import { useDevicesState } from '@/hooks/websocket';
import { useGroupsState } from '@/hooks/useDevicesApi';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import {
  blockUsers,
  blockCalls,
  bindingFields,
  inputReference,
  inputToken,
  materializeBlock,
  replaceInputName,
  retainInputBindings,
  setBodyPath,
} from '@/lib/automationBlocks';
import { entityDraftStore } from '@/lib/entityDraft';
import { stringifyConfig } from '@/lib/routineDraft';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { IdentityFields } from '@/ui/settings/IdentityFields';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { RoutineAuthoringContext } from '@/ui/settings/FlowBlock';
import { ConfigField } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { ConditionEditor } from '@/ui/ConditionBuilder';
import { ProgramBuilder } from '@/ui/ProgramBuilder';
import { BlockInputValue } from '@/ui/BlockCallEditor';
const kinds = [
  'group',
  'scene',
  'helper',
  'device',
  'targets',
  'rollout',
  'boolean',
  'number',
  'duration',
  'string',
  'enum',
  'json',
] as const;
const asJson = (value: unknown): JsonValue =>
  JSON.parse(stringifyConfig(value));
export default function BlockDetailPage() {
  const { id } = useParams();
  const creating = id === 'new';
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const api = useBlocks(),
    routines = useRoutines(),
    scenes = useScenes(),
    helpers = useHelpers(),
    helperDefinitions = useHelperDefinitions(),
    sources = useSources();
  const { apiEndpoint } = useAppConfig();
  const devices = useDevicesState() ?? {};
  const groups = useGroupsState() ?? {};
  const saved = api.data.find((b) => b.id === id);
  const copy = api.data.find((b) => b.id === params.get('copyFrom'));
  const empty = useMemo<AutomationBlock>(
    () =>
      copy
        ? {
            ...structuredClone(copy),
            id: '',
            name: `Copy of ${copy.name}`,
            revision: 1n,
          }
        : {
            id: '',
            name: '',
            description: '',
            kind: 'action',
            inputs: {},
            revision: 1n,
            body: [],
          },
    [copy],
  );
  const draft = useEntityDraft({
    key: `${apiEndpoint}/blocks/${creating ? '$new' : id}`,
    item: creating ? empty : saved,
    label: saved?.name ?? 'New block',
    href: `/config/blocks/${id}`,
    validate(value) {
      const errors = [];
      if (!value.id.trim())
        errors.push({ field: 'id', message: 'Choose a block ID.' });
      if (!value.name.trim())
        errors.push({ field: 'name', message: 'Give the block a name.' });
      if (creating && api.data.some((b) => b.id === value.id))
        errors.push({
          field: 'id',
          message: 'This block ID is already in use.',
        });
      return errors;
    },
    async save(value, expected) {
      const result = await api.update(
        value.id,
        {
          ...value,
          ...(creating ? { create_only: true } : {}),
        } as AutomationBlock,
        creating ? undefined : expected,
      );
      if (result && creating) {
        draft.forget();
        navigate(`/config/blocks/${encodeURIComponent(result.id)}`, {
          replace: true,
        });
      }
      return result;
    },
  });
  const value = draft.value;
  const [previewInputs, setPreviewInputs] = useState<Record<string, JsonValue>>(
    {},
  );
  const scripted =
    value?.body &&
    !Array.isArray(value.body) &&
    typeof value.body === 'object' &&
    value.body.kind === 'javascript';
  const scriptBody = scripted
    ? (value.body as unknown as {
        kind: 'javascript';
        spec: ScriptSpec;
        output?: BlockInputKind;
      })
    : undefined;
  const users = value
    ? blockUsers(value.id, api.data, routines.data)
    : { blocks: [], routines: [] };
  const dependencyIds = [
    value?.id ?? '',
    ...users.blocks.map((block) => block.id),
  ];
  const helperUsers = helperDefinitions.data.filter((helper) =>
    dependencyIds.some((id) => blockCalls(helper.compute?.script, id)),
  );
  const sourceUsers = sources.data.filter((source) =>
    dependencyIds.some((id) => blockCalls(source.compute, id)),
  );
  async function remove() {
    if (
      !saved ||
      !(await confirmDialog({
        title: `Delete ${saved.name}?`,
        description:
          'Remove this reusable definition. Blocks with callers cannot be deleted.',
        confirmLabel: 'Delete block',
        destructive: true,
      }))
    )
      return;
    try {
      await api.remove(saved.id);
      draft.forget();
      navigate('/config/blocks');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  const exampleGroups = { ...groups };
  const exampleScenes = [...scenes.data];
  const exampleHelpers = [...helpers.data];
  const exampleDevices = { ...devices };
  for (const [name, input] of Object.entries(value?.inputs ?? {})) {
    const token = inputToken(name);
    if (input.kind.kind === 'group' || input.kind.kind === 'targets')
      exampleGroups[token] = {
        name: `Input: ${input.label}`,
        device_keys: [],
        hidden: true,
      };
    if (input.kind.kind === 'scene')
      exampleScenes.push({
        id: token,
        name: `Input: ${input.label}`,
        hidden: true,
        device_states: {},
        group_states: {},
      });
    if (input.kind.kind === 'helper')
      exampleHelpers.push({
        id: token,
        name: `Input: ${input.label}`,
        kind: { kind: 'string' },
        value: '',
        initial_value: '',
        persistence: 'session',
        revision: 0n,
        hidden: true,
      });
    if (input.kind.kind === 'device') {
      const sample = Object.values(devices).find(Boolean);
      if (sample)
        exampleDevices[`__block_input__/${name}`] = {
          ...sample,
          id: name,
          integration_id: '__block_input__',
          name: `Input: ${input.label}`,
        };
    }
  }
  const materialized = value
    ? materializeBlock(value.body, value.inputs)
    : null;
  const updateBody = (body: unknown) => {
    if (value)
      draft.patch({
        body: retainInputBindings(value.body, asJson(body), value.inputs),
      });
  };
  const catalogs = {
    devices,
    groups,
    scenes: scenes.data,
    helpers: helpers.data,
  };
  return (
    <DetailPageShell
      crumbs={[]}
      backTo="/config/blocks"
      backLabel="Blocks"
      title={creating ? 'New block' : (saved?.name ?? 'Block')}
      loading={api.loading}
      error={api.error}
      onRetry={() => void api.refetch()}
      notFound={!creating && !saved && !draft.dirty}
      menu={
        !creating
          ? [
              {
                label: 'Make an independent copy',
                onSelect: () =>
                  navigate(
                    `/config/blocks/new?copyFrom=${encodeURIComponent(id!)}`,
                  ),
              },
              {
                label: 'Delete block',
                destructive: true,
                onSelect: () => void remove(),
              },
            ]
          : undefined
      }
    >
      {value && (
        <RoutineAuthoringContext.Provider
          value={{ draftKey: draft.key, blockId: value.id }}
        >
          <SettingsSection id="details" title="Details">
            <IdentityFields
              draft={draft}
              creating={creating}
              existingIds={api.data.map((b) => b.id)}
            />
            <ConfigField label="Description">
              <Input
                value={value.description}
                onChange={(e) => draft.patch({ description: e.target.value })}
              />
            </ConfigField>
            <ConfigField label="Kind">
              <SettingsSelect
                aria-label="Block kind"
                value={value.kind}
                options={[
                  { value: 'action', label: 'Action block' },
                  { value: 'condition', label: 'Condition block' },
                  { value: 'function', label: 'JavaScript function' },
                ]}
                onValueChange={(kind) => {
                  if (kind !== value.kind)
                    draft.patch({
                      kind: kind as AutomationBlock['kind'],
                      body: entityDraftStore.switchVariant(
                        draft.key,
                        'block-body',
                        value.kind,
                        value.body,
                        kind,
                        kind === 'function'
                          ? asJson({
                              kind: 'javascript',
                              spec: newScript('function'),
                              output: { kind: 'number' },
                            })
                          : kind === 'action'
                            ? []
                            : { kind: 'literal', value: true },
                      ),
                    });
                }}
              />
            </ConfigField>
          </SettingsSection>
          <SettingsSection
            id="inputs"
            title="Inputs"
            description="Each caller supplies these values. Defaults are optional."
          >
            <div className="space-y-4">
              {Object.entries(value.inputs).map(([name, input]) => (
                <div
                  key={name}
                  className="space-y-3 rounded border border-border p-3"
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <ConfigField label="Input key">
                      <Input
                        aria-label={`Input key ${name}`}
                        defaultValue={name}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (next === name) return;
                          if (
                            !/^[A-Za-z0-9_]+$/.test(next) ||
                            Object.hasOwn(value.inputs, next)
                          ) {
                            e.target.value = name;
                            toast.error(
                              'Choose a unique key using letters, numbers and underscores.',
                            );
                            return;
                          }
                          const inputs = { ...value.inputs };
                          delete inputs[name];
                          inputs[next] = input;
                          draft.patch({
                            inputs,
                            body: replaceInputName(value.body, name, next),
                          });
                        }}
                      />
                    </ConfigField>
                    <ConfigField label="Label">
                      <Input
                        value={input.label}
                        onChange={(e) =>
                          draft.patch({
                            inputs: {
                              ...value.inputs,
                              [name]: { ...input, label: e.target.value },
                            },
                          })
                        }
                      />
                    </ConfigField>
                    <ConfigField label="Type">
                      <SettingsSelect
                        aria-label={`Input type ${name}`}
                        value={input.kind.kind}
                        options={kinds.map((kind) => ({
                          value: kind,
                          label:
                            kind === 'duration'
                              ? 'Duration (ms)'
                              : kind[0]!.toUpperCase() + kind.slice(1),
                        }))}
                        onValueChange={(kind) =>
                          draft.patch({
                            inputs: {
                              ...value.inputs,
                              [name]: {
                                label: input.label,
                                kind: (kind === 'enum'
                                  ? { kind, options: ['first', 'second'] }
                                  : { kind }) as BlockInputKind,
                              },
                            },
                          })
                        }
                      />
                    </ConfigField>
                  </div>
                  {input.kind.kind === 'enum' && (
                    <ConfigField label="Options (comma separated)">
                      <Input
                        value={input.kind.options.join(', ')}
                        onChange={(e) =>
                          draft.patch({
                            inputs: {
                              ...value.inputs,
                              [name]: {
                                ...input,
                                kind: {
                                  kind: 'enum',
                                  options: e.target.value
                                    .split(',')
                                    .map((v) => v.trim()),
                                },
                              },
                            },
                          })
                        }
                      />
                    </ConfigField>
                  )}
                  <ConfigField label="Default">
                    <BlockInputValue
                      {...catalogs}
                      path={`inputs/${name}/default`}
                      input={input}
                      value={input.default}
                      onChange={(defaultValue) =>
                        draft.patch({
                          inputs: {
                            ...value.inputs,
                            [name]: { ...input, default: defaultValue },
                          },
                        })
                      }
                    />
                  </ConfigField>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const next = { ...input };
                        delete next.default;
                        draft.patch({
                          inputs: { ...value.inputs, [name]: next },
                        });
                      }}
                    >
                      Require a value from callers
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={JSON.stringify(value.body).includes(
                        `"$input":"${name}"`,
                      )}
                      onClick={() => {
                        const inputs = { ...value.inputs };
                        delete inputs[name];
                        draft.patch({ inputs });
                      }}
                    >
                      Remove input
                    </Button>
                  </div>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => {
                  let i = 1;
                  while (value.inputs[`input${i}`]) i++;
                  draft.patch({
                    inputs: {
                      ...value.inputs,
                      [`input${i}`]: {
                        label: `Input ${i}`,
                        kind: { kind: 'group' },
                      },
                    },
                  });
                }}
              >
                Add input
              </Button>
            </div>
          </SettingsSection>
          <SettingsSection
            id="behavior"
            title={
              value.kind === 'action'
                ? 'Actions'
                : value.kind === 'function'
                  ? 'Function'
                  : 'Condition'
            }
            description={
              scripted
                ? 'Use inputs for named arguments. Select any shared functions below.'
                : 'Build the behavior, then bind fields to inputs below.'
            }
          >
            <ConfigField label="Implementation">
              <SettingsSelect
                aria-label="Block implementation"
                value={scripted ? 'javascript' : 'visual'}
                options={[
                  ...(value.kind === 'function'
                    ? []
                    : [{ value: 'visual', label: 'Visual blocks' }]),
                  { value: 'javascript', label: 'JavaScript' },
                ]}
                onValueChange={(mode) =>
                  draft.patch({
                    body: entityDraftStore.switchVariant(
                      draft.key,
                      'block-implementation',
                      scripted ? 'javascript' : 'visual',
                      value.body,
                      mode,
                      mode === 'javascript'
                        ? asJson({
                            kind: 'javascript',
                            spec: newScript(value.kind),
                            ...(value.kind === 'function'
                              ? { output: { kind: 'number' } }
                              : {}),
                          })
                        : value.kind === 'action'
                          ? []
                          : { kind: 'literal', value: true },
                    ),
                  })
                }
              />
            </ConfigField>
            {scriptBody ? (
              <div className="space-y-4">
                {value.kind === 'function' && (
                  <ConfigField label="Output type">
                    <SettingsSelect
                      aria-label="Function output type"
                      value={scriptBody.output?.kind ?? 'number'}
                      options={kinds.map((kind) => ({
                        value: kind,
                        label:
                          kind === 'json'
                            ? 'JSON / structured value'
                            : kind[0]!.toUpperCase() + kind.slice(1),
                      }))}
                      onValueChange={(kind) =>
                        draft.patch({
                          body: asJson({
                            ...scriptBody,
                            output:
                              kind === 'enum'
                                ? { kind, options: ['value'] }
                                : { kind },
                          }),
                        })
                      }
                    />
                    {scriptBody.output?.kind === 'enum' && (
                      <Input
                        aria-label="Function output options"
                        value={scriptBody.output.options.join(', ')}
                        onChange={(event) =>
                          draft.patch({
                            body: asJson({
                              ...scriptBody,
                              output: {
                                kind: 'enum',
                                options: event.target.value
                                  .split(',')
                                  .map((value) => value.trim()),
                              },
                            }),
                          })
                        }
                      />
                    )}
                  </ConfigField>
                )}
                <ScriptConfiguration
                  spec={scriptBody.spec}
                  contract={value.kind}
                  excludeId={value.id}
                  devices={devices}
                  groups={groups}
                  onChange={(spec) =>
                    draft.patch({ body: asJson({ ...scriptBody, spec }) })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Read typed arguments from inputs or ctx.inputs. Arguments are
                  data; source code is never interpolated.
                </p>
              </div>
            ) : value.kind === 'action' ? (
              <ProgramBuilder
                program={{
                  kind: 'native',
                  steps: materialized as unknown as NativeAction[],
                }}
                onChange={(program) => {
                  if (program.kind === 'native') updateBody(program.steps);
                }}
                devices={exampleDevices}
                groups={exampleGroups}
                scenes={exampleScenes}
                routines={routines.data}
                helpers={exampleHelpers}
              />
            ) : (
              <ConditionEditor
                condition={materialized as unknown as ConditionExpr}
                onChange={updateBody}
                devices={exampleDevices}
                groups={exampleGroups}
                scenes={exampleScenes}
                helpers={exampleHelpers}
              />
            )}
          </SettingsSection>
          {!scripted && !!Object.keys(value.inputs).length && (
            <SettingsSection
              id="bindings"
              title="Use inputs in the behavior"
              description="Replace a fixed field with an input supplied by each caller."
            >
              <div className="space-y-3">
                {bindingFields(value.body, api.data).map((field) => {
                  const available = Object.entries(value.inputs).filter(
                    ([, input]) => field.kinds.includes(input.kind.kind),
                  );
                  if (!available.length) return null;
                  const bound = inputReference(field.value);
                  return (
                    <ConfigField key={field.path.join('/')} label={field.label}>
                      <SettingsSelect
                        aria-label={`Bind ${field.label}`}
                        value={bound ?? '$fixed'}
                        options={[
                          { value: '$fixed', label: 'Fixed value' },
                          ...available.map(([name, input]) => ({
                            value: name,
                            label: `Input: ${input.label}`,
                          })),
                        ]}
                        onValueChange={(name) =>
                          draft.patch({
                            body: setBodyPath(
                              value.body,
                              field.path,
                              name === '$fixed'
                                ? materializeBlock(
                                    field.value,
                                    value.inputs,
                                    Object.fromEntries(
                                      Object.entries(value.inputs).map(
                                        ([k, v]) => [k, v.default ?? null],
                                      ),
                                    ),
                                  )
                                : { $input: name },
                            ),
                          })
                        }
                      />
                    </ConfigField>
                  );
                })}
              </div>
            </SettingsSection>
          )}
          <SettingsSection
            id="usage"
            title="Used by"
            description="Saving updates these callers. Invalid callers prevent the save."
          >
            {routines.error ? (
              <p role="alert">{routines.error}</p>
            ) : routines.loading ? (
              <p>Loading callers…</p>
            ) : (
              <div className="flex flex-wrap gap-3">
                {users.routines.map((r) => (
                  <Link
                    className="text-primary underline"
                    key={r.id}
                    to={`/config/routines/${encodeURIComponent(r.id)}`}
                  >
                    {r.name}
                  </Link>
                ))}
                {users.blocks.map((b) => (
                  <Link
                    className="text-primary underline"
                    key={b.id}
                    to={`/config/blocks/${encodeURIComponent(b.id)}`}
                  >
                    {b.name}
                  </Link>
                ))}
                {helperUsers.map((helper) => (
                  <Link
                    key={`helper/${helper.id}`}
                    className="text-primary underline"
                    to={`/config/helpers/${encodeURIComponent(helper.id)}`}
                  >
                    {helper.name}
                  </Link>
                ))}
                {sourceUsers.map((source) => (
                  <Link
                    key={`source/${source.id}`}
                    className="text-primary underline"
                    to={`/config/sources/${encodeURIComponent(source.id)}`}
                  >
                    {source.name}
                  </Link>
                ))}
                {!users.routines.length &&
                  !users.blocks.length &&
                  !helperUsers.length &&
                  !sourceUsers.length && (
                    <p className="text-sm text-muted-foreground">
                      No callers yet.
                    </p>
                  )}
              </div>
            )}
          </SettingsSection>
          <SettingsSection
            id="preview"
            title="Try this block"
            description="Supply arguments to preview the draft against current values."
          >
            <div className="mb-4 grid gap-3 sm:grid-cols-2">
              {Object.entries(value.inputs).map(([name, input]) => (
                <ConfigField key={name} label={input.label}>
                  <BlockInputValue
                    input={input}
                    value={
                      Object.hasOwn(previewInputs, name)
                        ? previewInputs[name]
                        : input.default
                    }
                    onChange={(next) =>
                      setPreviewInputs((previous) => ({
                        ...previous,
                        [name]: next,
                      }))
                    }
                    devices={devices}
                    groups={groups}
                    scenes={scenes.data}
                    helpers={helpers.data}
                  />
                </ConfigField>
              ))}
            </div>
            <ReusePreview
              request={{
                kind: 'block',
                block: value,
                inputs: Object.fromEntries(
                  Object.entries(previewInputs).filter(([name]) =>
                    Object.hasOwn(value.inputs, name),
                  ),
                ),
              }}
            />
          </SettingsSection>
          <EntitySaveBar
            draft={draft}
            createLabel={creating ? 'Create block' : undefined}
          />
        </RoutineAuthoringContext.Provider>
      )}
    </DetailPageShell>
  );
}
