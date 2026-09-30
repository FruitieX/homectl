import { createContext, useContext, type ReactNode } from 'react';
import { Copy, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { ReorderButtons } from '@/ui/settings/ReorderButtons';
import { GitBranch } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
export const RoutineAuthoringContext = createContext<{
  draftKey?: string;
  blockId?: string;
  returnHref?: string;
}>({});
export const useRoutineAuthoring = () => useContext(RoutineAuthoringContext);
export function FlowBlock({
  id,
  title,
  icon,
  className = '',
  children,
  index = 0,
  total = 1,
  onMove,
  onRemove,
  onDuplicate,
}: {
  id?: string;
  title: ReactNode;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
  index?: number;
  total?: number;
  onMove?: (offset: number) => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
}) {
  const { advanced } = useSettingsPreferences();
  return (
    <article
      className={`flow-block focus-visible:outline-2 focus-visible:outline-ring ${className}`}
      data-node-id={id}
      tabIndex={-1}
    >
      <header className="flow-block-heading flex min-w-0 flex-wrap items-center justify-between gap-2">
        <span className="flow-node-icon">
          {icon ?? <GitBranch className="size-4" />}
        </span>
        <div className="min-w-0 flex-1 basis-32 text-sm font-medium">
          {title}
          {advanced && id && (
            <p
              className="mt-1 truncate font-mono text-[10px] font-normal text-muted-foreground"
              title={id}
            >
              {id}
            </p>
          )}
        </div>
        <div className="flow-node-actions ml-auto flex items-center">
          {onMove && (
            <ReorderButtons
              label={id ?? 'condition'}
              index={index}
              total={total}
              onMove={onMove}
            />
          )}
          {(onRemove || onDuplicate) && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0 rounded-md md:size-8"
                  aria-label={`Actions for ${id ?? 'condition'}`}
                >
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onDuplicate && (
                  <DropdownMenuItem onSelect={onDuplicate}>
                    <Copy className="size-4" />
                    Duplicate
                  </DropdownMenuItem>
                )}
                {onRemove && (
                  <DropdownMenuItem
                    className="text-destructive"
                    onSelect={onRemove}
                  >
                    <Trash2 className="size-4" />
                    Remove
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      {children}
    </article>
  );
}
export function AddFlowBlock<T extends string>({
  label,
  options,
  onAdd,
}: {
  label: string;
  options: { value: T; label: string }[];
  onAdd: (kind: T) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="flow-add w-full justify-center border-dashed"
        >
          <Plus className="size-4" />
          {label}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-[60dvh] overflow-auto"
      >
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onSelect={() => onAdd(option.value)}
          >
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
export function UnknownFlowValue({ value }: { value: unknown }) {
  return (
    <div className="space-y-2 text-xs">
      <p className="text-amber-700">
        This definition uses a format this editor cannot change. Its saved
        values are preserved.
      </p>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
