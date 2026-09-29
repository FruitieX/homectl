import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import { ConfigApiError } from '@/hooks/useConfig';
import { widgetRegistry, type WidgetType } from '@/hooks/useDashboard';
import { useEntityDraft, entityFieldProps } from '@/hooks/useEntityDraft';
import { entityDraftStore } from '@/lib/entityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { JsonValueEditor } from '@/ui/settings/JsonValueEditor';
import { WidgetOptionFields } from '@/ui/WidgetOptionFields';
import { Input } from '@/ui/primitives/input';
import { Button } from '@/ui/primitives/button';
import { confirmDialog } from '@/ui/primitives/confirm-dialog';
import { ConfigPageHeader } from '../page-header';
import {
  useDashboardConfig,
  widgetOptions,
  widgetTitle,
  isRecord,
  type DashboardWidgetRow,
} from './shared';
import type { FieldError } from '@/lib/configSection';

type WidgetDraft = {
  row: DashboardWidgetRow;
  replacements: Record<string, string>;
  clear: Record<string, boolean>;
};
const toDraft = (row: DashboardWidgetRow): WidgetDraft => ({
  row,
  replacements: {},
  clear: {},
});
const credentials = (kind: string) =>
  kind === 'clock'
    ? [{ key: 'calendarUrl', label: 'Private calendar URL' }]
    : kind === 'sensors'
      ? [{ key: 'influxToken', label: 'InfluxDB token' }]
      : [];
