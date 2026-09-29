import type { ComponentProps } from 'react';
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
  ...props
}: Omit<ComponentProps<typeof SelectTrigger>, 'value'> & {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select
      value={value}
      onValueChange={onValueChange}
      disabled={props.disabled}
    >
      <SelectTrigger {...props} className="rounded-md">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
