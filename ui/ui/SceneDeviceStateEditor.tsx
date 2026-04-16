import { useState, useCallback } from 'react';
import {
  SceneDeviceConfig,
  SceneDeviceState,
  SceneDeviceLink,
  ActivateSceneDescriptor,
  DeviceColor,
  Scene,
  getSceneDeviceLinkTargetKey,
} from '@/hooks/useConfig';
import { Device } from '@/bindings/Device';
import { DevicesState } from '@/bindings/DevicesState';
import {
  SceneResolvedColorPreview,
  type SceneTargetKind,
} from '@/ui/SceneResolvedColorPreview';

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

// Color mode helpers
function getColorMode(
  color?: DeviceColor,
): 'hs' | 'xy' | 'rgb' | 'ct' | undefined {
  if (!color) return undefined;
  if ('Hs' in color) return 'hs';
  if ('Xy' in color) return 'xy';
  if ('Rgb' in color) return 'rgb';
  if ('Ct' in color) return 'ct';
  return undefined;
}

// Convert HSL to RGB for preview
function hslToRgb(
  h: number,
  s: number,
  l: number,
): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;

  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

// Get color preview CSS
function getColorPreview(color?: DeviceColor, brightness?: number): string {
  if (!color) return 'transparent';

  const b = brightness ?? 1;

  if ('Hs' in color && color.Hs) {
    const { r, g, b: blue } = hslToRgb(color.Hs.h, color.Hs.s, 0.5);
    return `rgb(${Math.round(r * b)}, ${Math.round(g * b)}, ${Math.round(blue * b)})`;
  }
  if ('Rgb' in color && color.Rgb) {
    return `rgb(${Math.round(color.Rgb.r * b)}, ${Math.round(color.Rgb.g * b)}, ${Math.round(color.Rgb.b * b)})`;
  }
  if ('Ct' in color && color.Ct) {
    // Color temperature: warm (2700K) to cool (6500K)
    const ct = color.Ct.ct;
    const warmth = Math.max(0, Math.min(1, (ct - 153) / (500 - 153)));
    const r = Math.round((255 - warmth * 55) * b);
    const g = Math.round((240 - warmth * 30) * b);
    const blu = Math.round((200 + warmth * 55) * b);
    return `rgb(${r}, ${g}, ${blu})`;
  }

  return 'gray';
}

interface DeviceStateEditorProps {
  config: SceneDeviceState;
  onChange: (config: SceneDeviceState) => void;
}

