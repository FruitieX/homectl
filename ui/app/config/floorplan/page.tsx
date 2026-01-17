'use client';

import { useAppConfig } from '@/hooks/appConfig';
import { useDeviceDisplayNames, useFloorplans, useGroups } from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { useCallback, useState, useRef, useEffect } from 'react';
import { getDeviceKey } from '@/lib/device';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { Device } from '@/bindings/Device';
import {
  FloorplanGridEditor,
  FloorplanGrid,
  createEmptyGrid,
  serializeGrid,
  deserializeGrid,
} from '@/ui/FloorplanGridEditor';
import {
  useDevicePositions,
  type DevicePosition,
} from '@/hooks/useFloorplanPositions';

const getFloorplanDeviceType = (device: Device) => {
  if ('Sensor' in device.data) {
    return 'sensor' as const;
  }

  if ('Controllable' in device.data) {
    return 'controllable' as const;
  }

  return 'other' as const;
};

const resolveGroupDeviceKey = (
  groupDevice: { integration_id: string; device_name: string; device_id?: string },
  deviceKeysByName: Record<string, string>,
) => {
  if (groupDevice.device_id) {
    return `${groupDevice.integration_id}/${groupDevice.device_id}`;
  }

  return (
    deviceKeysByName[`${groupDevice.integration_id}/${groupDevice.device_name}`] ??
    `${groupDevice.integration_id}/${groupDevice.device_name}`
  );
};

