import { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Copy,
  ExternalLink,
  MoreHorizontal,
  Palette,
  Trash2,
} from 'lucide-react';
import { useAtom } from 'jotai';
import { toast } from 'sonner';
import { sceneClipboardAtom } from '@/hooks/sceneClipboard';
import {
  clipboardFields,
  describeClipboard,
  pasteSceneTarget,
} from '@/lib/sceneClipboard';
import type { SceneDeviceConfig, SceneDeviceState } from '@/hooks/useConfig';
import type { Capabilities } from '@/bindings/Capabilities';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import {
  patchSceneTarget,
  resolveDraftTarget,
  targetDeviceKeys,
  sceneTargetDraftPath,
  type SceneDraftContext,
} from '@/lib/sceneDraft';
import { sceneTargetMode, sceneTargetIssue } from '@/lib/sceneTargets';
import { UnsupportedSceneTarget } from './unsupported-target';
import { configItemHref } from '@/lib/configItemHref';
import { entityDraftStore } from '@/lib/entityDraft';
import { formatColorExact } from '@/lib/deviceColor';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
import { StatePreview } from '@/ui/settings/StatePreview';
import { SceneColorControl } from '@/ui/settings/SceneColorControl';
import { ReferenceSelect } from '@/ui/settings/ReferenceSelect';
import { EntityPicker } from '@/ui/settings/EntityPicker';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';

