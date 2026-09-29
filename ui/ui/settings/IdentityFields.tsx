import { entityFieldProps, type EntityDraftApi } from '@/hooks/useEntityDraft';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { suggestId } from '@/lib/groupGraph';
import { ConfigField } from '@/ui/config-form';
import { Input } from '@/ui/primitives/input';
/** Names are editable; existing reference IDs are compact metadata, never fake inputs. */
export function IdentityFields<T extends { id: string; name: string }>({
  draft,
  creating,
  existingIds,
}: {
  draft: EntityDraftApi<T>;
  creating: boolean;
  existingIds: string[];
}) {
  const { advanced } = useSettingsPreferences();
  const value = draft.value;
  if (!value) return null;
  return (
    <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_minmax(120px,.6fr)]">
      <ConfigField label="Name">
        <Input
          {...entityFieldProps(draft, 'name')}
          value={value.name}
          onChange={(event) => {
            const name = event.target.value;
            draft.change((current) => ({
              ...current,
              name,
              ...(creating &&
              (!current.id ||
                current.id === suggestId(current.name, existingIds))
                ? { id: suggestId(name, existingIds) }
                : {}),
            }));
          }}
        />
      </ConfigField>
      {creating ? (
        <ConfigField
          label="ID"
          description="Suggested from the name. Used by references."
        >
          <Input
            {...entityFieldProps(draft, 'id')}
            value={value.id}
            onChange={(event) =>
              draft.change((current) => ({
                ...current,
                id: event.target.value,
              }))
            }
          />
        </ConfigField>
      ) : (
        advanced && (
          <p className="pb-2 text-xs text-muted-foreground">
            ID <code className="ml-1 break-all">{value.id}</code>
          </p>
        )
      )}
    </div>
  );
}
