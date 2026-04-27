import { useState, useCallback } from 'react';
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
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { SceneColorEditor } from '@/ui/SceneColorEditor';

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

function DeviceStateEditor({ config, onChange }: DeviceStateEditorProps) {
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
  const deviceList = Object.entries(devices).map(([key, device]) => ({
    key,
    device: device as Device,
  }));

  return (
    <div className="space-y-3">
      <div className={fieldClassName}>
        <label>
          <span className={fieldLabelClassName}>Link to Device</span>
        </label>
        <select
          className={selectClassName}
          value={getSceneDeviceLinkTargetKey(config)}
          onChange={(e) => {
            const [integration_id, ...deviceIdParts] =
              e.target.value.split('/');
            const device_id = deviceIdParts.join('/');

            onChange({
              ...config,
              integration_id,
              device_id: device_id || undefined,
            });
          }}
        >
          <option value="">Select a device...</option>
          {deviceList.map(({ key, device }) => (
            <option key={key} value={key}>
              {device.name} ({key})
            </option>
          ))}
        </select>
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
        <select
          className={selectClassName}
          value={config.scene_id}
          onChange={(e) => onChange({ ...config, scene_id: e.target.value })}
        >
          <option value="">Select a scene...</option>
          {scenes.map((scene) => (
            <option key={scene.id} value={scene.id}>
              {scene.name} ({scene.id})
            </option>
          ))}
        </select>
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

interface SceneTargetConfigEditorProps {
  targetKey: string;
  targetLabel?: string;
  config: SceneDeviceConfig;
  devices: DevicesState;
  allScenes: Scene[];
  targetKind: SceneTargetKind;
  scenes: Scene[];
  onChange: (config: SceneDeviceConfig) => void;
  onRemove: () => void;
}

function SceneTargetConfigEditor({
  targetKey,
  targetLabel,
  config,
  devices,
  allScenes,
  targetKind,
  scenes,
  onChange,
  onRemove,
}: SceneTargetConfigEditorProps) {
  const configType = getConfigType(config);

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
    <Card className="rounded-2xl bg-muted/30">
      <CardContent className="p-4">
        <div className="flex justify-between items-start">
          <div>
            <h4 className="font-semibold">{targetLabel ?? targetKey}</h4>
            <p className="text-xs text-muted-foreground">{targetKey}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            onClick={onRemove}
          >
            ✕
          </Button>
        </div>

        <div className={cn(fieldClassName, 'mt-2')}>
          <label>
            <span className={fieldLabelClassName}>Config Type</span>
          </label>
          <select
            className={selectClassName}
            value={configType}
            onChange={(e) =>
              handleTypeChange(
                e.target.value as 'device_state' | 'device_link' | 'scene_link',
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
      </CardContent>
    </Card>
  );
}

export interface SceneTargetOption {
  key: string;
  label: string;
}

interface AddSceneTargetModalProps {
  options: SceneTargetOption[];
  existingKeys: string[];
  onAdd: (targetKey: string) => void;
  onClose: () => void;
}

function AddSceneTargetModal({
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
    },
    [items, onChange],
  );

  const handleAddTarget = useCallback(
    (targetKey: string) => {
      onChange({
        ...items,
        [targetKey]: { power: true, brightness: 1 },
      });
    },
    [items, onChange],
  );

  const optionLabelByKey = Object.fromEntries(
    options.map((option) => [option.key, option.label]),
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
          {Object.entries(items).map(([targetKey, config]) => (
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
            />
          ))}
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
