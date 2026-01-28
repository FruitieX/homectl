'use client';

import { useAppConfig } from '@/hooks/appConfig';
import { useWebsocketState } from '@/hooks/websocket';
import { useCallback, useState, useRef, useEffect } from 'react';
import { getDeviceKey } from '@/lib/device';
import { Device } from '@/bindings/Device';
import { excludeUndefined } from 'utils/excludeUndefined';
import {
  FloorplanGridEditor,
  FloorplanGrid,
  createEmptyGrid,
  serializeGrid,
  deserializeGrid,
} from '@/ui/FloorplanGridEditor';

export default function FloorplanPage() {
  const { apiEndpoint } = useAppConfig();
  const state = useWebsocketState();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [grid, setGrid] = useState<FloorplanGrid>(() => createEmptyGrid(30, 20, 20));
  const [hasChanges, setHasChanges] = useState(false);
  const [backgroundImageUrl, setBackgroundImageUrl] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const devices: Device[] = Object.values(excludeUndefined(state?.devices));
  const availableDevices = devices.map((d) => ({
    key: getDeviceKey(d),
    name: d.name,
  }));

  // Load saved grid and image on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        // Load grid
        const gridResponse = await fetch(`${apiEndpoint}/api/v1/config/floorplan/grid`);
        const gridResult = await gridResponse.json();
        if (gridResult.success && gridResult.data) {
          const loadedGrid = deserializeGrid(gridResult.data);
          if (loadedGrid) {
            setGrid(loadedGrid);
          }
        }
      } catch {
        // Grid not saved yet, use default
      }

      // Check for uploaded image
      try {
        const imageUrl = `${apiEndpoint}/api/v1/config/floorplan/image`;
        const imageResponse = await fetch(imageUrl, { method: 'HEAD' });
        if (imageResponse.ok) {
          setBackgroundImageUrl(imageUrl);
        }
      } catch {
        // No image uploaded
      }
    };
    loadData();
  }, [apiEndpoint]);

  const handleGridChange = useCallback((newGrid: FloorplanGrid) => {
    setGrid(newGrid);
    setHasChanges(true);
  }, []);

  const handleSave = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${apiEndpoint}/api/v1/config/floorplan/grid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grid: serializeGrid(grid) }),
      });

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
    try {
      setLoading(true);
      setError(null);

      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(`${apiEndpoint}/api/v1/config/floorplan/image`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (result.success) {
        setSuccess('Floorplan image uploaded successfully');
        // Set the background image URL to trigger editor update
        setBackgroundImageUrl(`${apiEndpoint}/api/v1/config/floorplan/image?t=${Date.now()}`);
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

  const handleExport = () => {
    const blob = new Blob([serializeGrid(grid)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'floorplan.json';
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Floorplan Editor</h1>
        <div className="flex gap-2">
          <button
            className={`btn btn-primary ${hasChanges ? 'btn-accent' : ''}`}
            onClick={handleSave}
            disabled={loading}
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
                <button onClick={() => setGrid(createEmptyGrid(30, 20, 20))}>
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

      {/* Grid Editor */}
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <FloorplanGridEditor
            grid={grid}
            onChange={handleGridChange}
            availableDevices={availableDevices}
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
            Upload an SVG or PNG image to use as a background overlay in the map view.
            The grid-based floorplan above is the primary way to define your space.
          </p>
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
            <li>Drag placed devices to reposition them</li>
            <li>Device positions are saved with the floorplan</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
