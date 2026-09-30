import { Lightbulb, Radio, Layers3 } from 'lucide-react';
import type { FloorplanLayers } from '@/lib/floorplan-labels';
import { Button } from '@/ui/primitives/button';

/** The same independent switches for visible layers and their labels. */
export function FloorplanLayerToggles({
  label,
  value,
  onChange,
}: {
  label: string;
  value: FloorplanLayers;
  onChange: (value: FloorplanLayers) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <div
        role="group"
        aria-label={label}
        className="flex gap-1 rounded-xl border border-border bg-muted/30 p-1"
      >
        {(
          [
            { key: 'lights', title: 'Lights', Icon: Lightbulb },
            { key: 'sensors', title: 'Sensors', Icon: Radio },
            { key: 'groups', title: 'Groups', Icon: Layers3 },
          ] as const
        ).map(({ key, title, Icon }) => (
          <Button
            key={key}
            size="sm"
            variant={value[key] ? 'secondary' : 'ghost'}
            className="min-h-11 min-w-0 flex-1 flex-col gap-1 px-1 text-xs"
            aria-pressed={value[key]}
            onClick={() => onChange({ ...value, [key]: !value[key] })}
          >
            <Icon className="size-4" />
            {title}
          </Button>
        ))}
      </div>
    </div>
  );
}
