import { Link } from 'react-router-dom';
import { useState } from 'react';

import { formatBuildInfoSummary, normalizeBuildInfo } from '@/lib/buildInfo';
import {
  configSections,
  matchesConfigSectionSearch,
  type ConfigSection,
} from './sections';
import { ConfigPageHeader } from './page-header';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';

const sectionGroups = [
  'Core',
  'Automation',
  'Interface',
  'Operations',
] as const;

const buildInfo = normalizeBuildInfo({
  version: import.meta.env.VITE_APP_VERSION,
  gitCommit: import.meta.env.VITE_GIT_COMMIT,
  buildDate: import.meta.env.VITE_BUILD_DATE,
});

export default function ConfigPage() {
  const [search, setSearch] = useState('');
  const visibleSections = configSections.filter((section) =>
    matchesConfigSectionSearch(section, search),
  );

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <ConfigPageHeader
          backTo={null}
          title="Settings"
          description="Manage devices, automations, and appearance."
        />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search integrations, scenes, backups, logs..."
          aria-label="Search configuration sections"
        />
      </div>

      {visibleSections.length === 0 ? (
        <EmptyState
          title="No config sections found"
          description="Try searching for a plugin, automation, dashboard, backup, or runtime term."
        />
      ) : (
        <div className="space-y-6">
          {sectionGroups.map((group) => {
            const groupSections = visibleSections.filter(
              (section) => section.group === group,
            );

            if (groupSections.length === 0) {
              return null;
            }

            return (
              <section key={group} className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </h2>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {groupSections.map((section) => (
                    <ConfigSectionCard key={section.href} section={section} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <footer className="border-t border-border/50 pt-4 text-center text-xs text-muted-foreground/70">
        <p className="break-words leading-relaxed">
          {formatBuildInfoSummary(buildInfo)}
        </p>
      </footer>
    </div>
  );
}

function ConfigSectionCard({ section }: { section: ConfigSection }) {
  return (
    <Link
      to={section.href}
      className="block rounded-xl border border-border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="text-sm font-semibold">{section.label}</div>
      <p className="mt-1 text-sm text-muted-foreground">
        {section.description}
      </p>
    </Link>
  );
}
