import type { ComponentProps } from 'react';
import { cn } from '@/lib/cn';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select';

export function SettingsSelect({
  value,
  onValueChange,
  options,
  placeholder = 'Choose…',
  ...props
}: Omit<ComponentProps<typeof SelectTrigger>, 'value'> & {
  value: string;
  placeholder?: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
}) {
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={props.disabled}
    >
      <SelectTrigger {...props} className={cn('rounded-md', props.className)}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
