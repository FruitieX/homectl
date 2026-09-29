import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/ui/primitives/button';
export function ReferenceSelect({
  value,
  options,
  onChange,
  label,
  href,
  allowEmpty = true,
  ...props
}: {
  value: string;
  options: { id: string; name: string }[];
  onChange: (value: string) => void;
  label: string;
  href?: string;
  allowEmpty?: boolean;
  'data-field'?: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1">
      <select
        aria-label={label}
        className="settings-select min-w-0 flex-1"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...props}
      >
        {allowEmpty && <option value="">Choose…</option>}
        {value && !options.some((option) => option.id === value) && (
          <option value={value}>{value} · Missing</option>
        )}
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
      {href && value && (
        <Button
          asChild
          size="icon"
          variant="ghost"
          className="shrink-0"
          aria-label={`Open ${options.find((option) => option.id === value)?.name ?? value}`}
        >
          <Link to={href}>
            <ExternalLink className="size-3.5" />
          </Link>
        </Button>
      )}
    </div>
  );
}