const sourceFor: Record<string, string> = {
  clock: 'calendar',
  sensors: 'influxdb',
  spot_price: 'influxdb',
  weather: 'weather',
  train_schedule: 'train_schedule',
};
function defaults(kind: WidgetType) {
  const value = { ...widgetRegistry[kind].defaultOptions };
  for (const field of credentials(kind)) delete value[field.key];
  return value;
}
export default function WidgetEditor() {
  const { layoutId = '', widgetId = 'new' } = useParams(),
    creating = widgetId === 'new',
    api = useDashboardConfig(layoutId),
    navigate = useNavigate(),
    { advanced } = useSettingsPreferences();
  const [error, setError] = useState('');
  const initial = useMemo(
    () =>
      toDraft({
        id: 0,
        layout_id: Number(layoutId),
        widget_type: 'clock',
        config: { title: 'Clock', options: defaults('clock') },
        grid_x: 0,
        grid_y: 0,
        grid_w: 2,
        grid_h: 2,
        sort_order: 0,
      }),
    [layoutId],
  );
  const saved = api.widgets.data?.find((row) => String(row.id) === widgetId);
  const item = useMemo(
    () => (creating ? initial : saved ? toDraft(saved) : undefined),
    [creating, initial, saved],
  );
  const key = `${api.endpoint}/layouts/${layoutId}/widgets/${widgetId}`;
  const draft = useEntityDraft({
    key,
    item,
    label: creating ? 'New widget' : saved ? widgetTitle(saved) : 'Widget',
    href: `/config/dashboard/${layoutId}/widgets/${widgetId}`,
    validate: (value) => {
      const errors: FieldError[] = [];
      if (!widgetTitle(value.row).trim())
        errors.push({ field: 'title', message: 'Enter a widget title.' });
      for (const [field, min, max] of [
        ['grid_w', 0.25, 8],
        ['grid_h', 0.25, 64],
        ['grid_x', 0, 2147483647],
        ['grid_y', 0, 2147483647],
        ['sort_order', 0, 2147483647],
      ] as const) {
        const number = value.row[field];
        if (
          !Number.isFinite(number) ||
          number < min ||
          number > max ||
          (!['grid_w', 'grid_h'].includes(field) && !Number.isInteger(number))
        )
          errors.push({
            field,
            message: `${field.replace('grid_', '')} must be between ${min} and ${max}${['grid_w', 'grid_h'].includes(field) ? '' : ' and a whole number'}.`,
          });
      }
      for (const input of document.querySelectorAll<HTMLInputElement>(
        '#widget-options input[data-field]',
      ))
        if (!input.validity.valid)
          errors.push({
            field: input.dataset.field!,
            message: `${input.getAttribute('aria-label') ?? 'Option'}: ${input.validationMessage}`,
          });
      if (value.replacements.calendarUrl && !value.clear.calendarUrl) {
        try {
          const url = new URL(value.replacements.calendarUrl);
          if (!['http:', 'https:'].includes(url.protocol)) throw Error();
        } catch {
          errors.push({
            field: 'calendarUrl',
            message: 'Use an HTTP or HTTPS calendar feed URL.',
          });
        }
      }
      return errors;
    },
    save: async (value, expected) => {
      const row = structuredClone(value.row),
        options = widgetOptions(row);
      for (const field of credentials(row.widget_type)) {
        if (value.clear[field.key]) options[field.key] = '';
        else if (value.replacements[field.key])
          options[field.key] = value.replacements[field.key];
      }
      try {
        const saved = await api.write<DashboardWidgetRow>('/widgets', {
          ...row,
          expected: creating ? undefined : expected.row.revision_token,
        });
        if (creating) {
          entityDraftStore.forget(key);
          navigate(`/config/dashboard/${layoutId}/widgets/${saved.id}`, {
            replace: true,
          });
        }
        return toDraft(saved);
      } catch (error) {
        if (error instanceof ConfigApiError && error.current)
          error.current = toDraft(error.current as DashboardWidgetRow);
        throw error;
      }
    },
  });
  const value = draft.value,
    row = value?.row,
    known = row && row.widget_type in widgetRegistry;
  const malformed =
    row &&
    (!isRecord(row.config) ||
      (row.config.options !== undefined && !isRecord(row.config.options)));
  const options = row ? widgetOptions(row) : {};
  const setRow = (patch: Partial<DashboardWidgetRow>) =>
    draft.change((current) => ({
      ...current,
      row: { ...current.row, ...patch },
    }));
  const setOption = (field: string, next: unknown) =>
    draft.change((current) => {
      const row = structuredClone(current.row);
      widgetOptions(row)[field] = next;
      return { ...current, row };
    });
  const knownKeys = known
    ? Object.keys(widgetRegistry[row.widget_type as WidgetType].defaultOptions)
    : [];
  const extra = Object.fromEntries(
    Object.entries(options).filter(
      ([key]) =>
        !knownKeys.includes(key) &&
        key !== 'sensorSelection' &&
        key !== 'title' &&
        !credentials(row?.widget_type ?? '').some((field) => field.key === key),
    ),
  );
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title={creating ? 'New widget' : row ? widgetTitle(row) : 'Widget'}
        description={
          <Link to={`/config/dashboard/${layoutId}`} className="settings-link">
            {api.layouts.data?.find((layout) => String(layout.id) === layoutId)
              ?.name ?? 'Dashboard layout'}
          </Link>
        }
        actions={
          !creating && (
            <Button variant="outline" asChild>
              <Link to={`/?layout=${layoutId}`}>View dashboard</Link>
            </Button>
          )
        }
      />
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {api.widgets.isError && (
        <p role="alert">
          Could not refresh widgets. Your draft is kept.{' '}
          <Button variant="outline" onClick={() => void api.widgets.refetch()}>
            Retry
          </Button>
        </p>
      )}
      {!value || !row ? (
        <p>
          {api.widgets.isPending
            ? 'Loading widget…'
            : 'This widget is unavailable.'}
        </p>
      ) : !known || malformed ? (
        <SettingsSection title="Unsupported widget">
          <p className="text-sm">
            This definition is preserved. It cannot be edited by this version.
          </p>
          <pre className="overflow-auto text-xs">
            {JSON.stringify(row, null, 2)}
          </pre>
        </SettingsSection>
      ) : (
        <>
          <SettingsSection title="Widget">
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block space-y-2 text-sm">
                Title
                <Input
                  {...entityFieldProps(draft, 'title')}
                  value={widgetTitle(row)}
                  onChange={(event) =>
                    setRow({
                      config: {
                        ...(row.config as object),
                        title: event.target.value,
                      },
                    })
                  }
                />
              </label>
              <label className="block space-y-2 text-sm">
                Type
                {creating ? (
                  <select
                    className="settings-select"
                    aria-label="Widget type"
                    value={row.widget_type}
                    onChange={(event) => {
                      const next = event.target.value as WidgetType;
                      const config = entityDraftStore.switchVariant(
                        key,
                        'widget-type',
                        row.widget_type,
                        {
                          config: row.config,
                          replacements: value.replacements,
                          clear: value.clear,
                        },
                        next,
                        {
                          config: {
                            title: widgetRegistry[next].name,
                            options: defaults(next),
                          },
                          replacements: {},
                          clear: {},
                        },
                      );
                      draft.change({
                        ...value,
                        replacements: config.replacements,
                        clear: config.clear,
                        row: {
                          ...row,
                          widget_type: next,
                          config: config.config,
                        },
                      });
                    }}
                  >
                    {Object.entries(widgetRegistry).map(([key, info]) => (
                      <option key={key} value={key}>
                        {info.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="block py-2 text-muted-foreground">
                    {widgetRegistry[row.widget_type as WidgetType].name}
                  </span>
                )}
              </label>
            </div>
          </SettingsSection>
          <SettingsSection id="widget-options" title="Content">
            <WidgetOptionFields
              widgetType={row.widget_type as WidgetType}
              options={options}
              onChange={setOption}
            />
          </SettingsSection>
          {sourceFor[row.widget_type] && (
            <SettingsSection
              title="Data source"
              description="Empty widget overrides use the shared service."
            >
              <Link
                className="settings-link text-sm"
                to={`/config/widget-sources/${sourceFor[row.widget_type]}`}
              >
                Open shared {sourceFor[row.widget_type].replace('_', ' ')}{' '}
                settings
              </Link>
              {credentials(row.widget_type).map((field) => (
                <div className="space-y-2" key={field.key}>
                  <label className="block space-y-2 text-sm">
                    {field.label} override
                    <Input
                      {...entityFieldProps(draft, field.key)}
                      type="password"
                      autoComplete="new-password"
                      value={value.replacements[field.key] ?? ''}
                      disabled={value.clear[field.key]}
                      placeholder={
                        row.secret_fields?.includes(field.key)
                          ? 'Saved — leave empty to keep'
                          : 'Use shared service'
                      }
                      onChange={(event) =>
                        draft.patch({
                          replacements: {
                            ...value.replacements,
                            [field.key]: event.target.value,
                          },
                        })
                      }
                    />
                  </label>
                  {row.secret_fields?.includes(field.key) && (
                    <label className="flex min-h-11 items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={value.clear[field.key] ?? false}
                        onChange={(event) =>
                          draft.patch({
                            clear: {
                              ...value.clear,
                              [field.key]: event.target.checked,
                            },
                          })
                        }
                      />
                      Remove override on Save
                    </label>
                  )}
                </div>
              ))}
            </SettingsSection>
          )}
          <SettingsSection
            title="Layout"
            description="Width and height use grid cells. Quarter-cell sizes are supported."
          >
            <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
              {(
                ['grid_w', 'grid_h', 'grid_x', 'grid_y', 'sort_order'] as const
              ).map((field) => (
                <label key={field} className="block space-y-2 text-sm">
                  {
                    {
                      grid_w: 'Width',
                      grid_h: 'Height',
                      grid_x: 'Column',
                      grid_y: 'Row',
                      sort_order: 'Display order',
                    }[field]
                  }
                  <Input
                    {...entityFieldProps(draft, field)}
                    type="number"
                    step={field === 'grid_w' || field === 'grid_h' ? 0.25 : 1}
                    value={Number.isNaN(row[field]) ? '' : row[field]}
                    onChange={(event) =>
                      setRow({ [field]: event.target.valueAsNumber })
                    }
                  />
                </label>
              ))}
            </div>
          </SettingsSection>
          {(Object.keys(extra).length > 0 || advanced) && (
            <SettingsSection
              title="Additional options"
              description="Extension fields are preserved alongside the typed controls."
            >
              <JsonValueEditor
                label="Options"
                value={extra}
                fixedType="object"
                draftKey={key}
                path="widget-extensions"
                onChange={(next) => {
                  if (!isRecord(next)) return;
                  const copy = structuredClone(row),
                    target = widgetOptions(copy);
                  for (const key of Object.keys(extra)) delete target[key];
                  for (const [key, value] of Object.entries(next))
                    if (
                      !knownKeys.includes(key) &&
                      key !== 'sensorSelection' &&
                      !credentials(row.widget_type).some(
                        (field) => field.key === key,
                      )
                    )
                      target[key] = value;
                  setRow({ config: copy.config });
                }}
              />
            </SettingsSection>
          )}
          {!creating && (
            <SettingsSection title="Remove widget">
              <Button
                variant="outline"
                onClick={async () => {
                  if (
                    !(await confirmDialog({
                      title: `Remove ${widgetTitle(row)}?`,
                      description:
                        'This removes the widget from this layout and discards its pending edits.',
                      confirmLabel: 'Remove widget',
                      destructive: true,
                    }))
                  )
                    return;
                  try {
                    await api.write(`/widgets/${row.id}`, undefined, 'DELETE');
                    draft.forget();
                    navigate(`/config/dashboard/${layoutId}`);
                  } catch (error) {
                    setError(
                      error instanceof Error
                        ? error.message
                        : 'Could not remove widget.',
                    );
                  }
                }}
              >
                <Trash2 className="size-4" />
                Remove widget
              </Button>
            </SettingsSection>
          )}
          <EntitySaveBar
            draft={draft}
            createLabel={creating ? 'Create widget' : undefined}
            sensitivePaths={[
              '/replacements',
              '/row/config/options/influxToken',
              '/row/config/options/calendarUrl',
            ]}
          />
        </>
      )}
    </div>
  );
}
