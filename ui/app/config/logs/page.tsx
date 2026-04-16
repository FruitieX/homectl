import { LogLevel, UiLogEntry, useLogs } from '@/hooks/useConfig';
import { useState } from 'react';

const levelBadgeClass: Record<LogLevel, string> = {
  ERROR: 'badge-error',
  WARN: 'badge-warning',
  INFO: 'badge-info',
  DEBUG: 'badge-neutral',
  TRACE: 'badge-ghost',
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
  return new Date(timestamp).toLocaleString('en-FI', {
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

  const haystack = `${entry.level} ${entry.target} ${entry.message}`.toLowerCase();
  return haystack.includes(search);
}

export default function LogsPage() {
  const { data, loading, error, refetch, lastUpdated } = useLogs();
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'ALL'>('ERROR');
  const [search, setSearch] = useState('');

  const normalizedSearch = search.trim().toLowerCase();
  const visibleLogs = [...data]
    .reverse()
    .filter((entry) => matchesLevelFilter(entry, levelFilter))
    .filter((entry) => matchesSearchFilter(entry, normalizedSearch));

  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Server Logs</h1>
          <p className="text-sm text-base-content/70">
            Recent runtime logs from the server process. This view auto-refreshes every 5 seconds.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="text-xs text-base-content/60">
            {lastUpdated ? `Last updated ${formatTimestamp(lastUpdated)}` : 'Waiting for first update'}
          </div>
          <button className="btn btn-outline btn-sm" onClick={() => void refetch()}>
            Refresh Now
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-warning">
          <span>{error}</span>
        </div>
      )}

      <div className="card bg-base-200 shadow-xl">
        <div className="card-body gap-4">
          <div className="flex flex-col gap-3 lg:flex-row">
            <label className="form-control w-full lg:max-w-xs">
              <div className="label">
                <span className="label-text font-medium">Level</span>
              </div>
              <select
                className="select select-bordered"
                value={levelFilter}
                onChange={(event) => setLevelFilter(event.target.value as LogLevel | 'ALL')}
              >
                {levelOptions.map((level) => (
                  <option key={level} value={level}>
                    {level === 'ALL' ? 'All levels' : level}
                  </option>
                ))}
              </select>
            </label>

            <label className="form-control w-full">
              <div className="label">
                <span className="label-text font-medium">Search</span>
              </div>
              <input
                type="search"
                className="input input-bordered w-full"
                placeholder="Filter by target or message"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
          </div>

          <div className="text-sm text-base-content/70">
            Showing {visibleLogs.length} of {data.length} buffered log entries.
          </div>
        </div>
      </div>

      {visibleLogs.length === 0 ? (
        <div className="card bg-base-200 shadow-xl">
          <div className="card-body text-base-content/70">
            <p>No matching log entries.</p>
            <p>Errors such as failed routine checks will appear here once the server emits them.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {visibleLogs.map((entry, index) => (
            <div key={`${entry.timestamp}-${entry.target}-${index}`} className="card bg-base-200 shadow-xl">
              <div className="card-body gap-3">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`badge ${levelBadgeClass[entry.level]}`}>{entry.level}</span>
                    <span className="font-mono text-sm break-all">{entry.target}</span>
                  </div>
                  <div className="text-sm text-base-content/60">{formatTimestamp(entry.timestamp)}</div>
                </div>

                <pre className="whitespace-pre-wrap break-words rounded-lg bg-base-300 p-4 text-sm leading-6">
                  {entry.message}
                </pre>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}