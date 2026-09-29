import { useMemo } from 'react';
import { useAtom } from 'jotai';
import { accentAtom, densityAtom } from '@/hooks/preferences';
import { useTheme } from '@/hooks/theme';
import { useBackdropBlurEffects } from '@/hooks/visualEffects';
import { useDeveloperMode } from '@/hooks/developerMode';
import { useEntityDraft } from '@/hooks/useEntityDraft';
import { ConfigApiError } from '@/hooks/useConfig';
import { accents, densities } from '@/lib/preferences';
import { EntitySaveBar } from '@/ui/settings/EntitySaveBar';
import { SettingsSection } from '@/ui/settings/SettingsSection';

export function AppearanceSection() {
  const [theme, setTheme] = useTheme();
  const [accent, setAccent] = useAtom(accentAtom);
  const [density, setDensity] = useAtom(densityAtom);
  const [blur, setBlur] = useBackdropBlurEffects();
  const [developerMode, setDeveloperMode] = useDeveloperMode();
  const saved = useMemo(
    () => ({ theme, accent, density, blur, developerMode }),
    [theme, accent, density, blur, developerMode],
  );
  const draft = useEntityDraft({
    key: 'browser/appearance',
    item: saved,
    label: 'Browser appearance',
    href: '/config/settings?tab=appearance',
    save: async (value, expected) => {
      if (JSON.stringify(expected) !== JSON.stringify(saved))
        throw new ConfigApiError(
          'Appearance changed in another tab.',
          409,
          saved,
        );
      setTheme(value.theme);
      setAccent(value.accent);
      setDensity(value.density);
      setBlur(value.blur);
      setDeveloperMode(value.developerMode);
      return value;
    },
  });
  const value = draft.value!;
  return (
    <>
      <SettingsSection
        id="browser-appearance"
        title="Appearance"
        description="Saved in this browser. Changes take effect when you save."
      >
        <div className="grid gap-5 lg:grid-cols-2">
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm font-medium">Theme</legend>
            <div className="flex flex-wrap gap-2">
              {(['light', 'dark', 'auto'] as const).map((theme) => (
                <label key={theme} className="settings-choice">
                  <input
                    type="radio"
                    name="appearance-theme"
                    value={theme}
                    checked={value.theme === theme}
                    onChange={() => draft.patch({ theme })}
                  />
                  {theme === 'auto'
                    ? 'Follow system'
                    : theme === 'dark'
                      ? 'Dark'
                      : 'Light'}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0 space-y-2">
            <legend className="text-sm font-medium">Density</legend>
            <div className="flex flex-wrap gap-2">
              {densities.map((density) => (
                <label key={density} className="settings-choice">
                  <input
                    type="radio"
                    name="appearance-density"
                    value={density}
                    checked={value.density === density}
                    onChange={() => draft.patch({ density })}
                  />
                  {density === 'compact' ? 'Compact' : 'Comfortable'}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Compact fits more rows. Phone controls keep their touch targets.
            </p>
          </fieldset>
          <fieldset className="min-w-0 space-y-2 lg:col-span-2">
            <legend className="text-sm font-medium">Accent color</legend>
            <div className="flex flex-wrap gap-2">
              {accents.map((accent) => (
                <label key={accent.id} className="settings-choice">
                  <input
                    type="radio"
                    name="appearance-accent"
                    value={accent.id}
                    checked={value.accent === accent.id}
                    onChange={() => draft.patch({ accent: accent.id })}
                  />
                  <span
                    aria-hidden
                    className="size-4 rounded-full"
                    style={{ backgroundColor: accent.swatch }}
                  />
                  {accent.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Used for primary buttons, focus rings and charts.
            </p>
          </fieldset>
        </div>
      </SettingsSection>
      <SettingsSection id="browser-tools" title="Display & troubleshooting">
        <div className="grid gap-4 lg:grid-cols-2">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={value.blur}
              onChange={(event) => draft.patch({ blur: event.target.checked })}
            />
            <span>
              <strong className="font-medium">Blur effects</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                Turn off if scrolling stutters on this device.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={value.developerMode}
              onChange={(event) =>
                draft.patch({ developerMode: event.target.checked })
              }
            />
            <span>
              <strong className="font-medium">Developer mode</strong>
              <span className="mt-1 block text-xs text-muted-foreground">
                Show troubleshooting actions such as manual refresh. Saved in
                this browser.
              </span>
            </span>
          </label>
        </div>
      </SettingsSection>
      <EntitySaveBar draft={draft} />
    </>
  );
}
