'use client';

import {
  useDashboardLayouts,
  useDashboardWidgets,
  widgetRegistry,
  WidgetType,
  DashboardWidget,
} from '@/hooks/useDashboard';
import { useState } from 'react';

export default function DashboardConfigPage() {
  const { layouts, loading: layoutsLoading, createLayout, deleteLayout } = useDashboardLayouts();
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const {
    widgets,
    loading: widgetsLoading,
    addWidget,
    updateWidget,
    removeWidget,
  } = useDashboardWidgets(selectedLayoutId);
  const [showAddWidget, setShowAddWidget] = useState(false);
  const [editingWidget, setEditingWidget] = useState<DashboardWidget | null>(null);

  // Select first layout by default
  if (!selectedLayoutId && layouts.length > 0) {
    setSelectedLayoutId(layouts[0].id);
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Dashboard Configuration</h1>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {/* Layout selection */}
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Layouts</h2>
            <p className="text-sm opacity-70">
              Create multiple dashboard layouts for different use cases.
            </p>

            {layoutsLoading ? (
              <span className="loading loading-spinner"></span>
            ) : (
              <div className="space-y-2 mt-4">
                {layouts.map((layout) => (
                  <div
                    key={layout.id}
                    className={`flex items-center justify-between p-2 rounded cursor-pointer ${
                      selectedLayoutId === layout.id ? 'bg-primary text-primary-content' : 'bg-base-300'
                    }`}
                    onClick={() => setSelectedLayoutId(layout.id)}
                  >
                    <span>{layout.name}</span>
                    <div className="flex gap-1">
                      {layout.is_default && (
                        <div className="badge badge-sm">Default</div>
                      )}
                      <button
                        className="btn btn-xs btn-ghost"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm(`Delete layout "${layout.name}"?`)) {
                            deleteLayout(layout.id);
                          }
                        }}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="card-actions mt-4">
              <button
                className="btn btn-sm btn-primary"
                onClick={async () => {
                  const name = prompt('Layout name:');
                  if (name) {
                    const layout = await createLayout({ name, is_default: layouts.length === 0 });
                    setSelectedLayoutId(layout.id);
                  }
                }}
              >
                Add Layout
              </button>
            </div>
          </div>
        </div>

        {/* Widget list */}
        <div className="card bg-base-200 shadow-xl md:col-span-2">
          <div className="card-body">
            <div className="flex justify-between items-center">
              <h2 className="card-title">Widgets</h2>
              <button
                className="btn btn-sm btn-primary"
                onClick={() => setShowAddWidget(true)}
                disabled={!selectedLayoutId}
              >
                Add Widget
              </button>
            </div>

            {!selectedLayoutId ? (
              <p className="text-sm opacity-70">Select a layout to manage widgets.</p>
            ) : widgetsLoading ? (
              <span className="loading loading-spinner"></span>
            ) : widgets.length === 0 ? (
              <p className="text-sm opacity-70">No widgets in this layout.</p>
            ) : (
              <div className="grid gap-2 mt-4">
                {widgets
                  .sort((a, b) => a.position - b.position)
                  .map((widget) => (
                    <div
                      key={widget.id}
                      className="flex items-center justify-between p-3 bg-base-300 rounded"
                    >
                      <div>
                        <div className="font-medium">{widget.title}</div>
                        <div className="text-sm opacity-70">
                          {widgetRegistry[widget.widget_type]?.name || widget.widget_type}
                          <span className="ml-2">
                            ({widget.width}×{widget.height})
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => setEditingWidget(widget)}
                        >
                          Edit
                        </button>
                        <button
                          className="btn btn-xs btn-ghost btn-error"
                          onClick={() => {
                            if (confirm(`Remove widget "${widget.title}"?`)) {
                              removeWidget(widget.id);
                            }
                          }}
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Widget registry info */}
      <div className="card bg-base-200 shadow-xl">
        <div className="card-body">
          <h2 className="card-title">Available Widget Types</h2>
          <div className="grid md:grid-cols-3 lg:grid-cols-4 gap-4 mt-4">
            {Object.entries(widgetRegistry).map(([type, info]) => (
              <div key={type} className="p-3 bg-base-300 rounded">
                <div className="font-medium">{info.name}</div>
                <div className="text-sm opacity-70">{info.description}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add widget modal */}
      {showAddWidget && (
        <AddWidgetModal
          onClose={() => setShowAddWidget(false)}
          onAdd={async (widget) => {
            await addWidget({
              ...widget,
              position: widgets.length,
            });
            setShowAddWidget(false);
          }}
        />
      )}

      {/* Edit widget modal */}
      {editingWidget && (
        <EditWidgetModal
          widget={editingWidget}
          onClose={() => setEditingWidget(null)}
          onSave={async (updated) => {
            await updateWidget(editingWidget.id, updated);
            setEditingWidget(null);
          }}
        />
      )}
    </div>
  );
}

function AddWidgetModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (widget: Partial<DashboardWidget>) => Promise<void>;
}) {
  const [widgetType, setWidgetType] = useState<WidgetType>('clock');
  const [title, setTitle] = useState('');
  const [width, setWidth] = useState(2);
  const [height, setHeight] = useState(2);
  const [options, setOptions] = useState('{}');

  return (
    <dialog className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Add Widget</h3>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Widget Type</span>
          </label>
          <select
            className="select select-bordered"
            value={widgetType}
            onChange={(e) => {
              const type = e.target.value as WidgetType;
              setWidgetType(type);
              setTitle(widgetRegistry[type].name);
              setOptions(JSON.stringify(widgetRegistry[type].defaultOptions, null, 2));
            }}
          >
            {Object.entries(widgetRegistry).map(([type, info]) => (
              <option key={type} value={type}>
                {info.name}
              </option>
            ))}
          </select>
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Title</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Width</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || 1)}
              min={1}
              max={8}
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Height</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value) || 1)}
              min={1}
              max={8}
            />
          </div>
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Options (JSON)</span>
          </label>
          <textarea
            className="textarea textarea-bordered h-24 font-mono text-sm"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              try {
                onAdd({
                  widget_type: widgetType,
                  title: title || widgetRegistry[widgetType].name,
                  width,
                  height,
                  options: JSON.parse(options),
                });
              } catch {
                alert('Invalid JSON in options');
              }
            }}
          >
            Add
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}

