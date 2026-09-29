import { useAppConfig } from '@/hooks/appConfig';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { EntitySaveBar } from './EntitySaveBar';
import { SettingsSection } from './SettingsSection';
import { Button } from '@/ui/primitives/button';
import { Switch } from '@/ui/primitives/switch';
export function PreferencesSection() {
  const preferences = useSettingsPreferences();
  const { apiEndpoint } = useAppConfig();
  const draft = useEntityDraft({
    key: `${apiEndpoint}/preferences`,
    item: preferences.data,
    label: 'Shared preferences',
    href: '/config/settings',
    save: preferences.save,
  });
  return (
    <SettingsSection
      id="shared-preferences"
      title="Shared preferences"
      description="Applies to everyone using this home."
    >
      {preferences.isError ? (
        <div className="flex items-center gap-3 text-sm">
          Could not load preferences.
          <Button variant="outline" onClick={() => void preferences.refetch()}>
            Retry
          </Button>
        </div>
      ) : !draft.value ? (
        <p className="text-sm text-muted-foreground">Loading preferences…</p>
      ) : (
        <label className="flex items-start gap-3 text-sm">
          <Switch
            className="mt-0.5"
            aria-label="Show advanced details"
            checked={draft.value.show_advanced_details}
            onCheckedChange={(checked) =>
              draft.patch({ show_advanced_details: checked })
            }
          />
          <span>
            <strong className="font-medium">Show advanced details</strong>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">
              Show IDs and technical context beside controls. Configuration that
              affects behavior, errors, and missing references stay visible.
            </span>
          </span>
        </label>
      )}
      <EntitySaveBar draft={draft} />
    </SettingsSection>
  );
}
