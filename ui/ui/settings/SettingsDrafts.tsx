import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useEntityDrafts } from '@/hooks/useEntityDraft';

export function SettingsDraftGuard() {
  const drafts = useEntityDrafts();
  const dirty = drafts.some((draft) => draft.dirty || draft.saving);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  return null;
}
export function RetainedDrafts({ activeKey }: { activeKey?: string } = {}) {
  const { pathname, search } = useLocation();
  const drafts = useEntityDrafts().filter(
    (draft) =>
      (draft.dirty || draft.saving) &&
      draft.key !== activeKey &&
      (draft.href.split('#')[0].split('?')[0] !== pathname ||
        [...new URLSearchParams(draft.href.split('#')[0].split('?')[1])].some(
          ([key, value]) => new URLSearchParams(search).get(key) !== value,
        )),
  );
  if (!drafts.length) return null;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-amber-500/5 px-5 py-2 text-xs"
      aria-label="Retained drafts"
    >
      <span className="text-muted-foreground">Unsaved drafts</span>
      {drafts.map((draft) => (
        <Link
          key={draft.key}
          className="font-medium underline underline-offset-4"
          to={draft.href}
        >
          {draft.label}
        </Link>
      ))}
    </div>
  );
}