export function SceneTargetRow({
  kind,
  targetKey,
  name,
  config,
  context,
  deviceOptions,
  catalogReady,
  draftKey,
  onChange,
  onRemove,
  onMove,
  canMoveUp,
  canMoveDown,
  onReplace,
  sceneId,
}: {
  sceneId?: string;
  kind: 'group' | 'device';
  targetKey: string;
  name: string;
  config: SceneDeviceConfig;
  context: SceneDraftContext;
  catalogReady: boolean;
  draftKey: string;
  deviceOptions: { id: string; name: string }[];
  onChange: (value: SceneDeviceConfig) => void;
  onRemove: () => void;
  onMove?: (direction: -1 | 1) => void;
  canMoveUp?: boolean;
  canMoveDown?: boolean;
  onReplace: (key: string) => void;
}) {
  const { advanced } = useSettingsPreferences();
  const [showDescriptor, setShowDescriptor] = useState(false);
  const [clipboard, setClipboard] = useAtom(sceneClipboardAtom);
  const mode = sceneTargetMode(config);
  if (mode === 'unsupported')
    return (
      <UnsupportedSceneTarget
        kind={kind}
        targetKey={targetKey}
        name={name}
        value={config}
        issue={sceneTargetIssue(config)!}
        onReplace={() => onChange({})}
        onRemove={onRemove}
      />
    );
  const prefix = `${kind === 'group' ? 'group_states' : 'device_states'}/${targetKey}`;
  const sourceKey = `${kind}:${targetKey}`;
  const isClipboardSource =
    clipboard?.sourceKey === sourceKey && clipboard.sceneId === sceneId;
  const copyTarget = () => {
    const clip = {
      config: structuredClone(config),
      sourceName: name,
      sourceKey,
      sceneId,
    };
    setClipboard(clip);
    toast.success(`Copied ${name}`, { description: describeClipboard(clip) });
  };
  const pasteTarget = (fields?: ['color']) => {
    if (!clipboard) return;
    onChange(pasteSceneTarget(config, clipboard, fields));
  };
  const patch = (value: Record<string, unknown>) =>
    onChange(patchSceneTarget(config, value));
  const keys = targetDeviceKeys(kind, targetKey, context);
  const resolved = keys.map((key) => resolveDraftTarget(config, key, context));
  const first = resolved[0];
  const mixed = resolved.some(
    (state) => JSON.stringify(state) !== JSON.stringify(first),
  );
  const caps: Capabilities[] = keys.flatMap((key) => {
    const data = context.devices[key]?.data;
    return data && 'Controllable' in data
      ? [data.Controllable.capabilities]
      : [];
  });
  const supportsBrightness =
    !caps.length ||
    caps.some(
      (cap) =>
        cap.brightness !== false &&
        (cap.brightness || cap.hs || cap.rgb || cap.xy || cap.ct),
    );
  const missing =
    kind === 'group'
      ? !context.groups.some((group) => group.id === targetKey)
      : catalogReady && !context.devices[keys[0]];
  const state = config as SceneDeviceState;
  const hasDescriptor =
    'scene_id' in config &&
    (config.device_keys != null ||
      config.group_keys != null ||
      config.use_scene_transition === true ||
      (config as unknown as Record<string, unknown>).mirror_from_group != null);
  const targetOptions =
    kind === 'group'
      ? context.groups.map((group) => ({ id: group.id, name: group.name }))
      : deviceOptions;
  const sourceOptions = deviceOptions.filter((option) => {
    const data = context.devices[option.id]?.data;
    return data && ('Controllable' in data || 'power' in data.Sensor);
  });
  return (
    <div className="scene-target-row" role="row" data-target-key={targetKey}>
      <div
        role="cell"
        className="scene-target-name flex min-w-0 items-center gap-3"
      >
        <StatePreview
          {...first}
          certainty={
            mixed ? 'mixed' : first?.reason || !first ? 'unresolved' : 'known'
          }
          reason={
            first?.reason ?? (!first ? 'No devices in this group' : undefined)
          }
          samples={resolved.flatMap((state) =>
            state.color ? [state.color] : [],
          )}
          source="Target setting"
        />
        <div className="min-w-0 flex-1">
          <Link
            className="inline-flex max-w-full items-center gap-1 text-sm font-medium hover:underline"
            to={configItemHref(kind, targetKey)}
          >
            <span className="truncate">{name}</span>
            <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
          </Link>
          {advanced && (
            <p className="truncate font-mono text-[10px] text-muted-foreground">
              {targetKey}
            </p>
          )}
          {kind === 'group' && (
            <p className="text-xs text-muted-foreground">
              {keys.length} devices
            </p>
          )}
          {missing && <p className="text-xs text-amber-700">Missing target</p>}
        </div>
      </div>
      <div role="cell" className="scene-mode-cell">
        <label className="scene-field-label" htmlFor={`${prefix}/mode`}>
          Behavior
        </label>
        <SettingsSelect
          id={`${prefix}/mode`}
          data-field={prefix}
          aria-label={`${name} behavior`}
          className="w-full"
          value={mode}
          onValueChange={(next) =>
            onChange(
              entityDraftStore.switchVariant(
                draftKey,
                sceneTargetDraftPath(kind, targetKey),
                mode,
                config,
                next,
                next === 'device-link'
                  ? { integration_id: '', device_id: '' }
                  : next === 'scene-link'
                    ? { scene_id: '' }
                    : {},
              ),
            )
          }
          options={[
            { value: 'state', label: 'Set state' },
            { value: 'device-link', label: 'Follow device' },
            { value: 'scene-link', label: 'Follow scene' },
          ]}
        />
      </div>
      {mode === 'state' ? (
        <>
          <div role="cell">
            <label className="scene-field-label" htmlFor={`${prefix}/power`}>
              Power
            </label>
            <SettingsSelect
              id={`${prefix}/power`}
              aria-label={`${name} power`}
              className="w-full"
              value={
                state.power == null ? 'default' : state.power ? 'on' : 'off'
              }
              onValueChange={(next) =>
                patch({
                  power: next === 'default' ? undefined : next === 'on',
                })
              }
              options={[
                { value: 'default', label: 'Default · On' },
                { value: 'on', label: 'On' },
                { value: 'off', label: 'Off' },
              ]}
            />
          </div>
          <div role="cell">
            <label
              className="scene-field-label"
              htmlFor={`${prefix}/brightness`}
            >
              Brightness
            </label>
            <div className="flex items-center gap-2">
              <input
                className="min-w-0 flex-1 accent-primary"
                aria-label={`${name} brightness slider`}
                type="range"
                min="0"
                max="100"
                value={Math.round((state.brightness ?? 1) * 100)}
                disabled={!supportsBrightness && state.brightness == null}
                onChange={(event) =>
                  patch({ brightness: Number(event.target.value) / 100 })
                }
              />
              <Input
                id={`${prefix}/brightness`}
                data-field={`${prefix}/brightness`}
                className="w-[68px] px-2"
                type="number"
                min="0"
                max="100"
                aria-label={`${name} brightness percent`}
                placeholder="100"
                disabled={!supportsBrightness && state.brightness == null}
                value={
                  state.brightness == null
                    ? ''
                    : Math.round(state.brightness * 10000) / 100
                }
                onChange={(event) =>
                  patch({
                    brightness:
                      event.target.value === ''
                        ? undefined
                        : Number(event.target.value) / 100,
                  })
                }
              />
              <span className="text-xs text-muted-foreground">%</span>
            </div>
            {!supportsBrightness ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                No dimming support
              </p>
            ) : (
              state.brightness == null && (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Default · 100% when on
                </p>
              )
            )}
          </div>
          <div role="cell">
            <span className="scene-field-label">Color</span>
            <SceneColorControl
              field={`${prefix}/color`}
              color={state.color}
              brightness={state.brightness ?? 1}
              onChange={(color) => patch({ color })}
              capabilities={caps}
            />
          </div>
        </>
      ) : (
        <div role="cell" className="scene-link-fields">
          {'integration_id' in config ? (
            <>
              <label className="grid min-w-0 flex-1 gap-1">
                <span className="text-[10px] text-muted-foreground">
                  Source device
                </span>
                <ReferenceSelect
                  value={
                    config.device_id
                      ? `${config.integration_id}/${config.device_id}`
                      : ''
                  }
                  options={sourceOptions}
                  label={`${name} source device`}
                  href={
                    config.device_id
                      ? configItemHref(
                          'device',
                          `${config.integration_id}/${config.device_id}`,
                        )
                      : undefined
                  }
                  onChange={(key) => {
                    const slash = key.indexOf('/');
                    patch({
                      integration_id: slash < 0 ? '' : key.slice(0, slash),
                      device_id: slash < 0 ? '' : key.slice(slash + 1),
                    });
                  }}
                />
              </label>
              <label className="grid w-28 gap-1 text-[10px] text-muted-foreground">
                Brightness scale
                <Input
                  data-field={`${prefix}/brightness`}
                  aria-label={`${name} brightness multiplier`}
                  type="number"
                  min="0"
                  step="0.05"
                  placeholder="1"
                  value={config.brightness ?? ''}
                  onChange={(event) =>
                    patch({
                      brightness:
                        event.target.value === ''
                          ? undefined
                          : Number(event.target.value),
                    })
                  }
                />
              </label>
            </>
          ) : (
            'scene_id' in config && (
              <label className="grid min-w-0 flex-1 gap-1">
                <span className="text-[10px] text-muted-foreground">
                  Use its state for the same target device
                </span>
                <ReferenceSelect
                  value={config.scene_id}
                  options={context.scenes.map((scene) => ({
                    id: scene.id,
                    name: scene.name,
                  }))}
                  label={`${name} source scene`}
                  href={
                    config.scene_id
                      ? configItemHref('scene', config.scene_id)
                      : undefined
                  }
                  onChange={(scene_id) => patch({ scene_id })}
                />
              </label>
            )
          )}
          <span className="scene-resolved-summary text-xs text-muted-foreground">
            {mixed
              ? 'Mixed states'
              : (first?.reason ??
                (first
                  ? `${first.power === false ? 'Off' : 'On'} · ${first.brightness == null ? 'Unspecified brightness' : Math.round(first.brightness * 100) + '%'}${first.color ? ' · ' + formatColorExact(first.color) : ''}`
                  : 'No devices'))}
          </span>
        </div>
      )}
      <div role="cell">
        <label className="scene-field-label" htmlFor={`${prefix}/transition`}>
          Fade (s)
        </label>
        {'integration_id' in config ? (
          <span className="text-xs text-muted-foreground">From source</span>
        ) : (
          <Input
            id={`${prefix}/transition`}
            data-field={`${prefix}/transition`}
            type="number"
            min="0"
            step="0.1"
            aria-label={`${name} fade seconds`}
            placeholder="Default"
            value={state.transition ?? ''}
            onChange={(event) =>
              patch({
                transition:
                  event.target.value === ''
                    ? undefined
                    : Number(event.target.value),
              })
            }
          />
        )}
      </div>
      <div role="cell" className="scene-row-menu">
        {clipboard && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Paste ${clipboard.sourceName} onto ${name}`}
            title={
              isClipboardSource
                ? 'Copied from this row'
                : `Paste ${clipboard.sourceName}: ${describeClipboard(clipboard)}`
            }
            disabled={isClipboardSource}
            onClick={() => pasteTarget()}
          >
            <ClipboardPaste className="size-4" />
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Actions for ${name}`}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={copyTarget}>
              <Copy className="size-4" />
              Copy target state
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!clipboard || isClipboardSource}
              onSelect={() => pasteTarget()}
            >
              <ClipboardPaste className="size-4" />
              {clipboard
                ? `Paste from ${clipboard.sourceName}`
                : 'Paste target state'}
            </DropdownMenuItem>
            {clipboard && clipboardFields(clipboard).includes('color') && (
              <DropdownMenuItem
                disabled={isClipboardSource}
                onSelect={() => pasteTarget(['color'])}
              >
                <Palette className="size-4" />
                Paste color only
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {onMove && (
              <>
                <DropdownMenuItem
                  disabled={!canMoveUp}
                  onSelect={() => onMove(-1)}
                >
                  <ArrowUp className="size-4" />
                  Move earlier
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!canMoveDown}
                  onSelect={() => onMove(1)}
                >
                  <ArrowDown className="size-4" />
                  Move later
                </DropdownMenuItem>
              </>
            )}
            {'scene_id' in config && (
              <DropdownMenuItem
                onSelect={() => setShowDescriptor(!showDescriptor)}
              >
                Stored activation options
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={onRemove} className="text-destructive">
              <Trash2 className="size-4" />
              Remove target
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {missing && (
        <div
          role="group"
          aria-label={`Repair ${name}`}
          className="scene-row-extra flex flex-col gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-950 sm:flex-row sm:items-center dark:border-amber-400/40 dark:bg-amber-400/10 dark:text-amber-100"
        >
          <p className="text-xs sm:flex-1">
            {kind === 'group'
              ? 'This room or group no longer exists.'
              : 'This device is not available.'}{' '}
            Pick a replacement to keep these settings, or remove the target.
          </p>
          <div className="min-w-0 sm:w-72">
            <ReferenceSelect
              value=""
              options={targetOptions}
              label={`Replace ${name}`}
              placeholder={
                kind === 'group' ? 'Replace with room…' : 'Replace with device…'
              }
              onChange={onReplace}
            />
          </div>
          <Button variant="outline" size="sm" onClick={onRemove}>
            Remove
          </Button>
        </div>
      )}
      {'scene_id' in config && (showDescriptor || hasDescriptor) && (
        <div className="scene-row-extra rounded-md border border-border bg-muted/20 p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            Stored activation options. Scene target links read the same target
            device; these scope and mirror fields are preserved for activation
            descriptors and do not change target-link resolution.
          </p>
          <div className="flex flex-wrap gap-2">
            <EntityPicker
              title="Activation devices"
              actionLabel={`${config.device_keys?.length ?? 0} devices`}
              options={deviceOptions}
              selected={config.device_keys ?? []}
              onChange={(device_keys) => patch({ device_keys })}
            />
            <EntityPicker
              title="Activation groups"
              actionLabel={`${config.group_keys?.length ?? 0} groups`}
              options={context.groups.map((group) => ({
                id: group.id,
                name: group.name,
              }))}
              selected={config.group_keys ?? []}
              onChange={(group_keys) => patch({ group_keys })}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                patch({ device_keys: undefined, group_keys: undefined })
              }
            >
              Use default scope
            </Button>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={config.use_scene_transition ?? false}
                onChange={(event) =>
                  patch({ use_scene_transition: event.target.checked })
                }
              />
              Use scene transition
            </label>
          </div>
          {(advanced || 'mirror_from_group' in config) && (
            <div className="mt-2">
              <p className="mb-1 text-xs text-muted-foreground">
                Mirror group (activation only)
              </p>
              <ReferenceSelect
                label="Mirror group (activation only)"
                value={String(
                  (config as unknown as Record<string, unknown>)
                    .mirror_from_group ?? '',
                )}
                options={context.groups.map((group) => ({
                  id: group.id,
                  name: group.name,
                }))}
                onChange={(mirror_from_group) =>
                  patch({ mirror_from_group: mirror_from_group || undefined })
                }
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
