import { Component, useState, type ReactNode } from 'react';
import {
  Check,
  Clock,
  CloudSun,
  Code2,
  Home,
  Image,
  LayoutDashboard,
  Link2,
  Monitor,
  Palette,
  SlidersHorizontal,
  StickyNote,
  Thermometer,
  Timer,
  TrainFront,
  TrendingUp,
  Waves,
  Smartphone,
} from 'lucide-react';
import {
  widgetRegistry,
  type WidgetType,
  type DashboardWidget,
} from '@/hooks/useDashboard';
import { DashboardWidgetCard } from '@/ui/DashboardWidgetCard';
import { Button } from '@/ui/primitives/button';
import { Input } from '@/ui/primitives/input';
import { cn } from '@/lib/cn';

const icons = {
  timers: Timer,
  rooms: Home,
  scenes: Palette,
  indoor_climate: Thermometer,
  home_overview: LayoutDashboard,
  clock: Clock,
  weather: CloudSun,
  sensors: Waves,
  controls: SlidersHorizontal,
  helper_mode: SlidersHorizontal,
  spot_price: TrendingUp,
  train_schedule: TrainFront,
  text: StickyNote,
  link: Link2,
  iframe: Monitor,
  image: Image,
  custom: Code2,
};
const categories: Record<string, WidgetType[]> = {
  Home: [
    'rooms',
    'scenes',
    'indoor_climate',
    'controls',
    'timers',
    'helper_mode',
    'home_overview',
  ],
  Information: ['clock', 'weather', 'sensors', 'spot_price', 'train_schedule'],
  Personalize: ['text', 'image', 'link', 'iframe', 'custom'],
};

export function WidgetTypeGallery({
  value,
  onChange,
}: {
  value: WidgetType;
  onChange: (type: WidgetType) => void;
}) {
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const types = (
    category === 'All' ? Object.values(categories).flat() : categories[category]
  ).filter((type) =>
    `${widgetRegistry[type].name} ${widgetRegistry[type].description}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="space-y-3">
      <Input
        aria-label="Find a widget"
        placeholder="Find a widget…"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className="flex flex-wrap gap-1" aria-label="Widget categories">
        {['All', ...Object.keys(categories)].map((name) => (
          <Button
            key={name}
            variant={category === name ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={category === name}
            onClick={() => setCategory(name)}
          >
            {name}
          </Button>
        ))}
      </div>
      <div
        className="grid max-h-96 gap-2 overflow-y-auto p-1 sm:grid-cols-2"
        role="group"
        aria-label="Widget type"
      >
        {types.map((type) => {
          const Icon = icons[type];
          return (
            <button
              type="button"
              key={type}
              aria-pressed={value === type}
              onClick={() => onChange(type)}
              className={cn(
                'flex min-h-24 items-start gap-3 rounded-lg border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ring',
                value === type
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-card hover:bg-muted/50',
              )}
            >
              <span className="rounded-md bg-muted p-2 text-primary">
                <Icon className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {widgetRegistry[type].name}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                  {widgetRegistry[type].description}
                </span>
              </span>
              {value === type && (
                <Check className="size-4 shrink-0 text-primary" />
              )}
            </button>
          );
        })}
      </div>
      {types.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No widgets match this search.
        </p>
      )}
    </div>
  );
}

const sizes = [
  { label: 'Compact', width: 2, height: 2 },
  { label: 'Standard', width: 4, height: 3 },
  { label: 'Wide', width: 8, height: 3 },
  { label: 'Tall', width: 4, height: 5 },
];

class PreviewBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        This widget could not be previewed. Your draft is kept; check its
        content and data source.
      </p>
    ) : (
      this.props.children
    );
  }
}
export function WidgetSizePresets({
  width,
  height,
  onChange,
}: {
  width: number;
  height: number;
  onChange: (width: number, height: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {sizes.map((size) => (
          <button
            type="button"
            key={size.label}
            aria-pressed={width === size.width && height === size.height}
            onClick={() => onChange(size.width, size.height)}
            className={cn(
              'flex min-h-24 flex-col items-center justify-center gap-2 rounded-lg border p-3 text-xs focus-visible:outline-2 focus-visible:outline-ring',
              width === size.width && height === size.height
                ? 'border-primary bg-primary/5'
                : 'border-border hover:bg-muted',
            )}
          >
            <span className="flex h-10 w-16 items-center justify-center">
              <span
                className="rounded-sm border border-primary bg-primary/15"
                style={{ width: size.width * 7, height: size.height * 7 }}
              />
            </span>
            {size.label}
          </button>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { label: 'Desktop · 8 columns', columns: 8 },
          { label: 'Phone · 4 columns', columns: 4 },
        ].map(({ label, columns }) => (
          <div key={label}>
            <p className="mb-1 text-xs text-muted-foreground">{label}</p>
            <div
              className="grid h-7 gap-1"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(0,1fr))`,
              }}
              aria-label={`${Math.min(width, columns)} of ${columns} columns`}
            >
              {Array.from({ length: columns }, (_, index) => (
                <span
                  key={index}
                  className={cn(
                    'rounded-sm border',
                    index < width
                      ? 'border-primary/30 bg-primary/20'
                      : 'border-border bg-muted/30',
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WidgetDraftPreview({ widget }: { widget: DashboardWidget }) {
  const [phone, setPhone] = useState(false);
  // Real dashboard components, isolated from pointer and keyboard commands.
  // Widget effects only fetch readings; creation and device commands remain in handlers.
  const safeWidth = Number.isFinite(widget.width)
    ? Math.max(0.25, widget.width)
    : 2;
  const safeHeight = Number.isFinite(widget.height)
    ? Math.max(0.25, widget.height)
    : 2;
  const width = phone ? Math.min(safeWidth, 4) : Math.min(safeWidth, 8);
  const previewWidth = Math.max(120, width * (phone ? 85 : 112));
  return (
    <section
      id="widget-preview"
      className="settings-section xl:sticky xl:top-4"
      aria-label="Widget preview"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">Preview</h2>
        <div className="flex gap-1">
          <Button
            size="sm"
            variant={phone ? 'ghost' : 'secondary'}
            aria-pressed={!phone}
            onClick={() => setPhone(false)}
          >
            <Monitor className="size-4" />
            Desktop
          </Button>
          <Button
            size="sm"
            variant={phone ? 'secondary' : 'ghost'}
            aria-pressed={phone}
            onClick={() => setPhone(true)}
          >
            <Smartphone className="size-4" />
            Phone
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Your draft with current data. Controls are disabled here.
        {widget.widget_type === 'iframe' &&
          ' Embedded pages are shown without scripts in this preview.'}
      </p>
      <div className="overflow-auto rounded-lg border border-dashed border-border bg-muted/40 p-3">
        <div
          inert
          className="mx-auto pointer-events-none"
          style={{
            width: previewWidth,
            maxWidth: '100%',
            height: Math.max(120, Math.min(safeHeight, 8) * 90),
          }}
        >
          <PreviewBoundary
            key={JSON.stringify([widget.widget_type, widget.options])}
          >
            <DashboardWidgetCard widget={widget} preview />
          </PreviewBoundary>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {widgetRegistry[widget.widget_type].name} ·{' '}
        {Number.isFinite(widget.width) ? widget.width : '—'} ×{' '}
        {Number.isFinite(widget.height) ? widget.height : '—'} cells. Preview
        fits this panel; available dashboard space determines the final size.
        Private source overrides take effect after saving.
      </p>
    </section>
  );
}
