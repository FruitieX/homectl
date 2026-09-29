import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/ui/primitives/button';
import { SearchablePicker } from '@/ui/SearchablePicker';
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
    <div className="flex min-w-0 items-start gap-1">
      <div className="min-w-0 flex-1" {...props}>
        <SearchablePicker
          ariaLabel={label}
          value={value}
          onChange={onChange}
          clearable={allowEmpty}
          options={options.map((option) => ({
            value: option.id,
            label: option.name,
          }))}
        />
      </div>
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