function EditWidgetModal({
  widget,
  onClose,
  onSave,
}: {
  widget: DashboardWidget;
  onClose: () => void;
  onSave: (widget: Partial<DashboardWidget>) => Promise<void>;
}) {
  const [title, setTitle] = useState(widget.title);
  const [width, setWidth] = useState(widget.width);
  const [height, setHeight] = useState(widget.height);
  const [options, setOptions] = useState(JSON.stringify(widget.options, null, 2));

  return (
    <dialog className="modal modal-open">
      <div className="modal-box">
        <h3 className="font-bold text-lg">Edit Widget</h3>
        <div className="badge badge-secondary mt-2">
          {widgetRegistry[widget.widget_type]?.name || widget.widget_type}
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Title</span>
          </label>
          <input
            type="text"
            className="input input-bordered"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="grid grid-cols-2 gap-4 mt-4">
          <div className="form-control">
            <label className="label">
              <span className="label-text">Width</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={width}
              onChange={(e) => setWidth(parseInt(e.target.value) || 1)}
              min={1}
              max={8}
            />
          </div>
          <div className="form-control">
            <label className="label">
              <span className="label-text">Height</span>
            </label>
            <input
              type="number"
              className="input input-bordered"
              value={height}
              onChange={(e) => setHeight(parseInt(e.target.value) || 1)}
              min={1}
              max={8}
            />
          </div>
        </div>

        <div className="form-control mt-4">
          <label className="label">
            <span className="label-text">Options (JSON)</span>
          </label>
          <textarea
            className="textarea textarea-bordered h-32 font-mono text-sm"
            value={options}
            onChange={(e) => setOptions(e.target.value)}
          />
        </div>

        <div className="modal-action">
          <button className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              try {
                onSave({
                  title,
                  width,
                  height,
                  options: JSON.parse(options),
                });
              } catch {
                alert('Invalid JSON in options');
              }
            }}
          >
            Save
          </button>
        </div>
      </div>
      <form method="dialog" className="modal-backdrop">
        <button onClick={onClose}>close</button>
      </form>
    </dialog>
  );
}
