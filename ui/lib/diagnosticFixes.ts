import type { ConfigDiagnostic } from '../bindings/ConfigDiagnostic';

type GroupRow = {
  id: string;
  name: string;
  devices: { integration_id: string; device_id: string }[];
  linked_groups: string[];
};
type SceneRow = {
  id: string;
  name: string;
  device_states: Record<string, unknown>;
  group_states: Record<string, unknown>;
  group_state_order?: string[];
};

export type DiagnosticFix =
  | { entity: 'group'; label: string; apply: <T extends GroupRow>(row: T) => T }
  | {
      entity: 'scene';
      label: string;
      apply: <T extends SceneRow>(row: T) => T;
    };

const without = <V>(record: Record<string, V>, key: string) =>
  Object.fromEntries(Object.entries(record).filter(([id]) => id !== key));

/**
 * The one-click repair for a broken reference, when removing it is the only
 * sensible fix. Issues that need a choice (a replacement device, another
 * scene to follow) return null and stay with the editor's repair controls.
 */
export function diagnosticFix(issue: ConfigDiagnostic): DiagnosticFix | null {
  const reference = issue.reference;
  if (!reference) return null;
  switch (issue.code) {
    case 'missing_group_device':
      return {
        entity: 'group',
        label: 'Remove from room',
        apply: (row) => ({
          ...row,
          devices: row.devices.filter(
            (device) =>
              `${device.integration_id}/${device.device_id}` !== reference,
          ),
        }),
      };
    case 'missing_group_link':
      return {
        entity: 'group',
        label: 'Remove link',
        apply: (row) => ({
          ...row,
          linked_groups: row.linked_groups.filter((id) => id !== reference),
        }),
      };
    case 'missing_scene_device':
      return {
        entity: 'scene',
        label: 'Remove target',
        apply: (row) => ({
          ...row,
          device_states: without(row.device_states, reference),
        }),
      };
    case 'missing_scene_group':
      return {
        entity: 'scene',
        label: 'Remove target',
        apply: (row) => ({
          ...row,
          group_states: without(row.group_states, reference),
          ...(row.group_state_order
            ? {
                group_state_order: row.group_state_order.filter(
                  (id) => id !== reference,
                ),
              }
            : {}),
        }),
      };
    default:
      return null;
  }
}
