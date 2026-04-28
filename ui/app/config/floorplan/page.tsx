import { useAppConfig } from '@/hooks/appConfig';
import {
  useDeviceDisplayNames,
  useFloorplans,
  useGroups,
  type Group,
} from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { useCallback, useState, useRef, useEffect } from 'react';
import { ConfigPageHeader } from '../page-header';
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
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
} from '@/ui/config-form';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';

const selectClassName =
  'h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const fieldClassName = 'space-y-2';
const fieldLabelClassName = 'text-sm font-medium';

const getFloorplanDeviceType = (device: Device) => {
  if ('Sensor' in device.data) {
    return 'sensor' as const;
  }

  if ('Controllable' in device.data) {
    return 'controllable' as const;
  }

  return 'other' as const;
};

const getGroupDeviceKeys = (group: Group) => {
  if (group.device_keys) {
    return group.device_keys;
  }

  return group.devices.map(
    (groupDevice) => `${groupDevice.integration_id}/${groupDevice.device_id}`,
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
  const [floorplanLoading, setFloorplanLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [grid, setGrid] = useState<FloorplanGrid>(() => createEmptyGrid());
  const [hasChanges, setHasChanges] = useState(false);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<
    string | undefined
  >();
  const [selectedFloorplanId, setSelectedFloorplanId] = useState<string | null>(
    null,
  );
  const [loadedFloorplanId, setLoadedFloorplanId] = useState<string | null>(
    null,
  );
  const [selectedFloorplanName, setSelectedFloorplanName] = useState('');
  const [showCreateFloorplan, setShowCreateFloorplan] = useState(false);
  const [newFloorplanId, setNewFloorplanId] = useState('');
  const [newFloorplanName, setNewFloorplanName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deviceDisplayNameMap = Object.fromEntries(
    deviceDisplayNames.map((row) => [row.device_key, row.display_name]),
  );
  const availableGroups = groups.map((group) => ({
    id: group.id,
    name: group.name,
    hidden: group.hidden,
  }));
  const groupIdsByDeviceKey = groups.reduce<Record<string, string[]>>(
    (result, group) => {
      for (const deviceKey of getGroupDeviceKeys(group)) {
        if (!result[deviceKey]) {
          result[deviceKey] = [];
        }
        result[deviceKey].push(group.id);
      }

      return result;
    },
    {},
  );
  const availableDevices = [...devices]
    .map((device) => ({
      device,
      key: getDeviceKey(device),
    }))
    .sort((left, right) => {
      const leftLabel = getDeviceDisplayLabel(
        left.device,
        deviceDisplayNameMap,
      );
      const rightLabel = getDeviceDisplayLabel(
        right.device,
        deviceDisplayNameMap,
      );
      return (
        leftLabel.localeCompare(rightLabel) || left.key.localeCompare(right.key)
      );
    })
    .map(({ device, key }) => ({
      key,
      name: getDeviceDisplayLabel(device, deviceDisplayNameMap),
      type: getFloorplanDeviceType(device),
      groupIds: groupIdsByDeviceKey[key] ?? [],
    }));

  const selectFloorplan = useCallback((floorplanId: string | null) => {
    setSelectedFloorplanId(floorplanId);
    setLoadedFloorplanId(null);
    setFloorplanLoading(floorplanId !== null);
  }, []);

  useEffect(() => {
    if (floorplans.length === 0) {
      if (selectedFloorplanId !== null) {
        selectFloorplan(null);
      }
      if (selectedFloorplanName !== '') {
        setSelectedFloorplanName('');
      }
      return;
    }

    if (
      !selectedFloorplanId ||
      !floorplans.some((floorplan) => floorplan.id === selectedFloorplanId)
    ) {
      selectFloorplan(floorplans[0].id);
      return;
    }

    const selectedFloorplan = floorplans.find(
      (floorplan) => floorplan.id === selectedFloorplanId,
    );
    if (selectedFloorplan) {
      setSelectedFloorplanName(selectedFloorplan.name);
    }
  }, [floorplans, selectFloorplan, selectedFloorplanId, selectedFloorplanName]);

  // Load saved grid and image for the selected floorplan
  useEffect(() => {
    if (!selectedFloorplanId) {
      setFloorplanLoading(false);
      setLoadedFloorplanId(null);
      setGrid(createEmptyGrid());
      setBackgroundImageUrl(undefined);
      setHasChanges(false);
      return;
    }

    let cancelled = false;

    const loadData = async () => {
      const floorplanQuery = `?id=${encodeURIComponent(selectedFloorplanId)}`;
      const imageUrl = `${apiEndpoint}/api/v1/config/floorplan/image${floorplanQuery}`;

      setFloorplanLoading(true);

      let nextGrid = createEmptyGrid();
      let nextBackgroundImageUrl: string | undefined;

      try {
        const gridResponse = await fetch(
          `${apiEndpoint}/api/v1/config/floorplan/grid${floorplanQuery}`,
        );
        const gridResult = await gridResponse.json();
        if (gridResult.success && gridResult.data) {
          const loadedGrid = deserializeGrid(gridResult.data);
          if (loadedGrid) {
            nextGrid = loadedGrid;
          }
        }
      } catch {
        nextGrid = createEmptyGrid();
      }

      try {
        const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
        if (imageResponse.ok) {
          nextBackgroundImageUrl = `${imageUrl}&t=${Date.now()}`;
        }
      } catch {
        nextBackgroundImageUrl = undefined;
      }

      if (!cancelled) {
        setGrid(nextGrid);
        setBackgroundImageUrl(nextBackgroundImageUrl);
        setHasChanges(false);
        setLoadedFloorplanId(selectedFloorplanId);
        setFloorplanLoading(false);
      }
    };

    loadData();

    return () => {
      cancelled = true;
    };
  }, [apiEndpoint, selectedFloorplanId]);

  const handleGridChange = useCallback((newGrid: FloorplanGrid) => {
    setGrid(newGrid);
    setHasChanges(true);
  }, []);

  const isSelectedFloorplanReady =
    selectedFloorplanId !== null &&
    loadedFloorplanId === selectedFloorplanId &&
    !floorplanLoading;

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
      selectFloorplan(newFloorplanId.trim());
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

    const selectedFloorplan = floorplans.find(
      (floorplan) => floorplan.id === selectedFloorplanId,
    );
    if (
      !confirm(
        `Delete floorplan "${selectedFloorplan?.name ?? selectedFloorplanId}"?`,
      )
    ) {
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await removeFloorplan(selectedFloorplanId);
      selectFloorplan(null);
      setSuccess('Floorplan deleted successfully');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete floorplan');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <ConfigPageHeader
        title="Floorplan Editor"
        description="Manage floorplan canvases, background images, device placements, and group masks."
        actions={
          <>
            <Button
              variant={hasChanges ? 'secondary' : 'default'}
              onClick={handleSave}
              disabled={loading || floorplanLoading || !selectedFloorplanId}
            >
              {loading ? (
                <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              ) : null}
              Save Floorplan
            </Button>
            <Button
              variant="outline"
              disabled={loading || floorplanLoading || !selectedFloorplanId}
              onClick={handleExport}
            >
              Export JSON
            </Button>
            <Button
              asChild
              variant="outline"
              className={
                loading || floorplanLoading || !selectedFloorplanId
                  ? 'pointer-events-none opacity-50'
                  : undefined
              }
            >
              <label>
                Import JSON
                <input
                  type="file"
                  accept=".json"
                  className="hidden"
                  disabled={loading || floorplanLoading || !selectedFloorplanId}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImport(file);
                  }}
                />
              </label>
            </Button>
            <Button
              variant="ghost"
              disabled={loading || floorplanLoading || !selectedFloorplanId}
              onClick={() => setGrid(createEmptyGrid())}
            >
              Reset
            </Button>
          </>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{error}</span>
            <Button variant="ghost" size="sm" onClick={() => setError(null)}>
              ✕
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <AlertDescription className="flex items-center justify-between gap-3">
            <span>{success}</span>
            <Button variant="ghost" size="sm" onClick={() => setSuccess(null)}>
              ✕
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap items-end gap-3">
            <label className={fieldClassName + ' w-full max-w-sm'}>
              <span className={fieldLabelClassName}>Active floorplan</span>
              <select
                className={selectClassName}
                value={selectedFloorplanId ?? ''}
                onChange={(e) => selectFloorplan(e.target.value || null)}
              >
                {floorplans.map((floorplan) => (
                  <option key={floorplan.id} value={floorplan.id}>
                    {floorplan.name}
                  </option>
                ))}
              </select>
            </label>

            <label className={fieldClassName + ' w-full max-w-sm'}>
              <span className={fieldLabelClassName}>Floorplan name</span>
              <Input
                type="text"
                value={selectedFloorplanName}
                onChange={(e) => setSelectedFloorplanName(e.target.value)}
                disabled={!selectedFloorplanId}
              />
            </label>

            <Button
              variant="outline"
              disabled={loading || !selectedFloorplanId}
              onClick={handleRenameFloorplan}
            >
              Rename
            </Button>

            <Button
              variant="secondary"
              onClick={() => setShowCreateFloorplan(true)}
            >
              New Floorplan
            </Button>

            <Button
              variant="destructive"
              disabled={loading || !selectedFloorplanId}
              onClick={handleDeleteFloorplan}
            >
              Delete
            </Button>
          </div>

          <p className="text-sm text-muted-foreground">
            Each floorplan stores its own grid, image overlay, device
            placements, and group masks.
          </p>
        </CardContent>
      </Card>

      {/* Grid Editor */}
      <Card>
        <CardContent className="p-5">
          {!selectedFloorplanId ? (
            <EmptyState
              title="No floorplan selected"
              description="Create or select a floorplan to start editing."
            />
          ) : !isSelectedFloorplanReady ? (
            <div className="flex min-h-96 items-center justify-center rounded-2xl border border-border bg-muted/30 p-8">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <Skeleton className="size-6 rounded-full" />
                Loading floorplan...
              </div>
            </div>
          ) : (
            <FloorplanGridEditor
              key={selectedFloorplanId}
              grid={grid}
              onChange={handleGridChange}
              availableDevices={availableDevices}
              availableGroups={availableGroups}
              backgroundImageUrl={backgroundImageUrl}
            />
          )}
        </CardContent>
      </Card>

      {/* Optional: Background image upload */}
      <details className="rounded-3xl border border-border bg-card p-5 shadow-sm">
        <summary className="cursor-pointer list-none font-medium">
          Optional: Upload Background Image
        </summary>
        <div className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            Upload an SVG, PNG, or JPEG image to show beneath the editable
            floorplan grid in both the editor and the map view. The grid
            stretches across the full image, so you can raise the grid
            resolution without pushing it outside the image bounds.
          </p>
          {backgroundImageUrl && (
            <p className="mb-3 text-sm text-emerald-600 dark:text-emerald-300">
              A background image is currently attached to this floorplan.
            </p>
          )}
          <div className="flex flex-wrap gap-3 items-center">
            <Input
              ref={fileInputRef}
              type="file"
              accept=".svg,.png,.jpg,.jpeg"
              className="w-full max-w-md"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageUpload(file);
              }}
              disabled={loading || floorplanLoading || !selectedFloorplanId}
            />
            {backgroundImageUrl && (
              <Button
                variant="destructive"
                disabled={loading || floorplanLoading || !selectedFloorplanId}
                onClick={handleImageDelete}
              >
                Remove Image
              </Button>
            )}
          </div>
        </div>
      </details>

      {/* Info */}
      <Alert>
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
          <AlertTitle>How to Use</AlertTitle>
          <ul className="text-sm list-disc list-inside">
            <li>
              <strong>Draw Walls:</strong> Select a tile type and click/drag to
              paint
            </li>
            <li>
              <strong>Place Devices:</strong> Select a device and click to place
              it on the grid
            </li>
            <li>
              <strong>Paint Groups:</strong> Choose a group and paint its room
              footprint tile by tile
            </li>
            <li>Drag placed devices to reposition them</li>
            <li>Group masks and grid walls are saved with the floorplan</li>
          </ul>
        </div>
      </Alert>

      {showCreateFloorplan && (
        <ResponsiveOverlay
          open
          onOpenChange={(open) => {
            if (!open) {
              setShowCreateFloorplan(false);
            }
          }}
          title="Create Floorplan"
          description="Create a separate floorplan canvas and grid."
          className="max-w-lg"
        >
          <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
            <ConfigFormSection
              title="Floorplan identity"
              description="Create a separate editable grid, background image, and room mask set."
            >
              <ConfigField label="Floorplan ID">
                <Input
                  type="text"
                  placeholder="upstairs"
                  value={newFloorplanId}
                  onChange={(e) => setNewFloorplanId(e.target.value)}
                />
              </ConfigField>

              <ConfigField label="Floorplan name">
                <Input
                  type="text"
                  placeholder="Upstairs"
                  value={newFloorplanName}
                  onChange={(e) => setNewFloorplanName(e.target.value)}
                />
              </ConfigField>
            </ConfigFormSection>

            <ConfigFormActions>
              <Button
                variant="ghost"
                onClick={() => setShowCreateFloorplan(false)}
              >
                Cancel
              </Button>
              <Button disabled={loading} onClick={handleCreateFloorplan}>
                Create
              </Button>
            </ConfigFormActions>
          </div>
        </ResponsiveOverlay>
      )}
    </div>
  );
}
