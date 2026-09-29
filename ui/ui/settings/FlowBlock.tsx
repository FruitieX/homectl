import { createContext, useContext, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  MoreHorizontal,
  Plus,
  Trash2,
} from 'lucide-react';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { Button } from '@/ui/primitives/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/primitives/dropdown-menu';
export const RoutineAuthoringContext = createContext<{
  draftKey?: string;
  returnHref?: string;
}>({});
export const useRoutineAuthoring = () => useContext(RoutineAuthoringContext);
export function FlowBlock({
  id,
  title,
  children,
  index = 0,
  total = 1,
  onMove,
  onRemove,
  onDuplicate,
}: {
  id?: string;
  title: ReactNode;
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
      className="flow-block focus-visible:outline-2 focus-visible:outline-ring"
      data-node-id={id}
      tabIndex={-1}
    >
      <header className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0 flex-1 text-sm font-medium">
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
        {(onMove || onRemove || onDuplicate) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label={`Actions for ${id ?? 'condition'}`}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onMove && (
                <>
                  <DropdownMenuItem
                    disabled={index === 0}
                    onSelect={() => onMove(-1)}
                  >
                    <ArrowUp className="size-4" />
                    Move earlier
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={index === total - 1}
                    onSelect={() => onMove(1)}
                  >
                    <ArrowDown className="size-4" />
                    Move later
                  </DropdownMenuItem>
                </>
              )}
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