export default function FloorplanPage() {
  const { apiEndpoint } = useAppConfig();
  const { devices } = useDevicesApi();
  const { data: deviceDisplayNames } = useDeviceDisplayNames();
  const {
    data: floorplans,
    create: createFloorplan,
    update: updateFloorplan,
    remove: removeFloorplan,
  } = useFloorplans();
  const { data: groups } = useGroups();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [grid, setGrid] = useState<FloorplanGrid>(() => createEmptyGrid());
  const [hasChanges, setHasChanges] = useState(false);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | undefined>();
  const [selectedFloorplanId, setSelectedFloorplanId] = useState<string | null>(null);
  const [selectedFloorplanName, setSelectedFloorplanName] = useState('');
  const [showCreateFloorplan, setShowCreateFloorplan] = useState(false);
  const [newFloorplanId, setNewFloorplanId] = useState('');
  const [newFloorplanName, setNewFloorplanName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deviceDisplayNameMap = Object.fromEntries(
    deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
  );
  const deviceKeysByName = Object.fromEntries(
    devices.map((device) => [`${device.integration_id}/${device.name}`, getDeviceKey(device)]),
  );
  const availableGroups = groups.map((group) => ({
    id: group.id,
    name: group.name,
    hidden: group.hidden,
  }));
  const groupIdsByDeviceKey = groups.reduce<Record<string, string[]>>((result, group) => {
      for (const groupDevice of group.devices) {
        const deviceKey = resolveGroupDeviceKey(groupDevice, deviceKeysByName);
        if (!result[deviceKey]) {
          result[deviceKey] = [];
        }
        result[deviceKey].push(group.id);
      }

      return result;
    }, {});
  const availableDevices = [...devices]
    .map((device) => ({
      device,
      key: getDeviceKey(device),
    }))
    .sort((left, right) => {
      const leftLabel = getDeviceDisplayLabel(left.device, deviceDisplayNameMap);
      const rightLabel = getDeviceDisplayLabel(right.device, deviceDisplayNameMap);
      return leftLabel.localeCompare(rightLabel) || left.key.localeCompare(right.key);
    })
    .map(({ device, key }) => ({
      key,
      name: getDeviceDisplayLabel(device, deviceDisplayNameMap),
      type: getFloorplanDeviceType(device),
      groupIds: groupIdsByDeviceKey[key] ?? [],
    }));

  useEffect(() => {
    if (floorplans.length === 0) {
      setSelectedFloorplanId(null);
      setSelectedFloorplanName('');
      return;
    }

    if (!selectedFloorplanId || !floorplans.some((floorplan) => floorplan.id === selectedFloorplanId)) {
      setSelectedFloorplanId(floorplans[0].id);
      return;
    }

    const selectedFloorplan = floorplans.find((floorplan) => floorplan.id === selectedFloorplanId);
    if (selectedFloorplan) {
      setSelectedFloorplanName(selectedFloorplan.name);
    }
  }, [floorplans, selectedFloorplanId]);

  // Load saved grid and image for the selected floorplan
  useEffect(() => {
    if (!selectedFloorplanId) {
      setGrid(createEmptyGrid());
      setBackgroundImageUrl(undefined);
      setHasChanges(false);
      return;
    }

    const loadData = async () => {
      const floorplanQuery = `?id=${encodeURIComponent(selectedFloorplanId)}`;

      try {
        // Load grid
        const gridResponse = await fetch(`${apiEndpoint}/api/v1/config/floorplan/grid${floorplanQuery}`);
        const gridResult = await gridResponse.json();
        if (gridResult.success && gridResult.data) {
          const loadedGrid = deserializeGrid(gridResult.data);
          if (loadedGrid) {
            setGrid(loadedGrid);
          } else {
            setGrid(createEmptyGrid());
          }
        } else {
          setGrid(createEmptyGrid());
        }
      } catch {
        // Grid not saved yet, use default
        setGrid(createEmptyGrid());
      }

      // Check for uploaded image
      try {
        const imageUrl = `${apiEndpoint}/api/v1/config/floorplan/image${floorplanQuery}`;
        const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
        if (imageResponse.ok) {
          setBackgroundImageUrl(`${imageUrl}&t=${Date.now()}`);
        } else {
          setBackgroundImageUrl(undefined);
        }
      } catch {
        // No image uploaded
        setBackgroundImageUrl(undefined);
      }

      setHasChanges(false);
    };
    loadData();
  }, [apiEndpoint, selectedFloorplanId]);

  const handleGridChange = useCallback((newGrid: FloorplanGrid) => {
    setGrid(newGrid);
    setHasChanges(true);
  }, []);

  const handleSave = async () => {
    if (!selectedFloorplanId) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${apiEndpoint}/api/v1/config/floorplan/grid?id=${encodeURIComponent(selectedFloorplanId)}`,
        {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grid: serializeGrid(grid) }),
        },
      );

      const result = await response.json();
      if (result.success) {
        setSuccess('Floorplan saved successfully');
        setHasChanges(false);
      } else {
        setError(result.error || 'Save failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setLoading(false);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (!selectedFloorplanId) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(
        `${apiEndpoint}/api/v1/config/floorplan/image?id=${encodeURIComponent(selectedFloorplanId)}`,
        {
        method: 'POST',
        body: formData,
        },
      );

      const result = await response.json();
      if (result.success) {
        setSuccess('Floorplan image uploaded successfully');
        // Set the background image URL to trigger editor update
        setBackgroundImageUrl(
          `${apiEndpoint}/api/v1/config/floorplan/image?id=${encodeURIComponent(selectedFloorplanId)}&t=${Date.now()}`,
        );
      } else {
        setError(result.error || 'Upload failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleImageDelete = async () => {
    if (!selectedFloorplanId) {
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(
        `${apiEndpoint}/api/v1/config/floorplan/image?id=${encodeURIComponent(selectedFloorplanId)}`,
        {
          method: 'DELETE',
        },
      );

      const result = await response.json();
      if (result.success) {
        setBackgroundImageUrl(undefined);
        setSuccess('Floorplan image removed successfully');
      } else {
        setError(result.error || 'Failed to remove image');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove image');
    } finally {
      setLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleExport = () => {
    const blob = new Blob([serializeGrid(grid)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFloorplanId ?? 'floorplan'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = async (file: File) => {
    try {
      const text = await file.text();
      const imported = deserializeGrid(text);
      if (imported) {
        setGrid(imported);
        setHasChanges(true);
        setSuccess('Floorplan imported. Remember to save.');
      } else {
        setError('Invalid floorplan file');
      }
    } catch {
      setError('Failed to import floorplan');
    }
  };

  const handleCreateFloorplan = async () => {
    if (!newFloorplanId.trim() || !newFloorplanName.trim()) {
      setError('Floorplan id and name are required');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await createFloorplan({
        id: newFloorplanId.trim(),
        name: newFloorplanName.trim(),
      });
      setSelectedFloorplanId(newFloorplanId.trim());
      setShowCreateFloorplan(false);
      setNewFloorplanId('');
      setNewFloorplanName('');
      setSuccess('Floorplan created successfully');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create floorplan');
    } finally {
      setLoading(false);
    }
  };

  const handleRenameFloorplan = async () => {
    if (!selectedFloorplanId || !selectedFloorplanName.trim()) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await updateFloorplan(selectedFloorplanId, {
        id: selectedFloorplanId,
        name: selectedFloorplanName.trim(),
      });
      setSuccess('Floorplan renamed successfully');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to rename floorplan');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteFloorplan = async () => {
    if (!selectedFloorplanId) {
      return;
    }

    const selectedFloorplan = floorplans.find((floorplan) => floorplan.id === selectedFloorplanId);
    if (!confirm(`Delete floorplan "${selectedFloorplan?.name ?? selectedFloorplanId}"?`)) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await removeFloorplan(selectedFloorplanId);
      setSelectedFloorplanId(null);
      setSuccess('Floorplan deleted successfully');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete floorplan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Floorplan Editor</h1>
        <div className="flex gap-2">
          <button
            className={`btn btn-primary ${hasChanges ? 'btn-accent' : ''}`}
            onClick={handleSave}
            disabled={loading || !selectedFloorplanId}
          >
            {loading ? <span className="loading loading-spinner loading-sm"></span> : null}
            Save Floorplan
          </button>
          <div className="dropdown dropdown-end">
            <div tabIndex={0} role="button" className="btn btn-ghost">
              More
            </div>
            <ul
              tabIndex={0}
              className="dropdown-content z-[1] menu p-2 shadow bg-base-100 rounded-box w-48"
            >
              <li>
                <button onClick={handleExport}>Export JSON</button>
              </li>
              <li>
                <label className="cursor-pointer">
                  Import JSON
                  <input
                    type="file"
                    accept=".json"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleImport(file);
                    }}
                  />
                </label>
              </li>
              <li>
                <button onClick={() => setGrid(createEmptyGrid())}>
                  Reset to Empty
                </button>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert alert-error">
          <span>{error}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setError(null)}>
            ✕
          </button>
        </div>
      )}

      {success && (
        <div className="alert alert-success">
          <span>{success}</span>
          <button className="btn btn-sm btn-ghost" onClick={() => setSuccess(null)}>
            ✕
          </button>
        </div>
      )}

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="form-control w-full max-w-sm">
              <span className="label-text text-sm">Active floorplan</span>
              <select
                className="select select-bordered"
                value={selectedFloorplanId ?? ''}
                onChange={(e) => setSelectedFloorplanId(e.target.value || null)}
              >
                {floorplans.map((floorplan) => (
                  <option key={floorplan.id} value={floorplan.id}>
                    {floorplan.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-control w-full max-w-sm">
              <span className="label-text text-sm">Floorplan name</span>
              <input
                type="text"
                className="input input-bordered"
                value={selectedFloorplanName}
                onChange={(e) => setSelectedFloorplanName(e.target.value)}
                disabled={!selectedFloorplanId}
              />
            </label>

            <button
              className="btn btn-outline"
              disabled={loading || !selectedFloorplanId}
              onClick={handleRenameFloorplan}
            >
              Rename
            </button>

            <button className="btn btn-secondary" onClick={() => setShowCreateFloorplan(true)}>
              New Floorplan
            </button>

            <button
              className="btn btn-error btn-outline"
              disabled={loading || !selectedFloorplanId}
              onClick={handleDeleteFloorplan}
            >
              Delete
            </button>
          </div>

          <p className="text-sm opacity-70">
            Each floorplan stores its own grid, image overlay, device placements, and group masks.
          </p>
        </div>
      </div>

      {/* Grid Editor */}
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <FloorplanGridEditor
            key={selectedFloorplanId ?? 'default-floorplan'}
            grid={grid}
            onChange={handleGridChange}
            availableDevices={availableDevices}
            availableGroups={availableGroups}
            backgroundImageUrl={backgroundImageUrl}
          />
        </div>
      </div>

      {/* Optional: Background image upload */}
      <div className="collapse collapse-arrow bg-base-200">
        <input type="checkbox" />
        <div className="collapse-title font-medium">
          Optional: Upload Background Image
        </div>
        <div className="collapse-content">
          <p className="text-sm opacity-70 mb-4">
            Upload an SVG, PNG, or JPEG image to show beneath the editable floorplan grid in both
            the editor and the map view. The grid stretches across the full image, so you can raise
            the grid resolution without pushing it outside the image bounds.
          </p>
          {backgroundImageUrl && (
            <p className="text-sm text-success mb-3">
              A background image is currently attached to this floorplan.
            </p>
          )}
          <div className="flex flex-wrap gap-3 items-center">
            <input
              ref={fileInputRef}
              type="file"
              accept=".svg,.png,.jpg,.jpeg"
              className="file-input file-input-bordered w-full max-w-md"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file);
              }}
              disabled={loading}
            />
            {backgroundImageUrl && (
              <button
                className="btn btn-outline btn-error"
                disabled={loading}
                onClick={handleImageDelete}
              >
                Remove Image
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Info */}
      <div className="alert alert-info">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          fill="none"
          viewBox="0 0 24 24"
          className="stroke-current shrink-0 w-6 h-6"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          ></path>
        </svg>
        <div>
          <h3 className="font-bold">How to Use</h3>
          <ul className="text-sm list-disc list-inside">
            <li><strong>Draw Walls:</strong> Select a tile type and click/drag to paint</li>
            <li><strong>Place Devices:</strong> Select a device and click to place it on the grid</li>
            <li><strong>Paint Groups:</strong> Choose a group and paint its room footprint tile by tile</li>
            <li>Drag placed devices to reposition them</li>
            <li>Group masks and grid walls are saved with the floorplan</li>
          </ul>
        </div>
      </div>

      {/* Viewport Device Positions */}
      <DevicePositionsEditor devices={devices} />

      {showCreateFloorplan && (
        <dialog className="modal modal-open">
          <div className="modal-box max-w-lg space-y-4">
            <h3 className="font-bold text-lg">Create Floorplan</h3>

            <label className="form-control">
              <span className="label-text">Floorplan ID</span>
              <input
                type="text"
                className="input input-bordered"
                placeholder="upstairs"
                value={newFloorplanId}
                onChange={(e) => setNewFloorplanId(e.target.value)}
              />
            </label>

            <label className="form-control">
              <span className="label-text">Floorplan name</span>
              <input
                type="text"
                className="input input-bordered"
                placeholder="Upstairs"
                value={newFloorplanName}
                onChange={(e) => setNewFloorplanName(e.target.value)}
              />
            </label>

            <div className="modal-action">
              <button className="btn btn-ghost" onClick={() => setShowCreateFloorplan(false)}>
                Cancel
              </button>
              <button className="btn btn-primary" disabled={loading} onClick={handleCreateFloorplan}>
                Create
              </button>
            </div>
          </div>
        </dialog>
      )}
    </div>
  );
}

function DevicePositionsEditor({ devices }: { devices: Device[] }) {
  const {
    positions,
    loading,
    upsert,
    remove,
  } = useDevicePositions();
  const [addKey, setAddKey] = useState('');

  const positionedKeys = new Set(Object.keys(positions));
  const unpositionedDevices = devices.filter(
    (d) => !positionedKeys.has(getDeviceKey(d)),
  );

  const handleAdd = async () => {
    if (!addKey) return;
    await upsert({ device_key: addKey, x: 0, y: 0, scale: 1, rotation: 0 });
    setAddKey('');
  };

  const handleFieldChange = async (
    pos: DevicePosition,
    field: keyof DevicePosition,
    value: string,
  ) => {
    const num = parseFloat(value);
    if (isNaN(num)) return;
    await upsert({ ...pos, [field]: num });
  };

  return (
    <div className="collapse collapse-arrow bg-base-200">
      <input type="checkbox" />
      <div className="collapse-title font-medium">
        Device Positions ({Object.keys(positions).length} positioned)
      </div>
      <div className="collapse-content">
        <p className="text-sm opacity-70 mb-4">
          Set pixel coordinates for devices on the map viewport. Only devices
          with positions will appear on the map.
        </p>

        {loading ? (
          <span className="loading loading-spinner loading-sm" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="table table-xs">
                <thead>
                  <tr>
                    <th>Device</th>
                    <th>X</th>
                    <th>Y</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {Object.values(positions).map((pos) => (
                    <tr key={pos.device_key}>
                      <td className="font-mono text-xs">{pos.device_key}</td>
                      <td>
                        <input
                          type="number"
                          className="input input-bordered input-xs w-20"
                          defaultValue={pos.x}
                          onBlur={(e) =>
                            handleFieldChange(pos, 'x', e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="input input-bordered input-xs w-20"
                          defaultValue={pos.y}
                          onBlur={(e) =>
                            handleFieldChange(pos, 'y', e.target.value)
                          }
                        />
                      </td>
                      <td>
                        <button
                          className="btn btn-ghost btn-xs btn-error"
                          onClick={() => remove(pos.device_key)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {unpositionedDevices.length > 0 && (
              <div className="flex gap-2 mt-4 items-center">
                <select
                  className="select select-bordered select-sm flex-1"
                  value={addKey}
                  onChange={(e) => setAddKey(e.target.value)}
                >
                  <option value="">Add device...</option>
                  {unpositionedDevices.map((d) => (
                    <option key={getDeviceKey(d)} value={getDeviceKey(d)}>
                      {d.name} ({getDeviceKey(d)})
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn-sm btn-primary"
                  disabled={!addKey}
                  onClick={handleAdd}
                >
                  Add
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