function DeviceStateEditor({ config, onChange }: DeviceStateEditorProps) {
  const colorMode = getColorMode(config.color);

  const updateColor = (newColor: DeviceColor) => {
    onChange({ ...config, color: newColor });
  };

  return (
    <div className="space-y-3">
      {/* Power */}
      <div className="form-control">
        <label className="label cursor-pointer justify-start gap-3">
          <input
            type="checkbox"
            className="toggle toggle-primary"
            checked={config.power ?? true}
            onChange={(e) => onChange({ ...config, power: e.target.checked })}
          />
          <span className="label-text">Power</span>
        </label>
      </div>

      {/* Brightness */}
      <div className="form-control">
        <label className="label">
          <span className="label-text">
            Brightness: {Math.round((config.brightness ?? 1) * 100)}%
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={Math.round((config.brightness ?? 1) * 100)}
          className="range range-primary range-sm"
          onChange={(e) =>
            onChange({ ...config, brightness: Number(e.target.value) / 100 })
          }
        />
      </div>

      {/* Transition */}
      <div className="form-control">
        <label className="label">
          <span className="label-text">
            Transition: {config.transition ?? 0.4}s
          </span>
        </label>
        <input
          type="range"
          min="0"
          max="50"
          step="1"
          value={(config.transition ?? 0.4) * 10}
          className="range range-sm"
          onChange={(e) =>
            onChange({ ...config, transition: Number(e.target.value) / 10 })
          }
        />
      </div>

      {/* Color mode selector */}
      <div className="form-control">
        <label className="label">
          <span className="label-text">Color Mode</span>
        </label>
        <select
          className="select select-bordered select-sm"
          value={colorMode ?? 'none'}
          onChange={(e) => {
            const mode = e.target.value;
            if (mode === 'none') {
              onChange({ ...config, color: undefined });
            } else if (mode === 'hs') {
              onChange({ ...config, color: { Hs: { h: 30, s: 1 } } });
            } else if (mode === 'rgb') {
              onChange({
                ...config,
                color: { Rgb: { r: 255, g: 200, b: 100 } },
              });
            } else if (mode === 'ct') {
              onChange({ ...config, color: { Ct: { ct: 300 } } });
            }
          }}
        >
          <option value="none">No color</option>
          <option value="hs">Hue/Saturation</option>
          <option value="rgb">RGB</option>
          <option value="ct">Color Temperature</option>
        </select>
      </div>

      {/* Color editor based on mode */}
      {colorMode === 'hs' && config.color && 'Hs' in config.color && (
        <div className="space-y-2 p-3 bg-base-300 rounded-lg">
          <div
            className="w-full h-8 rounded"
            style={{
              backgroundColor: getColorPreview(config.color, config.brightness),
            }}
          />
          <div className="form-control">
            <label className="label">
              <span className="label-text">Hue: {config.color.Hs?.h ?? 0}°</span>
            </label>
            <input
              type="range"
              min="0"
              max="360"
              value={config.color.Hs?.h ?? 0}
              className="range range-sm"
              style={{ accentColor: `hsl(${config.color.Hs?.h ?? 0}, 100%, 50%)` }}
              onChange={(e) =>
                updateColor({
                  Hs: { h: Number(e.target.value), s: config.color?.Hs?.s ?? 1 },
                })
              }
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text">
                Saturation:{' '}
                {Math.round((config.color.Hs?.s ?? 1) * 100)}%
              </span>
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={(config.color.Hs?.s ?? 1) * 100}
              className="range range-sm"
              onChange={(e) =>
                updateColor({
                  Hs: {
                    h: config.color?.Hs?.h ?? 0,
                    s: Number(e.target.value) / 100,
                  },
                })
              }
            />
          </div>
        </div>
      )}

      {colorMode === 'rgb' && config.color && 'Rgb' in config.color && (
        <div className="space-y-2 p-3 bg-base-300 rounded-lg">
          <div
            className="w-full h-8 rounded"
            style={{
              backgroundColor: getColorPreview(config.color, config.brightness),
            }}
          />
          <div className="grid grid-cols-3 gap-2">
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">R</span>
              </label>
              <input
                type="number"
                min="0"
                max="255"
                className="input input-bordered input-sm"
                value={config.color.Rgb?.r ?? 255}
                onChange={(e) =>
                  updateColor({
                    Rgb: {
                      r: Number(e.target.value),
                      g: config.color?.Rgb?.g ?? 200,
                      b: config.color?.Rgb?.b ?? 100,
                    },
                  })
                }
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">G</span>
              </label>
              <input
                type="number"
                min="0"
                max="255"
                className="input input-bordered input-sm"
                value={config.color.Rgb?.g ?? 200}
                onChange={(e) =>
                  updateColor({
                    Rgb: {
                      r: config.color?.Rgb?.r ?? 255,
                      g: Number(e.target.value),
                      b: config.color?.Rgb?.b ?? 100,
                    },
                  })
                }
              />
            </div>
            <div className="form-control">
              <label className="label">
                <span className="label-text text-xs">B</span>
              </label>
              <input
                type="number"
                min="0"
                max="255"
                className="input input-bordered input-sm"
                value={config.color.Rgb?.b ?? 100}
                onChange={(e) =>
                  updateColor({
                    Rgb: {
                      r: config.color?.Rgb?.r ?? 255,
                      g: config.color?.Rgb?.g ?? 200,
                      b: Number(e.target.value),
                    },
                  })
                }
              />
            </div>
          </div>
        </div>
      )}

      {colorMode === 'ct' && config.color && 'Ct' in config.color && (
        <div className="space-y-2 p-3 bg-base-300 rounded-lg">
          <div
            className="w-full h-8 rounded"
            style={{
              backgroundColor: getColorPreview(config.color, config.brightness),
            }}
          />
          <div className="form-control">
            <label className="label">
              <span className="label-text">
                Color Temp: {config.color.Ct?.ct ?? 300} mireds (~
                {Math.round(1000000 / (config.color.Ct?.ct ?? 300))}K)
              </span>
            </label>
            <input
              type="range"
              min="153"
              max="500"
              value={config.color.Ct?.ct ?? 300}
              className="range range-sm"
              onChange={(e) => updateColor({ Ct: { ct: Number(e.target.value) } })}
            />
            <div className="flex justify-between text-xs opacity-60 mt-1">
              <span>Cool (6500K)</span>
              <span>Warm (2000K)</span>
            </div>
          </div>
        </div>
      )}
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
      <div className="form-control">
        <label className="label">
          <span className="label-text">Link to Device</span>
        </label>
        <select
          className="select select-bordered select-sm"
          value={getSceneDeviceLinkTargetKey(config)}
          onChange={(e) => {
            const [integration_id, ...deviceIdParts] = e.target.value.split('/');
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
        <span className="label-text-alt mt-1 opacity-60">
          Scene will copy state from this device (e.g. circadian color)
        </span>
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text">
            Brightness Override:{' '}
            {config.brightness !== undefined
              ? `${Math.round(config.brightness * 100)}%`
              : 'None'}
          </span>
        </label>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
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
              className="range range-sm flex-1"
              onChange={(e) =>
                onChange({ ...config, brightness: Number(e.target.value) / 100 })
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
      <div className="form-control">
        <label className="label">
          <span className="label-text">Link to Scene</span>
        </label>
        <select
          className="select select-bordered select-sm"
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
        <span className="label-text-alt mt-1 opacity-60">
          Scene will inherit all device states from the linked scene
        </span>
      </div>

      <div className="form-control">
        <label className="label">
          <span className="label-text">Transition Override (s)</span>
        </label>
        <input
          type="number"
          min="0"
          step="0.1"
          className="input input-bordered input-sm"
          value={config.transition ?? ''}
          placeholder="Use linked scene transition"
          onChange={(e) => {
            const nextValue = e.target.value.trim();
            onChange({
              ...config,
              transition: nextValue ? Math.max(0, Number(nextValue)) : undefined,
            });
          }}
        />
        <span className="label-text-alt mt-1 opacity-60">
          Leave empty to inherit the linked scene's transition values.
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

  const handleTypeChange = (newType: 'device_state' | 'device_link' | 'scene_link') => {
    if (newType === 'device_state') {
      onChange({ power: true, brightness: 1 });
    } else if (newType === 'device_link') {
      onChange({ integration_id: '', device_id: '' });
    } else {
      onChange({ scene_id: '', transition: undefined });
    }
  };

  return (
    <div className="card bg-base-200">
      <div className="card-body p-4">
        <div className="flex justify-between items-start">
          <div>
            <h4 className="font-semibold">{targetLabel ?? targetKey}</h4>
            <p className="text-xs opacity-60">{targetKey}</p>
          </div>
          <button
            className="btn btn-ghost btn-xs btn-error"
            onClick={onRemove}
          >
            ✕
          </button>
        </div>

        <div className="form-control mt-2">
          <label className="label">
            <span className="label-text">Config Type</span>
          </label>
          <select
            className="select select-bordered select-sm"
            value={configType}
            onChange={(e) => handleTypeChange(e.target.value as 'device_state' | 'device_link' | 'scene_link')}
          >
            <option value="device_state">Device State</option>
            <option value="device_link">Link to Device</option>
            <option value="scene_link">Link to Scene</option>
          </select>
        </div>

        <div className="divider my-2"></div>

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
            onChange={onChange}
          />
        )}
      </div>
    </div>
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
    <dialog className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Add Target</h3>

        <input
          type="text"
          className="input input-bordered w-full mt-4"
          placeholder="Search targets..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="mt-4 max-h-60 overflow-y-auto">
          {availableTargets.length === 0 ? (
            <p className="text-center opacity-60 py-4">No targets found</p>
          ) : (
            <div className="space-y-1">
              {availableTargets.map(({ key, label }) => (
                <button
                  key={key}
                  className="btn btn-ghost btn-sm w-full justify-start"
                  onClick={() => {
                    onAdd(key);
                    onClose();
                  }}
                >
                  <span className="truncate">
                    {label}{' '}
                    <span className="opacity-60">({key})</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
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
        <button
          className="btn btn-primary btn-sm"
          onClick={() => setShowAddTarget(true)}
        >
          {addLabel}
        </button>
      </div>

      {Object.keys(items).length === 0 ? (
        <div className="text-center py-8 opacity-60">
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
    .sort((left, right) =>
      left.label.localeCompare(right.label) || left.key.localeCompare(right.key),
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

      <div className="flex justify-end gap-2 pt-4 border-t border-base-300">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn btn-primary" onClick={() => onSave(deviceStates)}>
          Save Device States
        </button>
      </div>
    </div>
  );
}

export default SceneDeviceStateEditor;
