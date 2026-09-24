import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  SceneDeviceConfig,
  SceneDeviceState,
  SceneDeviceLink,
  ActivateSceneDescriptor,
  Scene,
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
import { Card, CardContent } from '@/ui/primitives/card';
import { Input } from '@/ui/primitives/input';
import {
  DeviceSelect,
  SceneSelect,
  splitDeviceKey,
} from '@/ui/config-selectors';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { SceneColorEditor } from '@/ui/SceneColorEditor';
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
  onChange: (config: SceneDeviceState) => void;
}

export function DeviceStateEditor({
  config,
  onChange,
}: DeviceStateEditorProps) {
  return (
    <div className="space-y-3">
      {/* Power */}
      <div className={fieldClassName}>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            className={checkboxClassName}
            checked={config.power ?? true}
            onChange={(e) => onChange({ ...config, power: e.target.checked })}
          />
          <span className={fieldLabelClassName}>Power</span>
        </label>
      </div>

      {/* Brightness */}
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>
            Brightness: {Math.round((config.brightness ?? 1) * 100)}%
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round((config.brightness ?? 1) * 100)}
          className={rangeClassName}
          onChange={(e) =>
            onChange({ ...config, brightness: Number(e.target.value) / 100 })
          }
        />
      </div>

      {/* Transition */}
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>
            Transition: {config.transition ?? 0.4}s
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="50"
          step="1"
          value={(config.transition ?? 0.4) * 10}
          className={rangeClassName}
          onChange={(e) =>
            onChange({ ...config, transition: Number(e.target.value) / 10 })
          }
        />
      </div>

      <SceneColorEditor
        color={config.color}
        brightness={config.brightness}
        onChange={(color) => onChange({ ...config, color })}
      />
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

      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>
            Brightness Override:{' '}
            {config.brightness !== undefined
              ? `${Math.round(config.brightness * 100)}%`
              : 'None'}
          </span>
        </label>
        <div className="flex items-center gap-2">
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
          {config.brightness !== undefined && (
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(config.brightness * 100)}
              className={cn(rangeClassName, 'flex-1')}
              onChange={(e) =>
                onChange({
                  ...config,
                  brightness: Number(e.target.value) / 100,
                })
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface SceneLinkEditorProps {
  config: ActivateSceneDescriptor;
  scenes: Scene[];
  onChange: (config: ActivateSceneDescriptor) => void;
}

function SceneLinkEditor({ config, scenes, onChange }: SceneLinkEditorProps) {
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

      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Transition Override (s)</span>
        </label>
        <Input
          type="number"
          min="0"
          step="0.1"
          className="h-9"
          value={config.transition ?? ''}
          placeholder="Use linked scene transition"
          onChange={(e) => {
            const nextValue = e.target.value.trim();
            onChange({
              ...config,
              transition: nextValue
                ? Math.max(0, Number(nextValue))
                : undefined,
            });
          }}
        />
        <span className={helpTextClassName}>
          Leave empty to inherit the linked scene&apos;s transition values.
        </span>
      </div>
    </div>
  );
}

export interface SceneTargetConfigEditorProps {
  targetKey: string;
  targetLabel?: string;
  config: SceneDeviceConfig;
  devices: DevicesState;
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
}

export function SceneTargetConfigEditor({
  targetKey,
  targetLabel,
  config,
  devices,
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
}: SceneTargetConfigEditorProps) {
  const configType = getConfigType(config);
  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focused) {
      cardRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [focused]);

  const handleTypeChange = (
    newType: 'device_state' | 'device_link' | 'scene_link',
  ) => {
    if (newType === 'device_state') {
      onChange({ power: true, brightness: 1 });
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
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-semibold">{targetLabel ?? targetKey}</h4>
            {/* One line: what this target does right now, so the fields below
                stay closed until someone wants to change them. */}
            <p className="text-xs text-muted-foreground">
              {summarizeTarget(config)}
              {targetLabel && targetLabel !== targetKey ? (
                <span className="ml-2 font-mono">{targetKey}</span>
              ) : null}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {position !== undefined && targetCount !== undefined && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8"
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
                  className="size-8"
                  aria-label={`Move ${targetLabel ?? targetKey} later`}
                  title="Move later"
                  disabled={position === targetCount - 1}
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
              className="text-destructive hover:text-destructive"
              onClick={onRemove}
            >
              ✕
            </Button>
          </div>
        </div>

        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
            Edit target
          </summary>
          <div className={cn(fieldClassName, 'mt-3')}>
            <label>
              <span className={fieldLabelClassName}>Config Type</span>
            </label>
            <select
              className={selectClassName}
              value={configType}
              onChange={(e) =>
                handleTypeChange(
                  e.target.value as
                    'device_state' | 'device_link' | 'scene_link',
                )
              }
            >
              <option value="device_state">Device State</option>
              <option value="device_link">Link to Device</option>
              <option value="scene_link">Link to Scene</option>
            </select>
          </div>

          <div className="my-2 h-px bg-border" />

          <SceneResolvedColorPreview
            config={config}
            devices={devices}
            scenes={allScenes}
            targetKey={targetKey}
            targetKind={targetKind}
          />

          {isDeviceState(config) && (
            <DeviceStateEditor config={config} onChange={onChange} />
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
              onChange={onChange}
            />
          )}
        </details>
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
}

export interface AddSceneTargetModalProps {
  options: SceneTargetOption[];
  existingKeys: string[];
  onAdd: (targetKey: string) => void;
  onClose: () => void;
}

export function AddSceneTargetModal({
  options,
  existingKeys,
  onAdd,
  onClose,
}: AddSceneTargetModalProps) {
  const [search, setSearch] = useState('');

  const availableTargets = options
    .filter(({ key }) => !existingKeys.includes(key))
    .filter(
      ({ key, label }) =>
        key.toLowerCase().includes(search.toLowerCase()) ||
        label.toLowerCase().includes(search.toLowerCase()),
    );

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title="Add Target"
      description="Choose a device or group target for this scene."
      className="max-w-2xl"
    >
      <div className="space-y-4 px-5 pb-5 md:px-0 md:pb-0">
        <Input
          type="text"
          className="w-full"
          placeholder="Search targets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="mt-4 max-h-60 overflow-y-auto">
          {availableTargets.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No targets found
            </p>
          ) : (
            <div className="space-y-1">
              {availableTargets.map(({ key, label }) => (
                <Button
                  key={key}
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => {
                    onAdd(key);
                    onClose();
                  }}
                >
                  <span className="truncate">
                    {label}{' '}
                    <span className="text-muted-foreground">({key})</span>
                  </span>
                </Button>
              ))}
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
