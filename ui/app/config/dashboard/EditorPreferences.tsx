import {
  useDashboardEditingSettings,
  DASHBOARD_GRID_SNAP_OPTIONS,
  DASHBOARD_SCREEN_SIMULATION_OPTIONS,
  type DashboardGridSnap,
  type DashboardScreenSimulation,
} from '@/hooks/dashboardEditing';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { ConfigApiError } from '@/hooks/useConfig';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { SettingsSection } from '@/ui/settings/SettingsSection';
export function EditorPreferences({ href }: { href: string }) {
  const [saved, setSaved] = useDashboardEditingSettings();
  const draft = useEntityDraft({
    key: 'browser/dashboard-editor',
    item: saved,
    label: 'Dashboard editor preferences',
    href,
    save: async (value, expected) => {
      if (JSON.stringify(expected) !== JSON.stringify(saved))
        throw new ConfigApiError(
          'Editor preferences changed in another tab.',
          409,
          saved,
        );
      setSaved(value);
      return value;
    },
  });
  return (
    <SettingsSection
      title="Editor preferences"
      description="Saved in this browser. These controls change the arrangement tool, not the saved dashboard."
    >
      <div className="grid gap-4 md:grid-cols-2">
        <label className="block space-y-2 text-sm">
          Resize snap
          <select
            className="settings-select"
            value={draft.value!.gridSnap}
            onChange={(event) =>
              draft.patch({
                gridSnap: Number(event.target.value) as DashboardGridSnap,
              })
            }
          >
            {DASHBOARD_GRID_SNAP_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block space-y-2 text-sm">
          Screen preview
          <select
            className="settings-select"
            value={draft.value!.screenSimulation}
            onChange={(event) =>
              draft.patch({
                screenSimulation: event.target
                  .value as DashboardScreenSimulation,
              })
            }
          >
            {DASHBOARD_SCREEN_SIMULATION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <EntitySaveBar draft={draft} />
    </SettingsSection>
  );
}
