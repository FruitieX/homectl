import type { DevicesState } from '@/bindings/DevicesState';
import { SearchablePicker, type PickerOption } from '@/ui/SearchablePicker';
import { Input } from '@/ui/primitives/input';
import { useEffect, useMemo, useState } from 'react';
import { useValueHistory } from '@/hooks/useValueHistory';
import { useAppConfig } from '@/hooks/appConfig';
import type { ValueFieldInfo } from '@/bindings/ValueFieldInfo';
import { formatUnknownReason } from '@/ui/routine-runtime';

const sensorFields: PickerOption[] = [
  { value: '/value', label: 'Sensor value' },
  { value: '/observed/value', label: 'Observed value' },
  { value: '/name', label: 'Device name' },
];
const controllableFields: PickerOption[] = [
  { value: '/observed/power', label: 'Reported power' },
  { value: '/observed/brightness', label: 'Reported brightness' },
  { value: '/power', label: 'Requested power' },
  { value: '/brightness', label: 'Requested brightness' },
  { value: '/color', label: 'Requested color' },
  { value: '/scene_id', label: 'Current scene' },
  { value: '/availability/online', label: 'Online' },
];

function fieldLabel(path: string): string {
  const field = path.split('/').at(-1) ?? path;
  if (field === 'ct') return 'Color temperature';
  if (field === 'power') return 'Power';
  return field.replaceAll('_', ' ');
}

