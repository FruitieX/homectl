import { KeyboardEvent as ReactKeyboardEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  configSections,
  matchesConfigSectionSearch,
  type ConfigSection,
} from './sections';
import { ConfigPageHeader } from './page-header';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';

const sectionGroups = [
  'Core',
  'Automation',
  'Interface',
  'Operations',
] as const;

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
          title="Config hub"
          description="Search or browse all configuration domains from one mobile-friendly hub."
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
                  <Badge variant="outline">{groupSections.length}</Badge>
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
    </div>
  );
}

function ConfigSectionCard({ section }: { section: ConfigSection }) {
  const navigate = useNavigate();

  const openSection = () => {
    navigate(section.href);
  };

  const handleCardKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) {
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openSection();
    }
  };

  return (
    <Card
      role="link"
      tabIndex={0}
      onClick={openSection}
      onKeyDown={handleCardKeyDown}
      className="h-full cursor-pointer transition-colors hover:border-primary/50 hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle>{section.label}</CardTitle>
          <Badge variant="secondary">{section.group}</Badge>
        </div>
        <CardDescription>{section.description}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1">
          {section.keywords.slice(0, 3).map((keyword) => (
            <Badge key={keyword} variant="muted">
              {keyword}
            </Badge>
          ))}
        </div>
        <Button
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            openSection();
          }}
        >
          Open
        </Button>
      </CardContent>
    </Card>
  );
}
