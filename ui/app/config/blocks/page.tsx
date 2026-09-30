import { Link, useSearchParams } from 'react-router-dom';
import { Plus, ChevronRight } from 'lucide-react';
import { useBlocks } from '@/hooks/useConfig';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ConfigPageHeader } from '../page-header';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
export default function BlocksPage() {
  const api = useBlocks();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const visible = api.data.filter((b) =>
    `${b.name} ${b.id} ${b.description} ${b.kind}`
      .toLowerCase()
      .includes(q.toLowerCase()),
  );
  return (
    <div className="mx-auto max-w-[1600px] space-y-4">
      <ConfigPageHeader
        title="Blocks"
        description="Named conditions and actions you can reuse with different inputs."
        actions={
          <Button asChild>
            <Link to="/config/blocks/new">
              <Plus className="size-4" />
              Add block
            </Link>
          </Button>
        }
      />
      <ConfigListSearchBar
        value={q}
        onChange={(q) => {
          const next = new URLSearchParams(params);
          if (q) next.set('q', q);
          else next.delete('q');
          setParams(next, { replace: true });
        }}
        totalCount={api.data.length}
        filteredCount={visible.length}
        placeholder="Search blocks"
      />
      {api.error ? (
        <p role="alert">
          {api.error}
          <Button variant="outline" onClick={() => void api.refetch()}>
            Retry
          </Button>
        </p>
      ) : api.loading ? (
        <Skeleton className="h-40" />
      ) : !visible.length ? (
        <EmptyState
          title={api.data.length ? 'No matching blocks' : 'No blocks yet'}
          description="Create an action or condition once, then use it in several routines."
        />
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-card">
          {visible.map((block) => (
            <Link
              key={block.id}
              to={`/config/blocks/${encodeURIComponent(block.id)}`}
              className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/40"
            >
              <div className="min-w-0 flex-1">
                <strong className="block truncate text-sm">{block.name}</strong>
                <span className="text-xs text-muted-foreground">
                  {block.kind === 'action' ? 'Action' : 'Condition'} ·{' '}
                  {Object.keys(block.inputs).length} inputs
                  {block.description ? ` · ${block.description}` : ''}
                </span>
              </div>
              <ChevronRight className="size-4" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
