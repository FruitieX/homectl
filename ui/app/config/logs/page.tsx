import { LogLevel, UiLogEntry, useLogs } from '@/hooks/useConfig';
import { ConfigPageHeader } from '../page-header';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
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
import { Label } from '@/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select';
import { Skeleton } from '@/ui/primitives/skeleton';
import { RefreshCw } from 'lucide-react';
import { useState } from 'react';

const levelBadgeVariant: Record<
  LogLevel,
  'default' | 'destructive' | 'secondary' | 'muted' | 'outline'
> = {
  ERROR: 'destructive',
  WARN: 'secondary',
  INFO: 'default',
  DEBUG: 'muted',
  TRACE: 'outline',
};

const levelOptions: Array<LogLevel | 'ALL'> = [
  'ALL',
  'ERROR',
  'WARN',
  'INFO',
  'DEBUG',
  'TRACE',
];

function formatTimestamp(timestamp: string) {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
}

function matchesLevelFilter(entry: UiLogEntry, levelFilter: LogLevel | 'ALL') {
  if (levelFilter === 'ALL') {
    return true;
  }

  return entry.level === levelFilter;
}

function matchesSearchFilter(entry: UiLogEntry, search: string) {
  if (!search) {
    return true;
  }

  const haystack =
    `${entry.level} ${entry.target} ${entry.message}`.toLowerCase();
  return haystack.includes(search);
}

export default function LogsPage() {
  const { data, loading, error, refetch, lastUpdated } = useLogs();
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const normalizedSearch = search.trim().toLowerCase();
  const visibleLogs = [...data]
    .reverse()
    .filter((entry) => matchesLevelFilter(entry, levelFilter))
    .filter((entry) => matchesSearchFilter(entry, normalizedSearch));
  const filtersActive = levelFilter !== 'ALL' || normalizedSearch.length > 0;
  const initialLoading = loading && data.length === 0;

  return (
    <div className="max-w-6xl space-y-5">
      <ConfigPageHeader
        title="Server Logs"
        description="Recent runtime logs from the server process. This view auto-refreshes every 5 seconds."
        actions={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="text-xs text-muted-foreground">
              {lastUpdated
                ? `Last updated ${formatTimestamp(lastUpdated)}`
                : 'Waiting for first update'}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={loading}
              onClick={() => void refetch()}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />
              Refresh Now
            </Button>
          </div>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertDescription className="flex flex-col gap-3">
            <span>{error}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => void refetch()}
            >
              Retry
            </Button>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardContent className="gap-4 pt-5">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="grid w-full gap-2 lg:max-w-xs">
              <Label htmlFor="log-level">Level</Label>
              <Select
                value={levelFilter}
                onValueChange={(value) =>
                  setLevelFilter(value as LogLevel | 'ALL')
                }
              >
                <SelectTrigger id="log-level">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {levelOptions.map((level) => (
                    <SelectItem key={level} value={level}>
                      {level === 'ALL' ? 'All levels' : level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid w-full gap-2">
              <Label htmlFor="log-search">Search</Label>
              <Input
                id="log-search"
                type="search"
                placeholder="Filter by target or message"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3 text-sm text-muted-foreground">
            <span>
              Showing {visibleLogs.length} of {data.length} buffered log
              entries.
            </span>
            {filtersActive ? (
              <Button
                variant="ghost"
                size="sm"
                type="button"
                onClick={() => {
                  setLevelFilter('ALL');
                  setSearch('');
                }}
              >
                Clear
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {initialLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-36" />
          <Skeleton className="h-32" />
        </div>
      ) : visibleLogs.length === 0 ? (
        <EmptyState
          title={filtersActive ? 'No matching log entries' : 'No log entries'}
          description={
            filtersActive
              ? 'Nothing matches the current level and search filters.'
              : 'Logs appear here as soon as the server emits them.'
          }
          action={
            filtersActive ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setLevelFilter('ALL');
                  setSearch('');
                }}
              >
                Show all levels
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visibleLogs.map((entry, index) => (
            <Card key={`${entry.timestamp}-${entry.target}-${index}`}>
              <CardHeader className="gap-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={levelBadgeVariant[entry.level]}>
                      {entry.level}
                    </Badge>
                    <CardTitle className="break-all font-mono text-sm">
                      {entry.target}
                    </CardTitle>
                  </div>
                  <CardDescription>
                    {formatTimestamp(entry.timestamp)}
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap wrap-break-word rounded-2xl bg-muted p-4 text-sm leading-6 text-muted-foreground">
                  {entry.message}
                </pre>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
