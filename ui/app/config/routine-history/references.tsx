import { createContext, useContext, type ReactNode } from 'react';
import {
  useGroups,
  useScenes,
  useHelpers,
  useSources,
  useRoutines,
  useDeviceDisplayNames,
} from '@/hooks/useConfig';
import { useDevicesApi } from '@/hooks/useDevicesApi';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { getDeviceDisplayLabel } from '@/lib/deviceLabel';
import { Button } from '@/ui/primitives/button';

const ReferenceContext = createContext({
  names: new Map<string, string>(),
  revisions: new Map<string, string>(),
  advanced: false,
  failures: [] as { refetch: () => Promise<unknown> }[],
});
export function ActivityReferenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const devices = useDevicesApi(),
    overrides = useDeviceDisplayNames(),
    groups = useGroups(),
    scenes = useScenes(),
    helpers = useHelpers(),
    sources = useSources(),
    routines = useRoutines();
  const { advanced } = useSettingsPreferences();
  const names = new Map<string, string>();
  const displayNames = Object.fromEntries(
    overrides.data.map((row) => [row.device_key, row.display_name]),
  );
  for (const device of devices.devices)
    names.set(
      `device/${device.integration_id}/${device.id}`,
      getDeviceDisplayLabel(device, displayNames),
    );
  for (const [kind, rows] of [
    ['group', groups.data],
    ['scene', scenes.data],
    ['helper', helpers.data],
    ['source', sources.data],
    ['routine', routines.data],
  ] as const)
    for (const row of rows) names.set(`${kind}/${row.id}`, row.name || row.id);
  const revisions = new Map(
    routines.data
      .filter((row) => row.revision !== undefined)
      .map((row) => [row.id, String(row.revision)]),
  );
  const failures = [
    devices,
    overrides,
    groups,
    scenes,
    helpers,
    sources,
    routines,
  ].filter((query) => query.error);
  return (
    <ReferenceContext.Provider value={{ names, revisions, advanced, failures }}>
      {children}
    </ReferenceContext.Provider>
  );
}
export function ActivityReferenceStatus() {
  const { failures } = useContext(ReferenceContext);
  return failures.length ? (
    <p role="status" className="text-sm text-muted-foreground">
      Some current reference names could not be refreshed. Recorded IDs and
      activity are kept.{' '}
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          void Promise.allSettled(failures.map((query) => query.refetch()))
        }
      >
        Retry reference names
      </Button>
    </p>
  ) : null;
}
export function ActivityEntityName({
  entity,
  id,
}: {
  entity: string;
  id: string;
}) {
  const { names, advanced } = useContext(ReferenceContext);
  const name = names.get(`${entity}/${id}`);
  return (
    <>
      {name || id}
      {advanced && name && name !== id && (
        <span className="text-muted-foreground"> · {id}</span>
      )}
    </>
  );
}
export function ActivityDefinitionNotice({
  id,
  recordedRevision,
}: {
  id: string;
  recordedRevision: bigint;
}) {
  const { revisions } = useContext(ReferenceContext);
  const current = revisions.get(id);
  return current && current !== String(recordedRevision) ? (
    <p role="status" className="text-sm text-muted-foreground">
      This routine has changed since this attempt. Links open its current
      definition.
    </p>
  ) : null;
}
