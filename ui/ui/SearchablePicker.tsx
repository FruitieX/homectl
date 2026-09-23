import { useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Button } from '@/ui/primitives/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/ui/primitives/popover';
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/ui/primitives/command';

export type PickerOption = { value: string; label: string; detail?: string };

export function SearchablePicker({
  options,
  value,
  onChange,
  placeholder = 'Choose…',
  ariaLabel,
  disabled = false,
  clearable = true,
}: {
  options: PickerOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  clearable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel ?? placeholder}
          disabled={disabled}
          className="h-auto min-h-11 w-full justify-between gap-2 text-left font-normal"
        >
          <span className="min-w-0 truncate">
            {selected?.label ??
              (value ? `${value} (unavailable)` : placeholder)}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command>
          <CommandInput autoFocus placeholder="Search by name or ID…" />
          <CommandList>
            <CommandEmpty>No matches. Check the name or ID.</CommandEmpty>
            {value && clearable && (
              <CommandItem
                value="clear selection"
                onSelect={() => {
                  onChange('');
                  setOpen(false);
                }}
              >
                Clear selection
              </CommandItem>
            )}
            {options.map((option) => (
              <CommandItem
                key={option.value}
                value={`${option.label} ${option.value} ${option.detail ?? ''}`}
                onSelect={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <Check
                  className={`size-4 shrink-0 ${value === option.value ? 'opacity-100' : 'opacity-0'}`}
                />
                <span className="min-w-0">
                  <span className="block truncate">{option.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.detail ?? option.value}
                  </span>
                </span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function SearchableMultiPicker({
  options,
  value,
  onChange,
  placeholder = 'Add items…',
}: {
  options: PickerOption[];
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const selected = value.map(
    (key) =>
      options.find((option) => option.value === key) ?? {
        value: key,
        label: `${key} (unavailable)`,
      },
  );
  return (
    <div className="space-y-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((option) => (
            <span
              key={option.value}
              className="inline-flex max-w-full items-center gap-1 rounded-lg border border-border bg-muted/40 px-2 py-1 text-sm"
            >
              <span className="truncate">{option.label}</span>
              <button
                type="button"
                aria-label={`Remove ${option.label}`}
                className="rounded p-0.5 hover:bg-muted"
                onClick={() =>
                  onChange(value.filter((key) => key !== option.value))
                }
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <SearchablePicker
        options={options.filter((option) => !value.includes(option.value))}
        value=""
        onChange={(key) => {
          if (key) onChange([...value, key]);
        }}
        placeholder={placeholder}
      />
    </div>
  );
}