function nestedFields(
  value: unknown,
  prefix: string,
  depth = 0,
): PickerOption[] {
  if (!value || typeof value !== 'object' || depth > 3) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const path = `${prefix}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;
    return child && typeof child === 'object'
      ? nestedFields(child, path, depth + 1)
      : [{ value: path, label: key.replaceAll('_', ' '), detail: path }];
  });
}

function atPath(value: unknown, path: string): unknown {
  if (!path || path === '/') return value;
  return path
    .split('/')
    .slice(1)
    .reduce<unknown>((current, part) => {
      if (!current || typeof current !== 'object') return undefined;
      return (current as Record<string, unknown>)[
        part.replaceAll('~1', '/').replaceAll('~0', '~')
      ];
    }, value);
}

function canUseAsComparison(
  value: unknown,
): value is string | number | boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function ValuePathPicker({
  devices,
  deviceKey,
  sourceKind = 'device',
  path,
  onChange,
  onChooseValue,
}: {
  devices: DevicesState;
  deviceKey: string;
  sourceKind?: 'device' | 'computed_source';
  path: string;
  onChange: (path: string) => void;
  onChooseValue?: (value: unknown) => void;
}) {
  const [custom, setCustom] = useState(false);
  const { history, error: historyError } = useValueHistory(deviceKey, path);
  const device = devices[deviceKey];
  const { apiEndpoint } = useAppConfig();
  const [serverFields, setServerFields] = useState<ValueFieldInfo[]>([]);
  useEffect(() => {
    setServerFields([]);
    if (!deviceKey || !device) {
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams({ source_key: deviceKey });
    fetch(`${apiEndpoint}/api/v1/config/value-fields?${params}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!controller.signal.aborted) setServerFields(body?.data ?? []);
      })
      .catch(() => {
        if (!controller.signal.aborted) setServerFields([]);
      });
    return () => controller.abort();
  }, [apiEndpoint, deviceKey, device]);
  const options = useMemo(() => {
    const base =
      device && 'Controllable' in device.data
        ? controllableFields
        : sensorFields;
    const value =
      device && 'Sensor' in device.data && !('value' in device.data.Sensor)
        ? device.data.Sensor
        : null;
    const dynamic = nestedFields(value, '/value');
    if (device && 'Sensor' in device.data && value && typeof value === 'object')
      dynamic.push(...nestedFields(value, ''));
    const confirmed = serverFields.map((field) => ({
      value: field.path,
      label:
        [...base, ...dynamic].find((option) => option.value === field.path)
          ?.label ?? fieldLabel(field.path),
      detail: `${field.path} · ${field.type}${field.available ? ` · ${JSON.stringify(field.value)}` : ' · unavailable'}`,
    }));
    return [
      ...new Map(
        [...base, ...dynamic, ...confirmed].map((option) => [
          option.value,
          { ...option, detail: option.detail ?? option.value },
        ]),
      ).values(),
    ];
  }, [device, serverFields]);
  const live = (() => {
    if (!device) return undefined;
    if ('Sensor' in device.data) {
      const value =
        'value' in device.data.Sensor
          ? device.data.Sensor.value
          : device.data.Sensor;
      if (path === '/value' || path === '/observed/value') return value;
      return atPath(
        value,
        path.startsWith('/value/') ? path.slice('/value'.length) : path,
      );
    }
    const state = device.data.Controllable.state;
    if (path.startsWith('/observed/')) {
      return atPath(
        device.data.Controllable.last_report?.state,
        path.slice('/observed'.length),
      );
    }
    if (path === '/scene_id') return device.data.Controllable.scene_id;
    return atPath(state, path);
  })();
  const fieldStatus = serverFields.find((field) => field.path === path);
  const current = fieldStatus
    ? fieldStatus.available
      ? fieldStatus.value
      : undefined
    : live;
  const shown =
    current === undefined ? 'Unavailable now' : JSON.stringify(current);
  return (
    <div className="space-y-2">
      <SearchablePicker
        options={
          options.some((option) => option.value === path) || !path
            ? options
            : [
                { value: path, label: `Custom field ${path}`, detail: path },
                ...options,
              ]
        }
        value={custom ? '' : path}
        onChange={(next) => {
          setCustom(false);
          onChange(next);
        }}
        placeholder={deviceKey ? 'Choose a field…' : 'Choose a device first…'}
      />
      {custom || (path && !options.some((option) => option.value === path)) ? (
        <Input
          aria-label="Custom value path"
          value={path}
          onChange={(event) => onChange(event.target.value)}
          placeholder="/value"
          className="font-mono"
        />
      ) : null}
      <button
        type="button"
        className="text-xs text-primary hover:underline"
        onClick={() => setCustom((current) => !current)}
      >
        {custom ? 'Use suggested fields' : 'Enter a custom path'}
      </button>
      <p className="text-xs text-muted-foreground">
        Current value: <span className="font-mono">{shown}</span>
        {sourceKind === 'computed_source' ? ' · computed source' : ''}{' '}
        {canUseAsComparison(current) && onChooseValue && (
          <button
            type="button"
            className="text-primary hover:underline"
            onClick={() => onChooseValue(current)}
          >
            Use as expected value
          </button>
        )}
      </p>
      {(fieldStatus?.error || (fieldStatus && !fieldStatus.available)) && (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          {fieldStatus.error ??
            (fieldStatus.reason
              ? formatUnknownReason(fieldStatus.reason)
              : 'This field is unavailable right now.')}
        </p>
      )}
      {history.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">
            Recent changes ({history.length})
          </summary>
          <ol className="mt-2 max-h-36 space-y-1 overflow-y-auto">
            {history.slice(0, 20).map((entry, index) => (
              <li
                key={`${entry.changed_at_ms}-${index}`}
                className="flex justify-between gap-2"
              >
                <span className="font-mono text-foreground">
                  {JSON.stringify(entry.value)}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <time
                    dateTime={new Date(
                      Number(entry.changed_at_ms),
                    ).toISOString()}
                  >
                    {new Date(Number(entry.changed_at_ms)).toLocaleString()}
                  </time>
                  {canUseAsComparison(entry.value) && onChooseValue && (
                    <button
                      type="button"
                      className="text-primary hover:underline"
                      onClick={() => onChooseValue(entry.value)}
                    >
                      Use
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
      {historyError && (
        <p className="text-xs text-muted-foreground">
          Recent changes are unavailable right now.
        </p>
      )}
      {!historyError && history.length === 0 && path && (
        <p className="text-xs text-muted-foreground">
          No changes recorded for this field yet.
        </p>
      )}
    </div>
  );
}
