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
import { SettingsSelect } from '@/ui/settings/SettingsSelect';
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
          <SettingsSelect
            aria-label="Resize snap"
            value={String(draft.value!.gridSnap)}
            onValueChange={(value) =>
              draft.patch({
                gridSnap: Number(value) as DashboardGridSnap,
              })
            }
            options={DASHBOARD_GRID_SNAP_OPTIONS.map((option) => ({
              ...option,
              value: String(option.value),
            }))}
          />
        </label>
        <label className="block space-y-2 text-sm">
          Screen preview
          <SettingsSelect
            aria-label="Screen preview"
            value={draft.value!.screenSimulation}
            onValueChange={(value) =>
              draft.patch({
                screenSimulation: value as DashboardScreenSimulation,
              })
            }
            options={DASHBOARD_SCREEN_SIMULATION_OPTIONS}
          />
        </label>
      </div>
      <EntitySaveBar draft={draft} />
    </SettingsSection>
  );
}
