import { ReorderButtons } from '@/ui/settings/ReorderButtons';
import { moveSibling } from '@/lib/routineDraft';
import { Link } from 'react-router-dom';
import { useAppConfig } from '@/hooks/appConfig';
import {
  useSensorCatalog,
  type SensorCatalog,
  type SensorCatalogItem,
  type SensorCatalogGroup,
} from '@/hooks/sensorCatalog';
import { useTempSensorsResource } from '@/hooks/influxdb';
import { useEntityDraft, entityFieldProps } from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import type { FieldError } from '@/lib/configSection';
import { createUuid } from '@/lib/uuid';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { SearchablePicker, SearchableMultiPicker } from '@/ui/SearchablePicker';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { ConfigPageHeader } from '../page-header';

function validate(catalog: SensorCatalog): FieldError[] {
  const errors: FieldError[] = [],
    ids = new Set<string>(),
    groupIds = new Set<string>();
  catalog.sensors.forEach((sensor, index) => {
    if (
      !sensor.id.trim() ||
      sensor.id.trim() !== sensor.id ||
      ids.has(sensor.id)
    )
      errors.push({
        field: `sensors.${index}.id`,
        message: 'Use a unique sensor ID without surrounding spaces.',
      });
    ids.add(sensor.id);
    if (!sensor.name.trim())
      errors.push({
        field: `sensors.${index}.name`,
        message: 'Give each sensor a name.',
      });
    if (!sensor.source.trim())
      errors.push({
        field: `sensors.${index}.source`,
        message: 'Choose a sensor source.',
      });
  });
  catalog.groups.forEach((group, index) => {
    if (
      !group.id.trim() ||
      group.id.trim() !== group.id ||
      groupIds.has(group.id)
    )
      errors.push({
        field: `groups.${index}.id`,
        message: 'Use a unique group ID without surrounding spaces.',
      });
    groupIds.add(group.id);
    if (!group.name.trim())
      errors.push({
        field: `groups.${index}.name`,
        message: 'Give each sensor group a name.',
      });
    if (
      group.sensorIds.some((id) => !ids.has(id)) ||
      new Set(group.sensorIds).size !== group.sensorIds.length
    )
      errors.push({
        field: `groups.${index}.sensorIds`,
        message: `${group.name || 'This group'} has missing or duplicate members. Remove or replace those references.`,
      });
  });
  return errors;
}

