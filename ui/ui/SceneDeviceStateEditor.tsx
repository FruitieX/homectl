import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  SceneDeviceConfig,
  SceneDeviceState,
  SceneDeviceLink,
  ActivateSceneDescriptor,
  Scene,
  Group,
  getSceneDeviceLinkTargetKey,
} from '@/hooks/useConfig';
import { Device } from '@/bindings/Device';
import { DevicesState } from '@/bindings/DevicesState';
import {
  SceneResolvedColorPreview,
  type SceneTargetKind,
} from '@/ui/SceneResolvedColorPreview';
import { cn } from '@/lib/cn';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { Card, CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import {
  DeviceSelect,
  SceneSelect,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { SceneColorEditor } from '@/ui/SceneColorEditor';
import { isDimmableDevice } from '@/lib/brightnessCalibration';
import type { DeviceColorMode } from '@/lib/deviceColor';
import {
  SearchableMultiPicker,
  SearchablePicker,
  type PickerOption,
} from '@/ui/SearchablePicker';
import { ChevronDown, ChevronUp } from 'lucide-react';

const selectClassName =
  'h-9 rounded-lg border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const rangeClassName =
  'h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary';
const fieldClassName = 'space-y-2';
const fieldLabelClassName = 'text-sm font-medium';
const helpTextClassName = 'text-xs text-muted-foreground';

function percentText(value: number) {
  return String(Number((value * 100).toFixed(3)));
}

// Helper to determine the config type
function getConfigType(
  config: SceneDeviceConfig,
): 'device_state' | 'device_link' | 'scene_link' {
  if ('scene_id' in config) return 'scene_link';
  if ('integration_id' in config) return 'device_link';
  return 'device_state';
}

// Helper to check if a value is a device state
function isDeviceState(config: SceneDeviceConfig): config is SceneDeviceState {
  return getConfigType(config) === 'device_state';
}

function isDeviceLink(config: SceneDeviceConfig): config is SceneDeviceLink {
  return getConfigType(config) === 'device_link';
}

function isSceneLink(
  config: SceneDeviceConfig,
): config is ActivateSceneDescriptor {
  return getConfigType(config) === 'scene_link';
}

interface DeviceStateEditorProps {
  config: SceneDeviceState;
  device?: Device;
  onChange: (config: SceneDeviceState) => void;
}

export function DeviceStateEditor({
  config,
  device,
  onChange,
}: DeviceStateEditorProps) {
  const controllable =
    device && 'Controllable' in device.data ? device.data.Controllable : null;
  const supportsBrightness = device
    ? Boolean(controllable && isDimmableDevice(device))
    : true;
  const supportedColorModes: DeviceColorMode[] | undefined = device
    ? controllable
      ? [
          ...(controllable.capabilities.hs ? (['hs'] as const) : []),
          ...(controllable.capabilities.rgb ? (['rgb'] as const) : []),
          ...(controllable.capabilities.xy ? (['xy'] as const) : []),
          ...(controllable.capabilities.ct ? (['ct'] as const) : []),
        ]
      : []
    : undefined;
  const supportsColor =
    supportedColorModes === undefined ||
    supportedColorModes.length > 0 ||
    config.color !== undefined;
  const [brightnessInput, setBrightnessInput] = useState(
    config.brightness === undefined ? '' : percentText(config.brightness),
  );
  const [transitionInput, setTransitionInput] = useState(
    config.transition === undefined ? '' : String(config.transition),
  );

  useEffect(() => {
    setBrightnessInput(
      config.brightness === undefined ? '' : percentText(config.brightness),
    );
  }, [config.brightness]);
  useEffect(() => {
    setTransitionInput(
      config.transition === undefined ? '' : String(config.transition),
    );
  }, [config.transition]);

  const setOptionalNumber = (
    key: 'brightness' | 'transition',
    value: number | undefined,
  ) => {
    const next = { ...config };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className={fieldClassName}>
        <label className={fieldLabelClassName}>
          Power
          <select
            className={`${selectClassName} mt-2 block`}
            value={
              config.power === undefined
                ? 'unchanged'
                : config.power
                  ? 'on'
                  : 'off'
            }
            onChange={(event) => {
              const value = event.target.value;
              onChange({
                ...config,
                power: value === 'unchanged' ? undefined : value === 'on',
              });
            }}
          >
            <option value="unchanged">Leave unchanged</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
      </div>

      {supportsBrightness || config.brightness !== undefined ? (
        <div className={fieldClassName}>
          <span className={fieldLabelClassName}>Brightness</span>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={config.brightness !== undefined}
              onChange={(event) =>
                setOptionalNumber(
                  'brightness',
                  event.target.checked ? 1 : undefined,
                )
              }
            />
            Set brightness
          </label>
          {config.brightness !== undefined ? (
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={config.brightness * 100}
                aria-label="Brightness slider"
                className={cn(rangeClassName, 'flex-1')}
                onChange={(event) =>
                  setOptionalNumber(
                    'brightness',
                    Number(event.target.value) / 100,
                  )
                }
              />
              <div className="flex items-center gap-1">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={brightnessInput}
                  aria-label="Brightness percent"
                  className="h-9 w-24"
                  onChange={(event) => {
                    const value = event.target.value;
                    setBrightnessInput(value);
                    if (value !== '' && Number.isFinite(Number(value))) {
                      setOptionalNumber(
                        'brightness',
                        Math.max(0, Math.min(100, Number(value))) / 100,
                      );
                    }
                  }}
                  onBlur={() => {
                    if (brightnessInput === '') {
                      setOptionalNumber('brightness', undefined);
                    }
                  }}
                />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            </div>
          ) : null}
          {!supportsBrightness && config.brightness !== undefined ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              This saved brightness is retained, though the device does not
              advertise brightness support.
            </p>
          ) : null}
        </div>
      ) : null}

      <div className={fieldClassName}>
        <span className={fieldLabelClassName}>Fade</span>
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={config.transition !== undefined}
            onChange={(event) =>
              setOptionalNumber(
                'transition',
                event.target.checked ? 0.4 : undefined,
              )
            }
          />
          Set a fade duration
        </label>
        {config.transition !== undefined ? (
          <div className="flex items-center gap-3">
            <input
              type="range"
              min="0"
              max="5"
              step="0.1"
              value={config.transition}
              aria-label="Fade duration slider"
              className={cn(rangeClassName, 'flex-1')}
              onChange={(event) =>
                setOptionalNumber('transition', Number(event.target.value))
              }
            />
            <div className="flex items-center gap-1">
              <Input
                type="number"
                min="0"
                max="5"
                step="0.1"
                value={transitionInput}
                aria-label="Fade duration seconds"
                className="h-9 w-24"
                onChange={(event) => {
                  const value = event.target.value;
                  setTransitionInput(value);
                  if (value !== '' && Number.isFinite(Number(value))) {
                    setOptionalNumber(
                      'transition',
                      Math.max(0, Math.min(5, Number(value))),
                    );
                  }
                }}
                onBlur={() => {
                  if (transitionInput === '') {
                    setOptionalNumber('transition', undefined);
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">s</span>
            </div>
          </div>
        ) : null}
      </div>

      {supportsColor ? (
        <SceneColorEditor
          color={config.color}
          brightness={config.brightness}
          supportedModes={supportedColorModes}
          onChange={(color) => onChange({ ...config, color })}
        />
      ) : null}
    </div>
  );
}

interface DeviceLinkEditorProps {
  config: SceneDeviceLink;
  devices: DevicesState;
  onChange: (config: SceneDeviceLink) => void;
}

function DeviceLinkEditor({
  config,
  devices,
  onChange,
}: DeviceLinkEditorProps) {
  return (
    <div className="space-y-3">
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Link to Device</span>
        </label>
        <DeviceSelect
          devices={devices}
          value={getSceneDeviceLinkTargetKey(config)}
          onChange={(key) => {
            const { integration_id = '', device_id = '' } =
              splitDeviceKey(key) ?? {};
            onChange({
              ...config,
              integration_id,
              device_id: device_id || undefined,
            });
          }}
        />
        <span className={helpTextClassName}>
          Scene will copy state from this device (e.g. circadian color)
        </span>
      </div>

      <details>
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Advanced options
        </summary>
        <div className="space-y-3 pt-2">
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={config.brightness !== undefined}
              onChange={(e) =>
                onChange({
                  ...config,
                  brightness: e.target.checked ? 1 : undefined,
                })
              }
            />
            Override brightness from the source
          </label>
          {config.brightness !== undefined ? (
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={config.brightness * 100}
                aria-label="Brightness override slider"
                className={cn(rangeClassName, 'flex-1')}
                onChange={(e) =>
                  onChange({
                    ...config,
                    brightness: Number(e.target.value) / 100,
                  })
                }
              />
              <Input
                type="number"
                min="0"
                max="100"
                step="0.1"
                aria-label="Brightness override percent"
                className="h-9 w-24"
                value={percentText(config.brightness)}
                onChange={(e) => {
                  if (e.target.value === '') return;
                  const value = Number(e.target.value);
                  if (Number.isFinite(value)) {
                    onChange({
                      ...config,
                      brightness: Math.max(0, Math.min(100, value)) / 100,
                    });
                  }
                }}
              />
              <span className="text-sm text-muted-foreground">%</span>
            </div>
          ) : null}
        </div>
      </details>
    </div>
  );
}

interface SceneLinkEditorProps {
  config: ActivateSceneDescriptor;
  scenes: Scene[];
  devices: DevicesState;
  groups: Group[];
  onChange: (config: ActivateSceneDescriptor) => void;
}

function SceneLinkEditor({
  config,
  scenes,
  devices,
  groups,
  onChange,
}: SceneLinkEditorProps) {
  const deviceOptions: PickerOption[] = Object.entries(devices)
    .filter((entry): entry is [string, Device] => Boolean(entry[1]))
    .map(([key, device]) => ({
      value: key,
      label: device.name || key,
      detail: `Device · ${key.split('/', 1)[0]} · ${key}`,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const groupOptions: PickerOption[] = groups.map((group) => ({
    value: group.id,
    label: group.name,
    detail: `Room · ${group.id}`,
  }));

  return (
    <div className="space-y-3">
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Link to Scene</span>
        </label>
        <SceneSelect
          scenes={scenes}
          value={config.scene_id}
          onChange={(scene_id) => onChange({ ...config, scene_id })}
        />
        <span className={helpTextClassName}>
          Scene will inherit all device states from the linked scene
        </span>
      </div>

      <details>
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Advanced options
        </summary>
        <div className="space-y-4 pt-2">
          <div className={fieldClassName}>
            <span className={fieldLabelClassName}>Mirror from room</span>
            <SearchablePicker
              options={groupOptions}
              value={config.mirror_from_group ?? ''}
              onChange={(mirror_from_group) =>
                onChange({
                  ...config,
                  mirror_from_group: mirror_from_group || undefined,
                })
              }
              placeholder="Use this scene"
              ariaLabel="Mirror from room"
            />
            <span className={helpTextClassName}>
              Use that room&apos;s current scene, falling back to the selected
              scene when there is no unanimous current scene.
            </span>
          </div>

          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              className={checkboxClassName}
              checked={config.use_scene_transition ?? false}
              onChange={(event) =>
                onChange({
                  ...config,
                  use_scene_transition: event.target.checked,
                })
              }
            />
            Preserve the linked scene&apos;s transitions
          </label>

          <div className={fieldClassName}>
            <span className={fieldLabelClassName}>Limit to devices</span>
            <SearchableMultiPicker
              options={deviceOptions}
              value={config.device_keys ?? []}
              onChange={(device_keys) =>
                onChange({
                  ...config,
                  device_keys: device_keys.length ? device_keys : undefined,
                })
              }
              placeholder="Add devices…"
            />
            <span className={helpTextClassName}>
              Leave empty to include every device matched by the linked scene.
            </span>
          </div>

          <div className={fieldClassName}>
            <span className={fieldLabelClassName}>Limit to rooms</span>
            <SearchableMultiPicker
              options={groupOptions}
              value={config.group_keys ?? []}
              onChange={(group_keys) =>
                onChange({
                  ...config,
                  group_keys: group_keys.length ? group_keys : undefined,
                })
              }
              placeholder="Add rooms…"
            />
            <span className={helpTextClassName}>
              Leave empty to include every room matched by the linked scene.
            </span>
          </div>

          <div className={fieldClassName}>
            <label className={fieldLabelClassName}>
              Transition override (seconds)
              <Input
                type="number"
                min="0"
                step="0.1"
                className="mt-2 h-11"
                value={config.transition ?? ''}
                placeholder="Use linked scene transition"
                onChange={(event) => {
                  const value = event.target.value;
                  onChange({
                    ...config,
                    transition:
                      value === '' ? undefined : Math.max(0, Number(value)),
                  });
                }}
              />
            </label>
            <span className={helpTextClassName}>
              Leave empty to inherit the linked scene&apos;s transition values.
            </span>
          </div>
        </div>
      </details>
    </div>
  );
}

export interface SceneTargetConfigEditorProps {
  targetKey: string;
  targetLabel?: string;
  config: SceneDeviceConfig;
  devices: DevicesState;
  groups?: Group[];
  allScenes: Scene[];
  targetKind: SceneTargetKind;
  scenes: Scene[];
  onChange: (config: SceneDeviceConfig) => void;
  onRemove: () => void;
  position?: number;
  targetCount?: number;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  focused?: boolean;
  /** The one row whose fields are open in this collection. */
  selected?: boolean;
  onSelect?: () => void;
}

export function SceneTargetConfigEditor({
  targetKey,
  targetLabel,
  config,
  devices,
  groups = [],
  allScenes,
  targetKind,
  scenes,
  onChange,
  onRemove,
  position,
  targetCount,
  onMoveUp,
  onMoveDown,
  focused,
  selected = false,
  onSelect,
}: SceneTargetConfigEditorProps) {
  const configType = getConfigType(config);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) {
      cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focused]);

  const handleTypeChange = async (
    newType: 'device_state' | 'device_link' | 'scene_link',
  ) => {
    const color = 'color' in config ? config.color : undefined;
    if (newType !== 'device_state' && color) {
      const confirmed = await confirmDialog({
        title: 'Change target mode?',
        description:
          'This target has a saved color. Changing to a follow mode removes that color from this target.',
        confirmLabel: 'Change mode',
        cancelLabel: 'Keep current mode',
      });
      if (!confirmed) return;
    }
    if (newType === 'device_state') {
      onChange({});
    } else if (newType === 'device_link') {
      onChange({ integration_id: '', device_id: '' });
    } else {
      onChange({ scene_id: '', transition: undefined });
    }
  };

  return (
    <Card
      ref={cardRef}
      className={cn(
        'rounded-2xl bg-muted/30',
        focused && 'border-primary ring-2 ring-primary/40',
      )}
    >
      <CardContent className="p-4">
        <div className="flex flex-col gap-2 min-[360px]:flex-row min-[360px]:items-start min-[360px]:justify-between">
          <button
            type="button"
            onClick={onSelect}
            aria-expanded={selected}
            className="min-w-0 flex-1 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <h4 className="flex items-center gap-1.5 font-semibold">
              <ChevronRight
                aria-hidden
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
                  selected && 'rotate-90',
                )}
              />
              <span className="min-w-0 truncate">
                {targetLabel ?? targetKey}
              </span>
            </h4>
            {/* One line: what this target does right now, so the fields below
                stay closed until someone wants to change them. */}
            <p className="text-xs text-muted-foreground">
              {summarizeTarget(config)}
              {targetLabel && targetLabel !== targetKey ? (
                <span className="ml-2 break-all font-mono">{targetKey}</span>
              ) : null}
            </p>
          </button>
          <div className="flex shrink-0 items-center gap-1">
            {position !== undefined && (targetCount ?? 0) > 1 && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={`Move ${targetLabel ?? targetKey} earlier`}
                  title="Move earlier"
                  disabled={position === 0}
                  onClick={onMoveUp}
                >
                  <ChevronUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={`Move ${targetLabel ?? targetKey} later`}
                  title="Move later"
                  disabled={position === (targetCount ?? 1) - 1}
                  onClick={onMoveDown}
                >
                  <ChevronDown />
                </Button>
              </>
            )}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-11 text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              Remove
            </Button>
          </div>
        </div>

        {selected ? (
          <>
            <div className={cn(fieldClassName, 'mt-3')}>
              <label>
                <span className={fieldLabelClassName}>
                  What this target does
                </span>
              </label>
              <select
                className={selectClassName}
                value={configType}
                onChange={(e) =>
                  void handleTypeChange(
                    e.target.value as
                      'device_state' | 'device_link' | 'scene_link',
                  )
                }
              >
                <option value="device_state">Set a state</option>
                <option value="device_link">Follow a device</option>
                <option value="scene_link">Use another scene</option>
              </select>
            </div>

            <div className="my-2 h-px bg-border" />

            <p className="text-xs font-medium text-muted-foreground">
              Draft preview · updates as you change this target
            </p>
            <SceneResolvedColorPreview
              config={config}
              devices={devices}
              scenes={allScenes}
              targetKey={targetKey}
              targetKind={targetKind}
            />

            {isDeviceState(config) && (
              <DeviceStateEditor
                config={config}
                device={
                  targetKind === 'device' ? devices[targetKey] : undefined
                }
                onChange={onChange}
              />
            )}
            {isDeviceLink(config) && (
              <DeviceLinkEditor
                config={config}
                devices={devices}
                onChange={onChange}
              />
            )}
            {isSceneLink(config) && (
              <SceneLinkEditor
                config={config}
                scenes={scenes}
                devices={devices}
                groups={groups}
                onChange={onChange}
              />
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** A short, plain description of what this target currently does. */
function summarizeTarget(config: SceneDeviceConfig): string {
  if (isDeviceState(config)) {
    const parts: string[] = [config.power === false ? 'Off' : 'On'];
    if (config.brightness !== undefined) {
      parts.push(`${Math.round(config.brightness * 100)}%`);
    }
    return parts.join(' · ');
  }
  if (isDeviceLink(config)) {
    const target = [config.integration_id, config.device_id]
      .filter(Boolean)
      .join('/');
    return target ? `Follows ${target}` : 'Follows a device (not chosen yet)';
  }
  if (isSceneLink(config)) {
    return config.scene_id
      ? `Follows scene ${config.scene_id}`
      : 'Follows a scene (not chosen yet)';
  }
  return 'Not configured yet';
}

export interface SceneTargetOption {
  key: string;
  label: string;
  detail?: string;
  kind?: SceneTargetKind;
}

export interface AddSceneTargetModalProps {
  options: SceneTargetOption[];
  existingKeys: string[];
  onAdd: (targetKey: string, kind?: SceneTargetKind) => void;
  onClose: () => void;
}

export function AddSceneTargetModal({
  options,
  existingKeys,
  onAdd,
  onClose,
}: AddSceneTargetModalProps) {
  const [search, setSearch] = useState('');

  const availableMatches = options.filter(({ key, label, detail, kind }) => {
    const selectedKey = kind ? `${kind}:${key}` : key;
    if (existingKeys.includes(key) || existingKeys.includes(selectedKey)) {
      return false;
    }
    const query = search.trim().toLocaleLowerCase();
    return (
      !query ||
      `${label} ${key} ${detail ?? ''} ${kind ?? ''}`
        .toLocaleLowerCase()
        .includes(query)
    );
  });
  const availableTargets = availableMatches.slice(0, 40);

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Add device or room"
      description="Search by name, room, integration, or ID."
      className="max-w-2xl"
    >
      <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
        <Input
          type="text"
          className="w-full"
          aria-label="Search devices and rooms"
          placeholder="Search by name, room, integration, or ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="mt-4 max-h-60 overflow-y-auto">
          {availableMatches.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No devices or rooms match this search.
            </p>
          ) : (
            <div
              className="space-y-1"
              role="group"
              aria-label="Available targets"
            >
              {availableTargets.map(({ key, label, detail, kind }) => (
                <Button
                  key={`${kind ?? 'target'}:${key}`}
                  variant="ghost"
                  className="h-auto min-h-11 w-full justify-start py-2 text-left"
                  onClick={() => {
                    onAdd(key, kind);
                    onClose();
                  }}
                >
                  <span className="min-w-0">
                    <span className="block truncate">
                      {label}{' '}
                      <span className="text-xs text-muted-foreground">
                        {kind === 'group'
                          ? 'Room'
                          : kind === 'device'
                            ? 'Device'
                            : ''}
                      </span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {detail ?? key}
                    </span>
                  </span>
                </Button>
              ))}
              {availableMatches.length > availableTargets.length ? (
                <p className="px-2 py-2 text-xs text-muted-foreground">
                  Showing {availableTargets.length} of {availableMatches.length}{' '}
                  matches. Add more search terms to narrow the list.
                </p>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </ResponsiveOverlay>
  );
}

interface SceneDeviceStateEditorProps {
  scene: Scene;
  devices: DevicesState;
  scenes: Scene[];
  onSave: (deviceStates: Record<string, SceneDeviceConfig>) => void;
  onCancel: () => void;
}

interface SceneTargetSectionEditorProps {
  addLabel: string;
  allScenes: Scene[];
  emptyDescription: string;
  emptyTitle: string;
  items: Record<string, SceneDeviceConfig>;
  options: SceneTargetOption[];
  scenes: Scene[];
  sectionTitle: string;
  targetKind: SceneTargetKind;
  devices: DevicesState;
  groups?: Group[];
  onChange: (items: Record<string, SceneDeviceConfig>) => void;
  order?: string[];
  onOrderChange?: (order: string[]) => void;
  focusTargetKey?: string | null;
  focusNonce?: number;
}

export function SceneTargetSectionEditor({
  addLabel,
  allScenes,
  emptyDescription,
  emptyTitle,
  items,
  options,
  scenes,
  sectionTitle,
  targetKind,
  devices,
  groups = [],
  onChange,
  order,
  onOrderChange,
  focusTargetKey,
  focusNonce = 0,
}: SceneTargetSectionEditorProps) {
  const [showAddTarget, setShowAddTarget] = useState(false);

  const handleChange = useCallback(
    (targetKey: string, config: SceneDeviceConfig) => {
      onChange({ ...items, [targetKey]: config });
    },
    [items, onChange],
  );

  const handleRemove = useCallback(
    (targetKey: string) => {
      const updated = { ...items };
      delete updated[targetKey];
      onChange(updated);
      onOrderChange?.(
        (order ?? Object.keys(items)).filter((key) => key !== targetKey),
      );
    },
    [items, onChange, onOrderChange, order],
  );

  const handleAddTarget = useCallback(
    (targetKey: string) => {
      onChange({
        ...items,
        [targetKey]: { power: true, brightness: 1 },
      });
      onOrderChange?.([...(order ?? Object.keys(items)), targetKey]);
    },
    [items, onChange, onOrderChange, order],
  );

  const orderedKeys = useMemo(
    () => [
      ...(order ?? []).filter((key) => key in items),
      ...Object.keys(items).filter((key) => !(order ?? []).includes(key)),
    ],
    [items, order],
  );

  const moveTarget = useCallback(
    (targetKey: string, direction: -1 | 1) => {
      const nextOrder = [...orderedKeys];
      const index = nextOrder.indexOf(targetKey);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= nextOrder.length) {
        return;
      }
      [nextOrder[index], nextOrder[nextIndex]] = [
        nextOrder[nextIndex],
        nextOrder[index],
      ];
      onOrderChange?.(nextOrder);
    },
    [onOrderChange, orderedKeys],
  );

  const optionLabelByKey = Object.fromEntries(
    options.map((option) => [option.key, option.label]),
  );

  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const appliedFocusNonce = useRef(0);
  const focusTimeout = useRef<number | null>(null);
  useEffect(() => {
    if (
      !focusTargetKey ||
      focusNonce === 0 ||
      appliedFocusNonce.current === focusNonce
    ) {
      return;
    }
    appliedFocusNonce.current = focusNonce;
    if (!(focusTargetKey in items)) {
      setFocusedKey(null);
      return;
    }
    setFocusedKey(focusTargetKey);
    if (focusTimeout.current !== null) {
      window.clearTimeout(focusTimeout.current);
    }
    focusTimeout.current = window.setTimeout(() => {
      focusTimeout.current = null;
      setFocusedKey(null);
    }, 2500);
  }, [focusNonce, focusTargetKey, items]);
  useEffect(
    () => () => {
      if (focusTimeout.current !== null) {
        window.clearTimeout(focusTimeout.current);
      }
    },
    [],
  );

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold">{sectionTitle}</h3>
        <Button size="sm" onClick={() => setShowAddTarget(true)}>
          {addLabel}
        </Button>
      </div>

      {Object.keys(items).length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 py-8 text-center text-muted-foreground">
          <p>{emptyTitle}</p>
          <p className="text-sm mt-1">{emptyDescription}</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {orderedKeys.map((targetKey, position) => {
            const config = items[targetKey];
            if (!config) return null;

            return (
              <SceneTargetConfigEditor
                key={targetKey}
                targetKey={targetKey}
                targetLabel={optionLabelByKey[targetKey]}
                config={config}
                devices={devices}
                groups={groups}
                allScenes={allScenes}
                targetKind={targetKind}
                scenes={scenes}
                onChange={(newConfig) => handleChange(targetKey, newConfig)}
                onRemove={() => handleRemove(targetKey)}
                position={onOrderChange ? position : undefined}
                targetCount={onOrderChange ? orderedKeys.length : undefined}
                onMoveUp={() => moveTarget(targetKey, -1)}
                onMoveDown={() => moveTarget(targetKey, 1)}
                focused={focusedKey === targetKey}
              />
            );
          })}
        </div>
      )}

      {showAddTarget && (
        <AddSceneTargetModal
          options={options}
          existingKeys={Object.keys(items)}
          onAdd={handleAddTarget}
          onClose={() => setShowAddTarget(false)}
        />
      )}
    </div>
  );
}

export function SceneDeviceStateEditor({
  scene,
  devices,
  scenes,
  onSave,
  onCancel,
}: SceneDeviceStateEditorProps) {
  const [deviceStates, setDeviceStates] = useState<
    Record<string, SceneDeviceConfig>
  >(scene.device_states || {});

  const otherScenes = scenes.filter((s) => s.id !== scene.id);
  const deviceOptions = Object.entries(devices)
    .map(([key, device]) => ({
      key,
      label: (device as Device).name,
    }))
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.key.localeCompare(right.key),
    );

  return (
    <div className="space-y-4">
      <SceneTargetSectionEditor
        addLabel="Add Device"
        allScenes={scenes}
        emptyDescription="Add devices to configure their states for this scene"
        emptyTitle="No device states configured"
        items={deviceStates}
        options={deviceOptions}
        scenes={otherScenes}
        sectionTitle={`Device States for "${scene.name}"`}
        targetKind="device"
        devices={devices}
        onChange={setDeviceStates}
      />

      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button onClick={() => onSave(deviceStates)}>Save Device States</Button>
      </div>
    </div>
  );
}

export default SceneDeviceStateEditor;
