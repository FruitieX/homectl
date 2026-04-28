import { useState } from 'react';

import {
  type Integration,
  type IntegrationConfigFieldSchema,
  type IntegrationConfigSchema,
  useIntegrationConfigSchemas,
  useIntegrations,
} from '@/hooks/useConfig';
import { matchesConfigSearch } from '@/lib/configSearch';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { ConfigPageHeader } from '../page-header';
import {
  ConfigField,
  ConfigFormActions,
  ConfigFormSection,
  ConfigHelpPanel,
  ConfigReadOnlyGrid,
  ConfigReadOnlyItem,
  ConfigToggleRow,
} from '@/ui/config-form';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Slider } from '@/ui/primitives/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Textarea } from '@/ui/primitives/textarea';

const fallbackPluginOptions = [
  'mqtt',
  'circadian',
  'cron',
  'timer',
  'dummy',
  'random',
];
const selectClassName =
  'h-11 rounded-xl border border-input bg-background px-3 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const checkboxClassName =
  'size-4 shrink-0 rounded border border-input bg-background accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const enabledBadgeClassName =
  'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
const disabledBadgeClassName =
  'border-transparent bg-destructive/15 text-destructive dark:text-red-300';
const outboundMinIntervalPath = 'outbound_device_updates.min_interval_ms';
const unsetSelectValue = '__unset__';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getConfigPathValue(config: Record<string, unknown>, path: string) {
  let current: unknown = config;

  for (const segment of path.split('.')) {
    if (!isJsonObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function setConfigPathValue(
  config: Record<string, unknown>,
  path: string,
  value: unknown,
) {
  const segments = path.split('.');
  const nextConfig = { ...config };

  setPathValue(nextConfig, segments, value);

  return nextConfig;
}

function setPathValue(
  target: Record<string, unknown>,
  segments: string[],
  value: unknown,
) {
  const [segment, ...remainingSegments] = segments;

  if (!segment) {
    return;
  }

  if (remainingSegments.length === 0) {
    if (value === undefined) {
      delete target[segment];
      return;
    }

    target[segment] = value;
    return;
  }

  const existingChild = target[segment];
  const nextChild = isJsonObject(existingChild) ? { ...existingChild } : {};
  setPathValue(nextChild, remainingSegments, value);

  if (Object.keys(nextChild).length === 0) {
    delete target[segment];
    return;
  }

  target[segment] = nextChild;
}

function getOutboundMinIntervalMs(config: Record<string, unknown>) {
  const minIntervalMs = getConfigPathValue(config, outboundMinIntervalPath);

  return typeof minIntervalMs === 'number' && Number.isFinite(minIntervalMs)
    ? Math.max(0, Math.round(minIntervalMs))
    : undefined;
}

function parseNumberInput(value: string, field: IntegrationConfigFieldSchema) {
  const trimmed = value.trim();

  if (!trimmed) {
    return undefined;
  }

  const parsed = Number(trimmed);

  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  let nextValue = parsed;

  if (typeof field.min === 'number') {
    nextValue = Math.max(field.min, nextValue);
  }

  if (typeof field.max === 'number') {
    nextValue = Math.min(field.max, nextValue);
  }

  return nextValue;
}

function stringifyOptionValue(value: unknown) {
  return JSON.stringify(value);
}

type ColorConfigValue =
  | { mode: 'hs'; h: number; s: number }
  | { mode: 'rgb'; r: number; g: number; b: number }
  | { mode: 'ct'; ct: number }
  | { mode: 'xy'; x: number; y: number };

type RgbColor = { r: number; g: number; b: number };

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundTo(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function readFiniteNumber(value: Record<string, unknown>, key: string) {
  const numberValue = value[key];
  return typeof numberValue === 'number' && Number.isFinite(numberValue)
    ? numberValue
    : undefined;
}

function parseColorConfigValue(value: unknown): ColorConfigValue | undefined {
  if (!isJsonObject(value)) {
    return undefined;
  }

  const h = readFiniteNumber(value, 'h');
  const s = readFiniteNumber(value, 's');
  if (h !== undefined && s !== undefined) {
    return {
      mode: 'hs',
      h: Math.round(clampNumber(h, 0, 360)),
      s: roundTo(clampNumber(s, 0, 1), 3),
    };
  }

  const r = readFiniteNumber(value, 'r');
  const g = readFiniteNumber(value, 'g');
  const b = readFiniteNumber(value, 'b');
  if (r !== undefined && g !== undefined && b !== undefined) {
    return {
      mode: 'rgb',
      r: Math.round(clampNumber(r, 0, 255)),
      g: Math.round(clampNumber(g, 0, 255)),
      b: Math.round(clampNumber(b, 0, 255)),
    };
  }

  const ct = readFiniteNumber(value, 'ct');
  if (ct !== undefined) {
    return { mode: 'ct', ct: Math.round(clampNumber(ct, 1000, 10000)) };
  }

  const x = readFiniteNumber(value, 'x');
  const y = readFiniteNumber(value, 'y');
  if (x !== undefined && y !== undefined) {
    return {
      mode: 'xy',
      x: roundTo(clampNumber(x, 0, 1), 4),
      y: roundTo(clampNumber(y, 0, 1), 4),
    };
  }

  return undefined;
}

function colorConfigToJson(value: ColorConfigValue) {
  if (value.mode === 'hs') {
    return { h: value.h, s: value.s };
  }

  if (value.mode === 'rgb') {
    return { r: value.r, g: value.g, b: value.b };
  }

  if (value.mode === 'ct') {
    return { ct: value.ct };
  }

  return { x: value.x, y: value.y };
}

function hsToRgb(h: number, s: number): RgbColor {
  const normalizedHue = ((h % 360) + 360) % 360;
  const chroma = s;
  const x = chroma * (1 - Math.abs(((normalizedHue / 60) % 2) - 1));
  const m = 1 - chroma;
  let red = 0;
  let green = 0;
  let blue = 0;

  if (normalizedHue < 60) {
    red = chroma;
    green = x;
  } else if (normalizedHue < 120) {
    red = x;
    green = chroma;
  } else if (normalizedHue < 180) {
    green = chroma;
    blue = x;
  } else if (normalizedHue < 240) {
    green = x;
    blue = chroma;
  } else if (normalizedHue < 300) {
    red = x;
    blue = chroma;
  } else {
    red = chroma;
    blue = x;
  }

  return {
    r: Math.round((red + m) * 255),
    g: Math.round((green + m) * 255),
    b: Math.round((blue + m) * 255),
  };
}

function rgbToHs({
  r,
  g,
  b,
}: RgbColor): Extract<ColorConfigValue, { mode: 'hs' }> {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  let hue = 0;

  if (delta !== 0) {
    if (max === red) {
      hue = 60 * (((green - blue) / delta) % 6);
    } else if (max === green) {
      hue = 60 * ((blue - red) / delta + 2);
    } else {
      hue = 60 * ((red - green) / delta + 4);
    }
  }

  return {
    mode: 'hs',
    h: Math.round((hue + 360) % 360),
    s: max === 0 ? 0 : roundTo(delta / max, 3),
  };
}

function numberToHex(value: number) {
  return Math.round(clampNumber(value, 0, 255))
    .toString(16)
    .padStart(2, '0');
}

function rgbToHex(color: RgbColor) {
  return `#${numberToHex(color.r)}${numberToHex(color.g)}${numberToHex(color.b)}`;
}

function hexToRgb(hex: string): RgbColor | undefined {
  if (!/^#[\da-f]{6}$/i.test(hex)) {
    return undefined;
  }

  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function colorTemperatureToRgb(ct: number): RgbColor {
  const temperature = clampNumber(ct, 1000, 40000) / 100;
  const red =
    temperature <= 66
      ? 255
      : 329.698727446 * (temperature - 60) ** -0.1332047592;
  const green =
    temperature <= 66
      ? 99.4708025861 * Math.log(temperature) - 161.1195681661
      : 288.1221695283 * (temperature - 60) ** -0.0755148492;
  const blue =
    temperature >= 66
      ? 255
      : temperature <= 19
        ? 0
        : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307;

  return {
    r: Math.round(clampNumber(red, 0, 255)),
    g: Math.round(clampNumber(green, 0, 255)),
    b: Math.round(clampNumber(blue, 0, 255)),
  };
}

function xyToRgb(x: number, y: number): RgbColor {
  if (y <= 0) {
    return { r: 255, g: 255, b: 255 };
  }

  const luminance = 1;
  const bigX = (luminance / y) * x;
  const bigZ = (luminance / y) * (1 - x - y);
  const linearRed = bigX * 3.2406 - luminance * 1.5372 - bigZ * 0.4986;
  const linearGreen = -bigX * 0.9689 + luminance * 1.8758 + bigZ * 0.0415;
  const linearBlue = bigX * 0.0557 - luminance * 0.204 + bigZ * 1.057;
  const applyGamma = (channel: number) =>
    channel <= 0.0031308
      ? 12.92 * channel
      : 1.055 * channel ** (1 / 2.4) - 0.055;

  return {
    r: Math.round(clampNumber(applyGamma(linearRed) * 255, 0, 255)),
    g: Math.round(clampNumber(applyGamma(linearGreen) * 255, 0, 255)),
    b: Math.round(clampNumber(applyGamma(linearBlue) * 255, 0, 255)),
  };
}

function colorConfigToRgb(value: ColorConfigValue): RgbColor {
  if (value.mode === 'hs') {
    return hsToRgb(value.h, value.s);
  }

  if (value.mode === 'rgb') {
    return { r: value.r, g: value.g, b: value.b };
  }

  if (value.mode === 'ct') {
    return colorTemperatureToRgb(value.ct);
  }

  return xyToRgb(value.x, value.y);
}

function convertColorMode(
  value: ColorConfigValue,
  mode: ColorConfigValue['mode'],
): ColorConfigValue {
  if (value.mode === mode) {
    return value;
  }

  if (mode === 'rgb') {
    return { mode, ...colorConfigToRgb(value) };
  }

  if (mode === 'hs') {
    return rgbToHs(colorConfigToRgb(value));
  }

  if (mode === 'ct') {
    return { mode, ct: 2700 };
  }

  return { mode, x: 0.5, y: 0.5 };
}

const getIntegrationSearchValues = (integration: Integration) => [
  integration.id,
  integration.plugin,
  integration.enabled ? 'enabled' : 'disabled',
  integration.config,
];

export default function IntegrationsPage() {
  const {
    data: integrations,
    loading,
    error,
    create,
    update,
    remove,
  } = useIntegrations();
  const {
    data: integrationSchemas,
    loading: schemasLoading,
    error: schemasError,
  } = useIntegrationConfigSchemas();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const editingIntegration = integrations.find(
    (integration) => integration.id === editingId,
  );
  const visibleIntegrations = integrations.filter((integration) =>
    matchesConfigSearch(search, ...getIntegrationSearchValues(integration)),
  );

  if (loading || schemasLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Skeleton className="size-12 rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Error loading integrations: {error}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Integrations"
        description="Connect plugins, schedules, and virtual devices to the runtime."
        actions={
          <Button onClick={() => setShowCreate(true)}>Add Integration</Button>
        }
      />

      <ConfigListSearchBar
        filteredCount={visibleIntegrations.length}
        onChange={setSearch}
        placeholder="Search by id, plugin, or config"
        totalCount={integrations.length}
        value={search}
      />

      {visibleIntegrations.length === 0 ? (
        <EmptyState
          title="No integrations match the current search"
          description="Try a different plugin name, id, or configuration value."
        />
      ) : (
        <div className="grid gap-4">
          {visibleIntegrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              onEdit={() => setEditingId(integration.id)}
              onDelete={async () => {
                if (confirm(`Delete integration "${integration.id}"?`)) {
                  await remove(integration.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <IntegrationOverlay
          mode="create"
          schemas={integrationSchemas}
          schemasError={schemasError}
          onClose={() => setShowCreate(false)}
          onSubmit={async (integration) => {
            await create(integration);
            setShowCreate(false);
          }}
        />
      )}

      {editingIntegration && (
        <IntegrationOverlay
          mode="edit"
          integration={editingIntegration}
          schemas={integrationSchemas}
          schemasError={schemasError}
          onClose={() => setEditingId(null)}
          onSubmit={async (integration) => {
            await update(editingIntegration.id, integration);
            setEditingId(null);
          }}
        />
      )}
    </div>
  );
}

function IntegrationCard({
  integration,
  onEdit,
  onDelete,
}: {
  integration: Integration;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const outboundMinIntervalMs = getOutboundMinIntervalMs(integration.config);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{integration.id}</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge variant="secondary">{integration.plugin}</Badge>
              <Badge
                className={
                  integration.enabled
                    ? enabledBadgeClassName
                    : disabledBadgeClassName
                }
              >
                {integration.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
              {outboundMinIntervalMs ? (
                <Badge variant="outline">
                  Pacing {outboundMinIntervalMs} ms
                </Badge>
              ) : null}
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onEdit}>
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
            >
              Delete
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <details className="rounded-2xl border border-border bg-muted/30">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Configuration
          </summary>
          <pre className="max-h-72 overflow-auto border-t border-border px-4 py-3 text-xs">
            {JSON.stringify(integration.config, null, 2)}
          </pre>
        </details>
      </CardContent>
    </Card>
  );
}

function IntegrationConfigFieldsEditor({
  schema,
  schemaError,
  config,
  onConfigChange,
}: {
  schema?: IntegrationConfigSchema;
  schemaError: string | null;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}) {
  if (schemaError) {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          Error loading integration field metadata: {schemaError}
        </AlertDescription>
      </Alert>
    );
  }

  if (!schema) {
    return (
      <ConfigFormSection
        title="Plugin settings"
        description="Select a plugin to see its available configuration fields. Use the JSON tab for unknown or advanced settings."
        className="bg-muted/20"
      />
    );
  }

  return (
    <ConfigFormSection
      title={`${schema.name} settings`}
      description={`${schema.description} Unknown fields are preserved and can be edited from the JSON tab.`}
      className="bg-muted/20"
    >
      <div className="space-y-4">
        {schema.fields.map((field) => (
          <SchemaConfigField
            key={field.key}
            field={field}
            config={config}
            onConfigChange={onConfigChange}
          />
        ))}
      </div>
    </ConfigFormSection>
  );
}

function SchemaConfigField({
  field,
  config,
  onConfigChange,
}: {
  field: IntegrationConfigFieldSchema;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
}) {
  const value = getConfigPathValue(config, field.key);
  const fieldDescription = field.required
    ? `${field.description ?? ''} Required.`.trim()
    : field.description;
  const updateValue = (nextValue: unknown) => {
    onConfigChange(setConfigPathValue(config, field.key, nextValue));
  };

  if (field.kind === 'color') {
    return (
      <div className="space-y-2">
        <div className="grid gap-2">
          <span className="text-sm font-medium leading-none text-foreground">
            {field.label}
          </span>
          {fieldDescription ? (
            <span className="text-xs leading-5 text-muted-foreground">
              {fieldDescription}
            </span>
          ) : null}
          <ColorConfigField
            field={field}
            value={value}
            onChange={updateValue}
          />
        </div>
        {field.help_text ? (
          <ConfigHelpPanel>{field.help_text}</ConfigHelpPanel>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <ConfigField label={field.label} description={fieldDescription}>
        {renderSchemaInput(field, value, updateValue)}
      </ConfigField>
      {field.help_text ? (
        <ConfigHelpPanel>{field.help_text}</ConfigHelpPanel>
      ) : null}
    </div>
  );
}

function renderSchemaInput(
  field: IntegrationConfigFieldSchema,
  value: unknown,
  onChange: (value: unknown) => void,
) {
  if (field.kind === 'number') {
    return (
      <Input
        type="number"
        min={field.min ?? undefined}
        max={field.max ?? undefined}
        step={field.step ?? undefined}
        value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
        placeholder={field.placeholder ?? undefined}
        onChange={(event) => {
          const nextValue = parseNumberInput(event.target.value, field);
          const valueToStore =
            field.key === outboundMinIntervalPath && nextValue !== undefined
              ? nextValue > 0
                ? nextValue
                : undefined
              : nextValue;
          onChange(valueToStore);
        }}
      />
    );
  }

  if (field.kind === 'boolean') {
    return renderBooleanInput(field, value, onChange);
  }

  if (field.kind === 'select') {
    return renderSelectInput(field, value, onChange);
  }

  if (field.kind === 'color') {
    return <ColorConfigField field={field} value={value} onChange={onChange} />;
  }

  if (field.kind === 'json') {
    return (
      <JsonConfigField
        key={`${field.key}:${formatJsonValue(value)}`}
        field={field}
        value={value}
        onChange={onChange}
      />
    );
  }

  const textValue = typeof value === 'string' ? value : '';
  return (
    <Input
      type={field.kind === 'password' ? 'password' : 'text'}
      value={textValue}
      placeholder={field.placeholder ?? undefined}
      onChange={(event) => {
        const nextValue = event.target.value;
        const valueToStore =
          nextValue.length > 0 || field.required ? nextValue : undefined;
        onChange(valueToStore);
      }}
    />
  );
}

function renderBooleanInput(
  field: IntegrationConfigFieldSchema,
  value: unknown,
  onChange: (value: unknown) => void,
) {
  if (field.required) {
    return (
      <input
        type="checkbox"
        className={checkboxClassName}
        checked={value === true}
        onChange={(event) => onChange(event.target.checked)}
      />
    );
  }

  const selectedValue =
    typeof value === 'boolean' ? String(value) : unsetSelectValue;

  return (
    <select
      className={selectClassName}
      value={selectedValue}
      onChange={(event) => {
        if (event.target.value === unsetSelectValue) {
          onChange(undefined);
          return;
        }

        onChange(event.target.value === 'true');
      }}
    >
      <option value={unsetSelectValue}>Unset</option>
      <option value="true">Enabled</option>
      <option value="false">Disabled</option>
    </select>
  );
}

function renderSelectInput(
  field: IntegrationConfigFieldSchema,
  value: unknown,
  onChange: (value: unknown) => void,
) {
  const options = field.options ?? [];
  const selectedValue =
    value === undefined ? unsetSelectValue : stringifyOptionValue(value);

  return (
    <select
      className={selectClassName}
      value={selectedValue}
      onChange={(event) => {
        if (event.target.value === unsetSelectValue) {
          onChange(undefined);
          return;
        }

        const selectedOption = options.find(
          (option) => stringifyOptionValue(option.value) === event.target.value,
        );

        if (selectedOption) {
          onChange(selectedOption.value);
        }
      }}
    >
      {field.required ? (
        <option value={unsetSelectValue} disabled>
          Select...
        </option>
      ) : (
        <option value={unsetSelectValue}>Unset</option>
      )}
      {options.map((option) => (
        <option
          key={stringifyOptionValue(option.value)}
          value={stringifyOptionValue(option.value)}
        >
          {option.label}
        </option>
      ))}
    </select>
  );
}

function ColorConfigField({
  field,
  value,
  onChange,
}: {
  field: IntegrationConfigFieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const fallbackColor = parseColorConfigValue(field.default_value) ?? {
    mode: 'hs',
    h: 30,
    s: 0.5,
  };
  const color = parseColorConfigValue(value) ?? fallbackColor;
  const colorHex = rgbToHex(colorConfigToRgb(color));
  const updateColor = (nextColor: ColorConfigValue) => {
    onChange(colorConfigToJson(nextColor));
  };

  return (
    <div className="space-y-3 rounded-2xl border border-border bg-muted/20 p-3">
      <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(8rem,auto)] sm:items-center">
        <div
          className="size-11 rounded-xl border border-border shadow-inner"
          style={{ backgroundColor: colorHex }}
          aria-label={`Selected color ${colorHex}`}
        />
        {color.mode === 'hs' || color.mode === 'rgb' ? (
          <Input
            type="color"
            value={colorHex}
            onChange={(event) => {
              const rgb = hexToRgb(event.target.value);
              if (!rgb) {
                return;
              }

              updateColor(
                color.mode === 'hs' ? rgbToHs(rgb) : { mode: 'rgb', ...rgb },
              );
            }}
          />
        ) : (
          <div className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
            Preview {colorHex}
          </div>
        )}
        <select
          className={selectClassName}
          value={color.mode}
          onChange={(event) => {
            const mode = parseColorMode(event.target.value);
            if (mode) {
              updateColor(convertColorMode(color, mode));
            }
          }}
        >
          <option value="hs">Hue / saturation</option>
          <option value="rgb">RGB</option>
          <option value="ct">Color temperature</option>
          <option value="xy">XY</option>
        </select>
      </div>

      {renderColorModeInputs(color, updateColor)}

      {value === undefined && field.default_value ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => updateColor(fallbackColor)}
        >
          Use example color
        </Button>
      ) : null}
      {!field.required && value !== undefined ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={() => onChange(undefined)}
        >
          Clear color
        </Button>
      ) : null}
    </div>
  );
}

function parseColorMode(value: string): ColorConfigValue['mode'] | undefined {
  if (value === 'hs' || value === 'rgb' || value === 'ct' || value === 'xy') {
    return value;
  }

  return undefined;
}

function renderColorModeInputs(
  color: ColorConfigValue,
  onChange: (value: ColorConfigValue) => void,
) {
  if (color.mode === 'hs') {
    return (
      <div className="grid gap-3 sm:grid-cols-2">
        <ColorSliderInput
          label="Hue"
          value={color.h}
          min={0}
          max={360}
          step={1}
          formatValue={(h) => `${Math.round(h)}°`}
          onChange={(h) => onChange({ ...color, h: Math.round(h) })}
        />
        <ColorSliderInput
          label="Saturation"
          value={color.s}
          min={0}
          max={1}
          step={0.01}
          formatValue={(s) => `${Math.round(s * 100)}%`}
          onChange={(s) => onChange({ ...color, s: roundTo(s, 3) })}
        />
      </div>
    );
  }

  if (color.mode === 'rgb') {
    return (
      <div className="grid gap-3 sm:grid-cols-3">
        <ColorSliderInput
          label="Red"
          value={color.r}
          min={0}
          max={255}
          step={1}
          formatValue={(r) => String(Math.round(r))}
          onChange={(r) => onChange({ ...color, r: Math.round(r) })}
        />
        <ColorSliderInput
          label="Green"
          value={color.g}
          min={0}
          max={255}
          step={1}
          formatValue={(g) => String(Math.round(g))}
          onChange={(g) => onChange({ ...color, g: Math.round(g) })}
        />
        <ColorSliderInput
          label="Blue"
          value={color.b}
          min={0}
          max={255}
          step={1}
          formatValue={(b) => String(Math.round(b))}
          onChange={(b) => onChange({ ...color, b: Math.round(b) })}
        />
      </div>
    );
  }

  if (color.mode === 'ct') {
    return (
      <ColorSliderInput
        label="Color temperature"
        value={color.ct}
        min={1000}
        max={10000}
        step={50}
        formatValue={(ct) => `${Math.round(ct)} K`}
        onChange={(ct) => onChange({ ...color, ct: Math.round(ct) })}
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <ColorSliderInput
        label="X"
        value={color.x}
        min={0}
        max={1}
        step={0.0001}
        formatValue={(x) => roundTo(x, 4).toFixed(4)}
        onChange={(x) => onChange({ ...color, x: roundTo(x, 4) })}
      />
      <ColorSliderInput
        label="Y"
        value={color.y}
        min={0}
        max={1}
        step={0.0001}
        formatValue={(y) => roundTo(y, 4).toFixed(4)}
        onChange={(y) => onChange({ ...color, y: roundTo(y, 4) })}
      />
    </div>
  );
}

function ColorSliderInput({
  label,
  value,
  min,
  max,
  step,
  formatValue,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue?: (value: number) => string;
  onChange: (value: number) => void;
}) {
  const displayValue = formatValue ? formatValue(value) : String(value);

  return (
    <div className="space-y-2 rounded-xl border border-border bg-background/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-muted-foreground">
          {label}
        </span>
        <span className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-foreground">
          {displayValue}
        </span>
      </div>
      <Slider
        aria-label={label}
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(values) => {
          const [nextValue] = values;
          if (typeof nextValue === 'number' && Number.isFinite(nextValue)) {
            onChange(clampNumber(nextValue, min, max));
          }
        }}
      />
    </div>
  );
}

function JsonConfigField({
  field,
  value,
  onChange,
}: {
  field: IntegrationConfigFieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const [text, setText] = useState(formatJsonValue(value));
  const [error, setError] = useState<string | null>(null);
  const placeholder =
    field.default_value !== undefined && field.default_value !== null
      ? formatJsonValue(field.default_value)
      : (field.placeholder ?? undefined);

  const applyText = () => {
    const trimmed = text.trim();

    if (!trimmed && !field.required) {
      setError(null);
      onChange(undefined);
      return;
    }

    if (!trimmed) {
      setError('A JSON value is required.');
      return;
    }

    const parsed = parseJsonText(trimmed);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    setError(null);
    onChange(parsed.value);
  };

  return (
    <div className="space-y-2">
      <Textarea
        className="min-h-28 font-mono text-sm"
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={applyText}
      />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function formatJsonValue(value: unknown) {
  if (value === undefined) {
    return '';
  }

  const text = JSON.stringify(value, null, 2);
  return text ?? '';
}

type JsonParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

function parseJsonText(text: string): JsonParseResult {
  let value: unknown;

  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid JSON',
    };
  }

  return { ok: true, value };
}

function parseConfigJsonText(text: string) {
  const parsed = parseJsonText(text);

  if (!parsed.ok || !isJsonObject(parsed.value)) {
    return undefined;
  }

  return parsed.value;
}

function requiredFieldMissing(
  config: Record<string, unknown>,
  field: IntegrationConfigFieldSchema,
) {
  if (!field.required) {
    return false;
  }

  const value = getConfigPathValue(config, field.key);

  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (field.kind === 'number') {
    return typeof value !== 'number' || !Number.isFinite(value);
  }

  if (field.kind === 'boolean') {
    return typeof value !== 'boolean';
  }

  if (field.kind === 'color') {
    return parseColorConfigValue(value) === undefined;
  }

  return false;
}

function missingRequiredFieldLabels(
  schema: IntegrationConfigSchema | undefined,
  config: Record<string, unknown> | undefined,
) {
  if (!schema || !config) {
    return [];
  }

  return schema.fields
    .filter((field) => requiredFieldMissing(config, field))
    .map((field) => field.label);
}

function IntegrationOverlay({
  mode,
  integration,
  schemas,
  schemasError,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  integration?: Integration;
  schemas: IntegrationConfigSchema[];
  schemasError: string | null;
  onClose: () => void;
  onSubmit: (integration: Partial<Integration>) => Promise<void>;
}) {
  const [id, setId] = useState(integration?.id ?? '');
  const [plugin, setPlugin] = useState(integration?.plugin ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(
    integration?.config ?? {},
  );
  const [enabled, setEnabled] = useState(integration?.enabled ?? true);
  const [editTab, setEditTab] = useState<'settings' | 'json'>('settings');
  const [jsonText, setJsonText] = useState(
    JSON.stringify(integration?.config ?? {}, null, 2),
  );
  const isCreate = mode === 'create';
  const selectedSchema = schemas.find((schema) => schema.plugin === plugin);
  const pluginOptions =
    schemas.length > 0
      ? schemas.map((schema) => schema.plugin)
      : fallbackPluginOptions;
  const validationConfig =
    editTab === 'json' ? parseConfigJsonText(jsonText) : config;
  const missingFields = missingRequiredFieldLabels(
    selectedSchema,
    validationConfig,
  );
  const canSubmit = Boolean(id && plugin && missingFields.length === 0);

  const changeTab = (value: string) => {
    if (value === 'json') {
      setJsonText(JSON.stringify(config, null, 2));
      setEditTab('json');
      return;
    }

    if (editTab === 'json') {
      const parsedConfig = parseConfigJsonText(jsonText);
      if (!parsedConfig) {
        alert('Invalid JSON - fix before leaving the JSON tab');
        return;
      }

      setConfig(parsedConfig);
    }

    if (value === 'settings') {
      setEditTab(value);
    }
  };

  const submit = () => {
    let effectiveConfig = config;

    if (editTab === 'json') {
      const parsedConfig = parseConfigJsonText(jsonText);
      if (!parsedConfig) {
        alert('Invalid JSON in configuration');
        return;
      }

      effectiveConfig = parsedConfig;
    }

    const missingRequiredFields = missingRequiredFieldLabels(
      selectedSchema,
      effectiveConfig,
    );
    if (missingRequiredFields.length > 0) {
      alert(`Missing required fields: ${missingRequiredFields.join(', ')}`);
      return;
    }

    void onSubmit({
      id,
      plugin,
      config: effectiveConfig,
      enabled,
    });
  };

  return (
    <ResponsiveOverlay
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      title={isCreate ? 'Add Integration' : `Edit ${integration?.id ?? id}`}
      description={
        isCreate
          ? 'Create a new integration instance and initial plugin config.'
          : 'Adjust whether the integration is enabled and update plugin configuration.'
      }
      presentation="fullscreen"
      className="max-w-2xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <Tabs value={editTab} onValueChange={changeTab}>
          <TabsList className="grid h-auto w-full grid-cols-2">
            <TabsTrigger value="settings">Settings</TabsTrigger>
            <TabsTrigger value="json">JSON</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="mt-4 space-y-4">
            <ConfigFormSection
              title="Integration identity"
              description="Pick a stable id and plugin type. Existing integration ids and plugins are read-only to avoid breaking references."
            >
              {isCreate ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <ConfigField label="Integration ID">
                    <Input
                      value={id}
                      onChange={(event) => setId(event.target.value)}
                      placeholder="e.g. my-mqtt"
                    />
                  </ConfigField>

                  <ConfigField label="Plugin">
                    <select
                      className={selectClassName}
                      value={plugin}
                      onChange={(event) => setPlugin(event.target.value)}
                    >
                      <option value="">Select plugin...</option>
                      {pluginOptions.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  </ConfigField>
                </div>
              ) : (
                <ConfigReadOnlyGrid>
                  <ConfigReadOnlyItem
                    label="Integration ID"
                    value={integration?.id}
                  />
                  <ConfigReadOnlyItem
                    label="Plugin"
                    value={integration?.plugin}
                  />
                </ConfigReadOnlyGrid>
              )}

              <ConfigToggleRow
                label="Enabled"
                description="Disabled integrations stay in configuration but will not be started by the runtime."
              >
                <input
                  type="checkbox"
                  className={checkboxClassName}
                  checked={enabled}
                  onChange={(event) => setEnabled(event.target.checked)}
                />
              </ConfigToggleRow>
            </ConfigFormSection>

            <IntegrationConfigFieldsEditor
              schema={selectedSchema}
              schemaError={schemasError}
              config={config}
              onConfigChange={setConfig}
            />

            {missingFields.length > 0 ? (
              <Alert variant="destructive">
                <AlertDescription>
                  Missing required fields: {missingFields.join(', ')}
                </AlertDescription>
              </Alert>
            ) : null}
          </TabsContent>

          <TabsContent value="json" className="mt-4">
            <ConfigFormSection
              title="Advanced JSON"
              description="Use this for unknown or advanced plugin settings. Values edited here are preserved when returning to Settings."
            >
              <Textarea
                className="h-96 font-mono text-sm"
                value={jsonText}
                onChange={(event) => setJsonText(event.target.value)}
              />
            </ConfigFormSection>
          </TabsContent>
        </Tabs>

        <ConfigFormActions>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canSubmit} onClick={submit}>
            {isCreate ? 'Create' : 'Save'}
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