export default function SensorCatalogPage() {
  const query = useSensorCatalog(),
    observed = useTempSensorsResource();
  const { apiEndpoint } = useAppConfig(),
    { advanced } = useSettingsPreferences();
  const draft = useEntityDraft({
    key: `${apiEndpoint}/sensor-catalog`,
    item: query.catalog,
    label: 'Sensor catalog',
    href: '/config/sensors',
    save: query.saveCatalog,
    validate,
  });
  const value = draft.value;
  const patchSensor = (index: number, patch: Partial<SensorCatalogItem>) =>
    draft.change((current) => ({
      ...current,
      sensors: current.sensors.map((sensor, i) =>
        i === index ? { ...sensor, ...patch } : sensor,
      ),
    }));
  const patchGroup = (index: number, patch: Partial<SensorCatalogGroup>) =>
    draft.change((current) => ({
      ...current,
      groups: current.groups.map((group, i) =>
        i === index ? { ...group, ...patch } : group,
      ),
    }));
  const addSensor = (id = '') =>
    draft.change((current) => ({
      ...current,
      sensors: [
        ...current.sensors,
        { id, name: id, source: 'influxdb', enabled: true },
      ],
    }));
  const observedIds = [
    ...new Set(observed.rows.map((row) => row.device_id)),
  ].filter((id) => !value?.sensors.some((sensor) => sensor.id === id));
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title="Sensor catalog"
        actions={
          <Button variant="outline" asChild>
            <Link to="/config/sensor-history">Sensor activity</Link>
          </Button>
        }
        description="Names and groups for dashboard temperature and humidity readings. Choose which sensors a widget displays in that widget's settings."
      />
      {query.isError && (
        <div role="alert" className="text-sm text-destructive">
          {query.error.message}{' '}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
          {value && (
            <p>Your draft is kept. The saved catalog could not be refreshed.</p>
          )}
        </div>
      )}
      {!value ? (
        <p className="text-sm text-muted-foreground">
          {query.isLoading
            ? 'Loading sensor catalog…'
            : 'The sensor catalog is unavailable.'}
        </p>
      ) : (
        <>
          <SettingsSection
            id="sensors"
            title="Sensors"
            description="The sensor ID must match the ID reported by your data source. Removing an entry also removes its membership here; widgets keep their own selections."
            actions={
              <Button variant="outline" size="sm" onClick={() => addSensor()}>
                Add sensor
              </Button>
            }
          >
            <div className="max-w-md">
              <SearchablePicker
                value=""
                options={observedIds.map((id) => ({ value: id, label: id }))}
                onChange={addSensor}
                placeholder="Add an observed sensor…"
                disabled={!observedIds.length}
              />
              {observed.error && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Observed readings are unavailable. You can still add a sensor
                  by ID.
                </p>
              )}
            </div>
            {!value.sensors.length && (
              <p className="text-sm text-muted-foreground">
                No named sensors yet. Unlisted readings can still appear in
                widgets.
              </p>
            )}
            <div className="space-y-3">
              {value.sensors.map((sensor, index) => {
                const saved = draft.entry?.baseline.sensors.some(
                  (row) => row.id === sensor.id,
                );
                return (
                  <div
                    key={index}
                    id={`sensor-${encodeURIComponent(sensor.id)}`}
                    className="grid gap-3 rounded-md border border-border p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto]"
                  >
                    <label className="grid content-start gap-1.5 text-xs">
                      Name
                      <Input
                        aria-label={`Sensor ${index + 1} name`}
                        {...entityFieldProps(draft, `sensors.${index}.name`)}
                        value={sensor.name}
                        onChange={(event) =>
                          patchSensor(index, { name: event.target.value })
                        }
                      />
                    </label>
                    {!saved ? (
                      <label className="grid content-start gap-1.5 text-xs">
                        Sensor ID
                        <Input
                          aria-label={`Sensor ${index + 1} ID`}
                          {...entityFieldProps(draft, `sensors.${index}.id`)}
                          value={sensor.id}
                          onChange={(event) =>
                            patchSensor(index, { id: event.target.value })
                          }
                        />
                      </label>
                    ) : (
                      <div className="self-center text-xs text-muted-foreground">
                        {advanced && (
                          <>
                            <span className="block">Sensor ID</span>
                            <code className="break-all">{sensor.id}</code>
                          </>
                        )}
                        {sensor.source === 'influxdb' && (
                          <Link
                            className="settings-link block"
                            to="/config/widget-sources/influxdb"
                          >
                            InfluxDB
                          </Link>
                        )}
                      </div>
                    )}
                    <div className="space-y-2">
                      {sensor.source !== 'influxdb' && (
                        <label className="grid content-start gap-1.5 text-xs">
                          Source
                          <SettingsSelect
                            aria-label={`Source for ${sensor.name || 'sensor ' + (index + 1)}`}
                            {...entityFieldProps(
                              draft,
                              `sensors.${index}.source`,
                            )}
                            value={
                              sensor.source
                                ? `source:${sensor.source}`
                                : 'missing'
                            }
                            onValueChange={(value) =>
                              patchSensor(index, {
                                source:
                                  value === 'missing' ? '' : value.slice(7),
                              })
                            }
                            options={[
                              { value: 'source:influxdb', label: 'InfluxDB' },
                              {
                                value: sensor.source
                                  ? `source:${sensor.source}`
                                  : 'missing',
                                label: sensor.source || '(missing source)',
                              },
                            ]}
                          />
                        </label>
                      )}
                      <label className="flex min-h-9 items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          aria-label={`Enable ${sensor.name || 'sensor ' + (index + 1)}`}
                          checked={sensor.enabled}
                          onChange={(event) =>
                            patchSensor(index, {
                              enabled: event.target.checked,
                            })
                          }
                        />
                        Show in dashboard readings
                      </label>
                      {sensor.source !== 'influxdb' && (
                        <p className="text-xs text-amber-700">
                          This source is preserved, but the current dashboard
                          only fetches InfluxDB readings.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-1 self-end">
                      <ReorderButtons
                        label={`sensor ${sensor.name || index + 1}`}
                        index={index}
                        total={value.sensors.length}
                        onMove={(offset) =>
                          draft.patch({
                            sensors: moveSibling(value.sensors, index, offset),
                          })
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        className="self-end justify-self-end"
                        aria-label={`Remove sensor ${sensor.name || index + 1}`}
                        onClick={() =>
                          draft.change((current) => ({
                            ...current,
                            sensors: current.sensors.filter(
                              (_, i) => i !== index,
                            ),
                            groups: current.groups.map((group) => ({
                              ...group,
                              sensorIds: group.sensorIds.filter(
                                (id) => id !== sensor.id,
                              ),
                            })),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </SettingsSection>
          <SettingsSection
            id="sensor-groups"
            title="Sensor groups"
            description="Groups filter dashboard readings. The group with ID “indoor” identifies indoor sensors; these groups are separate from Rooms & groups."
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  draft.change((current) => ({
                    ...current,
                    groups: [
                      ...current.groups,
                      { id: createUuid(), name: '', sensorIds: [] },
                    ],
                  }))
                }
              >
                Add group
              </Button>
            }
          >
            {!value.groups.length && (
              <p className="text-sm text-muted-foreground">No sensor groups.</p>
            )}
            {value.groups.map((group, index) => (
              <div
                key={index}
                className="space-y-3 rounded-md border border-border p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <label className="grid content-start gap-1.5 text-xs">
                    Name
                    <Input
                      aria-label={`Group ${index + 1} name`}
                      {...entityFieldProps(draft, `groups.${index}.name`)}
                      value={group.name}
                      onChange={(event) =>
                        patchGroup(index, { name: event.target.value })
                      }
                    />
                  </label>
                  <label className="grid content-start gap-1.5 text-xs">
                    Group ID
                    <Input
                      aria-label={`Group ${index + 1} ID`}
                      {...entityFieldProps(draft, `groups.${index}.id`)}
                      value={group.id}
                      onChange={(event) =>
                        patchGroup(index, { id: event.target.value })
                      }
                    />
                  </label>
                  <div className="flex items-center justify-end gap-1 self-end">
                    <ReorderButtons
                      label={`group ${group.name || index + 1}`}
                      index={index}
                      total={value.groups.length}
                      onMove={(offset) =>
                        draft.patch({
                          groups: moveSibling(value.groups, index, offset),
                        })
                      }
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      className="self-end justify-self-end"
                      aria-label={`Remove group ${group.name || index + 1}`}
                      onClick={() =>
                        draft.patch({
                          groups: value.groups.filter((_, i) => i !== index),
                        })
                      }
                    >
                      Remove
                    </Button>
                  </div>
                </div>
                <div
                  {...entityFieldProps(draft, `groups.${index}.sensorIds`)}
                  tabIndex={-1}
                >
                  <SearchableMultiPicker
                    ordered
                    options={value.sensors
                      .filter((sensor) => sensor.id)
                      .map((sensor) => ({
                        value: sensor.id,
                        label: sensor.name || sensor.id,
                      }))}
                    value={group.sensorIds}
                    onChange={(sensorIds) => patchGroup(index, { sensorIds })}
                    placeholder={`Add members to ${group.name || 'group'}…`}
                    hrefFor={(id) =>
                      `/config/sensors#sensor-${encodeURIComponent(id)}`
                    }
                  />
                </div>
                {group.sensorIds.some(
                  (id) => !value.sensors.some((sensor) => sensor.id === id),
                ) && (
                  <p className="text-xs text-amber-700">
                    Some members are missing. Remove those references or add the
                    matching sensors above.
                  </p>
                )}
              </div>
            ))}
          </SettingsSection>
          <div className="flex flex-wrap gap-4 text-sm">
            <Link className="settings-link" to="/dashboard">
              Open dashboard
            </Link>
            <Link className="settings-link" to="/config/devices">
              Device sensors
            </Link>
          </div>
          <EntitySaveBar draft={draft} />
        </>
      )}
    </div>
  );
}
