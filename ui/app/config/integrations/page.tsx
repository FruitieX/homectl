import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import {
  type Integration,
  type IntegrationConfigFieldSchema,
  type IntegrationConfigSchema,
  useIntegrationConfigSchemas,
  useIntegrations,
} from '@/hooks/useConfig';
import { useCreateDeepLink, useSearchParamState } from '@/hooks/useDeepLink';
import { useDevicesState } from '@/hooks/websocket';
import { matchesConfigSearch } from '@/lib/configSearch';
import { ConfigListSearchBar } from '@/ui/ConfigListSearchBar';
import { SearchablePicker } from '@/ui/SearchablePicker';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
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
import { toast } from 'sonner';

import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { Button } from '@/ui/primitives/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/ui/primitives/card';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Input } from '@/ui/primitives/input';
import { ResponsiveOverlay } from '@/ui/primitives/responsive-overlay';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Slider } from '@/ui/primitives/slider';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Textarea } from '@/ui/primitives/textarea';
import { selectClassNameLarge as selectClassName } from '@/ui/form-styles';
import { checkboxClassName } from '@/ui/form-styles';

export const fallbackPluginOptions = [
  'mqtt',
  'circadian',
  'cron',
  'timer',
  'dummy',
  'random',
];
export const enabledBadgeClassName =
  'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
export const disabledBadgeClassName =
  'border-transparent bg-destructive/15 text-destructive dark:text-red-300';
const outboundMinIntervalPath = 'outbound_device_updates.min_interval_ms';
const unsetSelectValue = '__unset__';

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getConfigPathValue(
  config: Record<string, unknown>,
  path: string,
) {
  let current: unknown = config;

  for (const segment of path.split('.')) {
    if (!isJsonObject(current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

export function configFieldIsVisible(
  config: Record<string, unknown>,
  field: IntegrationConfigFieldSchema,
) {
  const condition = field.visible_when;
  if (!condition) {
    return true;
  }

  return (
    JSON.stringify(getConfigPathValue(config, condition.key)) ===
    JSON.stringify(condition.equals)
  );
}

function fieldPlaceholder(field: IntegrationConfigFieldSchema) {
  if (field.placeholder) {
    return field.placeholder;
  }

  const defaultValue = field.default_value;
  if (
    typeof defaultValue === 'string' ||
    typeof defaultValue === 'number' ||
    typeof defaultValue === 'boolean'
  ) {
    return String(defaultValue);
  }

  return undefined;
}

export function initialIntegrationConfig(
  plugin: string,
  config: Record<string, unknown>,
) {
  const nextConfig = { ...config };
  if (plugin === 'mqtt' && typeof nextConfig.mode !== 'string') {
    nextConfig.mode =
      typeof nextConfig.zigbee2mqtt_base_topic === 'string' &&
      nextConfig.zigbee2mqtt_base_topic.trim().length > 0
        ? 'zigbee2mqtt'
        : 'generic';
  }
  return nextConfig;
}

function sanitizeHiddenConditionalFields(
  schema: IntegrationConfigSchema | undefined,
  config: Record<string, unknown>,
) {
  if (!schema) {
    return config;
  }

  return schema.fields.reduce((nextConfig, field) => {
    if (field.visible_when && !configFieldIsVisible(config, field)) {
      return setConfigPathValue(nextConfig, field.key, undefined);
    }
    return nextConfig;
  }, config);
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

const starterPlugins = [
  {
    id: 'mqtt',
    label: 'Connect smart devices',
    fallback: 'Use MQTT to bring devices into your home.',
  },
  {
    id: 'dummy',
    label: 'Try sample devices',
    fallback: 'Explore the app without physical hardware.',
  },
  {
    id: 'circadian',
    label: 'Follow daylight',
    fallback: 'Adjust light color through the day.',
  },
  {
    id: 'cron',
    label: 'Add a schedule',
    fallback: 'Run actions at a chosen time.',
  },
] as const;

function getFieldFormatHint(field: IntegrationConfigFieldSchema) {
  if (field.key === 'day_fade_start' || field.key === 'night_fade_start') {
    return 'Format: HH:MM in local time, for example 06:00.';
  }

  if (field.key === 'schedules') {
    return 'Cron schedules use second, minute, hour, day-of-month, month, and day-of-week fields.';
  }

  if (field.key.endsWith('_field') || field.key.endsWith('_fields')) {
    return 'Use JSON pointer syntax such as /state/power or /temperature.';
  }

  if (field.kind === 'json' && field.default_value !== undefined) {
    return 'Start from the example JSON if you are unsure about the expected shape.';
  }

  return null;
}

function buildFieldDescription(field: IntegrationConfigFieldSchema) {
  const parts = [field.description, getFieldFormatHint(field)];
  if (field.required) {
    parts.push('Required.');
  }

  return parts.filter(Boolean).join(' ');
}

function IntegrationGettingStarted({
  schemas,
  onSelectPlugin,
}: {
  schemas: IntegrationConfigSchema[];
  onSelectPlugin?: (plugin: string) => void;
}) {
  const schemaByPlugin = Object.fromEntries(
    schemas.map((schema) => [schema.plugin, schema]),
  );

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle>Choose how to begin</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm text-muted-foreground">
        <p>
          Start with a connection or a built-in service. You can add more later.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {starterPlugins.map((plugin) => {
            const schema = schemaByPlugin[plugin.id];
            return (
              <button
                key={plugin.id}
                type="button"
                className="rounded-2xl border border-border bg-background/80 p-3 text-left transition hover:border-primary/50 hover:bg-background"
                onClick={() => onSelectPlugin?.(plugin.id)}
              >
                <div className="font-medium text-foreground">
                  {plugin.label}
                </div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">
                  {schema?.description ?? plugin.fallback}
                </div>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default function IntegrationsPage() {
  const {
    data: integrations,
    loading,
    error,
    refetch,
    create,
    update,
    remove,
  } = useIntegrations();
  const {
    data: integrationSchemas,
    loading: schemasLoading,
    error: schemasError,
  } = useIntegrationConfigSchemas();
  const [search, setSearch] = useSearchParamState();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  useCreateDeepLink(useCallback(() => setShowCreate(true), []));
  const [createPlugin, setCreatePlugin] = useState<string | null>(null);
  // “Is anything offline?” answered from the data that exists: which devices
  // have stopped reporting, grouped by the connection they belong to.
  const devices = useDevicesState();
  const connectionHealth = useMemo(() => {
    const map = new Map<
      string,
      {
        total: number;
        notReporting: Array<{
          key: string;
          label: string;
          lastReport?: number;
        }>;
      }
    >();
    for (const [key, device] of Object.entries(devices ?? {})) {
      const [integrationId] = key.split('/');
      if (!integrationId) continue;
      const entry = map.get(integrationId) ?? {
        total: 0,
        notReporting: [],
      };
      entry.total += 1;
      const controllable =
        'Controllable' in device.data ? device.data.Controllable : undefined;
      const availability = controllable?.availability;
      if (availability && availability.online === false) {
        entry.notReporting.push({
          key,
          label: device.name || (key.split('/')[1] ?? key),
          lastReport:
            (
              availability as {
                observed_at_ms?: number;
                last_report_ms?: number;
              }
            ).observed_at_ms ??
            (availability as { last_report_ms?: number }).last_report_ms,
        });
      }
      map.set(integrationId, entry);
    }
    return map;
  }, [devices]);
  const visibleIntegrations = integrations.filter((integration) =>
    matchesConfigSearch(search, ...getIntegrationSearchValues(integration)),
  );
  useAssistantPageContext({ kind: 'integration' });

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
        <AlertDescription className="space-y-3">
          <p>Could not load connections: {error}</p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <ConfigPageHeader
        title="Connections & services"
        description="Bring devices into your home and set up schedules or virtual services."
        actions={
          <Button
            onClick={() => {
              setCreatePlugin(null);
              setShowCreate(true);
            }}
          >
            Add connection
          </Button>
        }
      />

      {integrations.length === 0 ? (
        <IntegrationGettingStarted
          schemas={integrationSchemas}
          onSelectPlugin={(plugin) => {
            setCreatePlugin(plugin);
            setShowCreate(true);
          }}
        />
      ) : null}

      {integrations.length > 0 ? (
        <ConfigListSearchBar
          filteredCount={visibleIntegrations.length}
          onChange={setSearch}
          placeholder="Search connections and services"
          totalCount={integrations.length}
          value={search}
        />
      ) : null}

      {integrations.length === 0 ? null : visibleIntegrations.length === 0 ? (
        <EmptyState
          title="No integrations match the current search"
          description="Try a different plugin name, id, or configuration value."
          action={
            <Button variant="outline" size="sm" onClick={() => setSearch('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4">
          {visibleIntegrations.map((integration) => (
            <IntegrationCard
              key={integration.id}
              integration={integration}
              health={connectionHealth.get(integration.id)}
              onOpen={() =>
                void navigate(
                  `/config/integrations/${encodeURIComponent(integration.id)}`,
                )
              }
            />
          ))}
        </div>
      )}

      {showCreate && (
        <IntegrationOverlay
          initialPlugin={createPlugin ?? undefined}
          schemas={integrationSchemas}
          schemasError={schemasError}
          onClose={() => {
            setShowCreate(false);
            setCreatePlugin(null);
          }}
          onSubmit={async (integration) => {
            await create(integration);
            setShowCreate(false);
            setCreatePlugin(null);
          }}
        />
      )}
    </div>
  );
}

function IntegrationCard({
  integration,
  onOpen,
  health,
}: {
  integration: Integration;
  onOpen: () => void;
  /** Devices on this connection and how many stopped reporting. */
  health?: {
    total: number;
    notReporting: Array<{ key: string; label: string; lastReport?: number }>;
  };
}) {
  return (
    <Card
      role="button"
      tabIndex={0}
      aria-label={`Edit connection ${integration.id}`}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="cursor-pointer rounded-2xl border-border/70 shadow-sm transition hover:border-primary/40 hover:bg-accent/30 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <CardHeader>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>{integration.id}</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              {integration.plugin === integration.id ? null : (
                <Badge variant="secondary">{integration.plugin}</Badge>
              )}
              <Badge
                title="Enabled means homectl is configured to use this connection. It does not say whether the connection is reachable right now."
                aria-label={
                  integration.enabled
                    ? 'Enabled in configuration'
                    : 'Disabled in configuration'
                }
                className={
                  integration.enabled
                    ? enabledBadgeClassName
                    : disabledBadgeClassName
                }
              >
                {integration.enabled ? 'Enabled' : 'Disabled'}
              </Badge>
            </div>
            {health ? (
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {health.total === 0
                  ? 'No devices from this connection yet.'
                  : `${health.total} device${health.total === 1 ? '' : 's'}`}
                {health.notReporting.length > 0 ? (
                  <>
                    {' · '}
                    <Link
                      className="font-medium text-amber-600 underline-offset-4 hover:underline dark:text-amber-400"
                      to={
                        health.notReporting.length === 1
                          ? `/config/devices/detail?key=${encodeURIComponent(health.notReporting[0].key)}`
                          : `/config/devices?q=${encodeURIComponent(integration.id)}`
                      }
                      onClick={(event) => event.stopPropagation()}
                    >
                      {health.notReporting.length === 1
                        ? `${health.notReporting[0].label} stopped reporting${describeLastReport(health.notReporting[0].lastReport)}`
                        : `${health.notReporting.length} devices stopped reporting`}
                    </Link>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </div>
      </CardHeader>
    </Card>
  );
}

export function describeLastReport(observedAtMs?: number): string {
  if (!observedAtMs) return '';
  const minutes = Math.max(0, Math.round((Date.now() - observedAtMs) / 60000));
  if (minutes < 1) return ' (last report just now)';
  if (minutes < 60) return ` (last report ${minutes} min ago)`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return ` (last report ${hours} h ago)`;
  return ` (last report ${Math.round(hours / 24)} d ago)`;
}

export function IntegrationConfigFieldsEditor({
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

  const visibleFields = schema.fields.filter((field) =>
    configFieldIsVisible(config, field),
  );
  const normalFields = visibleFields.filter((field) => !field.advanced);
  const advancedFields = visibleFields.filter((field) => field.advanced);
  const renderFieldGroups = (fields: IntegrationConfigFieldSchema[]) => {
    const groups = new Map<string, IntegrationConfigFieldSchema[]>();
    for (const field of fields) {
      const section = field.section ?? 'Settings';
      const group = groups.get(section) ?? [];
      group.push(field);
      groups.set(section, group);
    }

    return [...groups.entries()].map(([section, sectionFields]) => (
      <ConfigFormSection
        key={section}
        title={section}
        className="bg-background/70"
      >
        <div className="space-y-4">
          {sectionFields.map((field) => (
            <SchemaConfigField
              key={field.key}
              field={field}
              config={config}
              validationError={mqttProfileFieldError(config, field.key)}
              onConfigChange={onConfigChange}
            />
          ))}
        </div>
      </ConfigFormSection>
    ));
  };

  return (
    <div className="space-y-4">
      <p className="px-1 text-sm leading-6 text-muted-foreground">
        {schema.description} Unknown fields are preserved in the JSON editor.
      </p>
      {renderFieldGroups(normalFields)}
      {advancedFields.length > 0 ? (
        <details className="group rounded-3xl border border-border bg-muted/20 p-4 shadow-sm sm:p-5">
          <summary className="cursor-pointer list-none text-sm font-semibold text-foreground [&::-webkit-details-marker]:hidden">
            <span className="mr-2 inline-block transition-transform group-open:rotate-90">
              ▸
            </span>
            Advanced settings
            <span className="ml-2 text-xs font-normal normal-case tracking-normal text-muted-foreground">
              {advancedFields.length} fields
            </span>
          </summary>
          <div className="mt-4 space-y-4">
            {renderFieldGroups(advancedFields)}
          </div>
        </details>
      ) : null}
    </div>
  );
}

export function SchemaConfigField({
  field,
  config,
  validationError,
  onConfigChange,
}: {
  field: IntegrationConfigFieldSchema;
  config: Record<string, unknown>;
  validationError?: string | null;
  onConfigChange: (config: Record<string, unknown>) => void;
}) {
  const value = getConfigPathValue(config, field.key);
  const fieldDescription = buildFieldDescription(field);
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
        {validationError ? (
          <span className="text-sm text-destructive">{validationError}</span>
        ) : null}
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
        placeholder={fieldPlaceholder(field)}
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

  if (field.kind === 'password') {
    return (
      <div className="space-y-2">
        <Input
          type="password"
          value={textValue}
          placeholder={
            value === undefined
              ? 'Stored key stays as it is; type only to replace it'
              : fieldPlaceholder(field)
          }
          onChange={(event) => {
            // An empty password box never means deletion: leaving it empty
            // keeps whatever the server already holds.
            if (event.target.value === '') {
              return;
            }
            onChange(event.target.value);
          }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              void confirmDestructive(
                'Clear the stored key?',
                'The configuration will no longer carry a value for this field, and the connection may stop working until you set a new one.',
                'Clear stored key',
              ).then((confirmed) => {
                if (confirmed) {
                  onChange('');
                }
              })
            }
          >
            Clear stored key
          </Button>
          <span className="text-xs text-muted-foreground">
            Removing the key is deliberate: an empty box above leaves it alone.
          </span>
        </div>
      </div>
    );
  }

  return (
    <Input
      type="text"
      value={textValue}
      placeholder={fieldPlaceholder(field)}
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
  const selectedOption = options.find(
    (option) => stringifyOptionValue(option.value) === selectedValue,
  );

  return (
    <div className="grid gap-1.5">
      <SearchablePicker
        options={options.map((option) => ({
          value: stringifyOptionValue(option.value),
          label: option.label,
          detail: option.description || undefined,
        }))}
        value={selectedValue === unsetSelectValue ? '' : selectedValue}
        clearable={!field.required}
        placeholder={field.required ? 'Choose an option…' : 'Unset'}
        onChange={(next) => {
          if (!next) {
            onChange(undefined);
            return;
          }
          const nextOption = options.find(
            (option) => stringifyOptionValue(option.value) === next,
          );
          if (nextOption) onChange(nextOption.value);
        }}
      />
      {selectedOption?.description ? (
        <span className="text-xs leading-5 text-muted-foreground">
          {selectedOption.description}
        </span>
      ) : null}
    </div>
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
  const hasExample =
    field.default_value !== undefined && field.default_value !== null;
  const placeholder = hasExample
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

  const useExample = () => {
    if (!hasExample) {
      return;
    }

    const nextText = formatJsonValue(field.default_value);
    setText(nextText);
    setError(null);
    onChange(field.default_value);
  };

  const clearValue = () => {
    setText('');
    setError(null);
    onChange(undefined);
  };

  return (
    <div className="space-y-2">
      <Textarea
        className="min-h-14 max-h-52 resize-y font-mono text-sm"
        rows={2}
        value={text}
        placeholder={placeholder}
        onChange={(event) => setText(event.target.value)}
        onBlur={applyText}
      />
      <div className="flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={applyText}
        >
          Apply JSON
        </Button>
        {hasExample ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={useExample}
          >
            Use example
          </Button>
        ) : null}
        {!field.required && text.trim() ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-destructive hover:text-destructive"
            onClick={clearValue}
          >
            Clear
          </Button>
        ) : null}
      </div>
      {hasExample ? (
        <p className="text-[11px] leading-4 text-muted-foreground">
          Placeholder/example only; it is not saved unless you apply or enter
          it.
        </p>
      ) : null}
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function formatJsonValue(value: unknown) {
  if (value === undefined) {
    return '';
  }

  const compact = JSON.stringify(value);
  if (!compact) {
    return '';
  }
  return compact.length <= 80
    ? compact
    : (JSON.stringify(value, null, 2) ?? '');
}

type JsonParseResult =
  { ok: true; value: unknown } | { ok: false; error: string };

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

export function parseConfigJsonText(text: string) {
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
  if (!field.required || !configFieldIsVisible(config, field)) {
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

export function missingRequiredFieldLabels(
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

export function mqttProfileValidationError(config: Record<string, unknown>) {
  const mode = config.mode;
  if (mode !== 'esphome') {
    return null;
  }

  const base = config.esphome_base_topic;
  if (base !== undefined && (typeof base !== 'string' || !base.trim())) {
    return 'ESPHome base topic must not be empty.';
  }
  const objectId = config.esphome_light_object_id;
  if (
    objectId !== undefined &&
    (typeof objectId !== 'string' ||
      !objectId.trim() ||
      /[\s\/#{}+]/.test(objectId))
  ) {
    return 'ESPHome light object ID must be one valid MQTT topic segment.';
  }

  const discoveryPrefix = config.esphome_discovery_prefix;
  if (
    discoveryPrefix !== undefined &&
    (typeof discoveryPrefix !== 'string' || !discoveryPrefix.trim())
  ) {
    return 'ESPHome discovery prefix must not be empty.';
  }

  const warm = config.esphome_warm_white_kelvin ?? 2700;
  const cold = config.esphome_cold_white_kelvin ?? 6500;
  if (
    typeof warm !== 'number' ||
    !Number.isFinite(warm) ||
    typeof cold !== 'number' ||
    !Number.isFinite(cold) ||
    warm <= 0 ||
    cold <= 0 ||
    warm >= cold
  ) {
    return 'ESPHome warm white must be greater than 0 and lower than cold white.';
  }

  return null;
}

export function mqttProfileFieldError(
  config: Record<string, unknown>,
  fieldKey: string,
) {
  if (config.mode !== 'esphome') {
    return null;
  }

  if (
    fieldKey === 'esphome_base_topic' &&
    config.esphome_base_topic !== undefined &&
    (typeof config.esphome_base_topic !== 'string' ||
      !config.esphome_base_topic.trim())
  ) {
    return 'Base topic must not be empty.';
  }

  if (
    fieldKey === 'esphome_light_object_id' &&
    config.esphome_light_object_id !== undefined &&
    (typeof config.esphome_light_object_id !== 'string' ||
      !config.esphome_light_object_id.trim() ||
      /[\s\/#{}+]/.test(config.esphome_light_object_id))
  ) {
    return 'Use one valid MQTT topic segment.';
  }

  if (
    fieldKey === 'esphome_discovery_prefix' &&
    config.esphome_discovery_prefix !== undefined &&
    (typeof config.esphome_discovery_prefix !== 'string' ||
      !config.esphome_discovery_prefix.trim())
  ) {
    return 'Discovery prefix must not be empty.';
  }

  if (
    fieldKey === 'esphome_warm_white_kelvin' ||
    fieldKey === 'esphome_cold_white_kelvin'
  ) {
    const warm = config.esphome_warm_white_kelvin ?? 2700;
    const cold = config.esphome_cold_white_kelvin ?? 6500;
    if (
      typeof warm !== 'number' ||
      !Number.isFinite(warm) ||
      typeof cold !== 'number' ||
      !Number.isFinite(cold) ||
      warm <= 0 ||
      cold <= 0 ||
      warm >= cold
    ) {
      return 'Warm white must be greater than 0 and lower than cold white.';
    }
  }

  return null;
}

function IntegrationOverlay({
  initialPlugin,
  schemas,
  schemasError,
  onClose,
  onSubmit,
}: {
  initialPlugin?: string;
  schemas: IntegrationConfigSchema[];
  schemasError: string | null;
  onClose: () => void;
  onSubmit: (integration: Partial<Integration>) => Promise<void>;
}) {
  const [id, setId] = useState('');
  const [plugin, setPlugin] = useState(initialPlugin ?? '');
  const [config, setConfig] = useState<Record<string, unknown>>(
    initialIntegrationConfig(initialPlugin ?? '', {}),
  );
  const [enabled, setEnabled] = useState(true);
  const [editTab, setEditTab] = useState<'settings' | 'json'>('settings');
  const [jsonText, setJsonText] = useState('{}');
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
  const profileValidationError =
    plugin === 'mqtt' && validationConfig
      ? mqttProfileValidationError(validationConfig)
      : null;
  const canSubmit = Boolean(
    id &&
    plugin &&
    missingFields.length === 0 &&
    !profileValidationError &&
    (editTab !== 'json' || validationConfig),
  );

  const selectPlugin = (nextPlugin: string) => {
    setPlugin(nextPlugin);
    setConfig((currentConfig) =>
      initialIntegrationConfig(nextPlugin, currentConfig),
    );
  };

  const changeTab = (value: string) => {
    if (value === 'json') {
      setJsonText(JSON.stringify(config, null, 2));
      setEditTab('json');
      return;
    }

    if (editTab === 'json') {
      const parsedConfig = parseConfigJsonText(jsonText);
      if (!parsedConfig) {
        toast.error('Invalid JSON - fix before leaving the JSON tab');
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
        toast.error('Invalid JSON in configuration');
        return;
      }

      effectiveConfig = parsedConfig;
    }

    const missingRequiredFields = missingRequiredFieldLabels(
      selectedSchema,
      effectiveConfig,
    );
    if (missingRequiredFields.length > 0) {
      toast.error(
        `Missing required fields: ${missingRequiredFields.join(', ')}`,
      );
      return;
    }

    const nextProfileValidationError =
      plugin === 'mqtt' ? mqttProfileValidationError(effectiveConfig) : null;
    if (nextProfileValidationError) {
      toast.error(nextProfileValidationError);
      return;
    }

    void onSubmit({
      id,
      plugin,
      config: sanitizeHiddenConditionalFields(selectedSchema, effectiveConfig),
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
      title="Add connection or service"
      description="Choose a type, then enter the details needed to connect it."
      presentation="fullscreen"
      className="max-w-2xl"
    >
      <div className="flex min-h-full flex-col px-5 pb-5 md:px-0 md:pb-0">
        <div className="space-y-3 pb-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{plugin || 'No type chosen'}</span>
            <Badge
              className={
                enabled ? enabledBadgeClassName : disabledBadgeClassName
              }
            >
              {enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            {plugin ? (
              <span className="text-xs text-muted-foreground">
                {enabled
                  ? 'The runtime starts this connection; reachability is reported per device, not here.'
                  : 'Disabled: the runtime does not start this connection.'}
              </span>
            ) : null}
          </div>
        </div>

        <Tabs value={editTab} onValueChange={changeTab}>
          <TabsList className="grid h-auto w-full grid-cols-2">
            <TabsTrigger value="settings">Settings</TabsTrigger>

            <TabsTrigger value="json">Advanced JSON</TabsTrigger>
          </TabsList>

          <TabsContent value="settings" className="mt-4 space-y-4">
            <ConfigFormSection
              title="Connection details"
              description="Choose a type and give this connection a unique id. The id stays fixed after creation so linked devices and automations keep working."
            >
              <>
                <div className="grid gap-4 md:grid-cols-2">
                  <ConfigField label="Connection ID">
                    <Input
                      value={id}
                      onChange={(event) => setId(event.target.value)}
                      placeholder="e.g. my-mqtt"
                    />
                  </ConfigField>

                  <ConfigField label="Type">
                    <SearchablePicker
                      options={pluginOptions.map((option) => ({
                        value: option,
                        label: option,
                      }))}
                      value={plugin}
                      onChange={selectPlugin}
                      placeholder="Select connection type…"
                    />
                  </ConfigField>
                </div>
                <IntegrationGettingStarted
                  schemas={schemas}
                  onSelectPlugin={(nextPlugin) => {
                    selectPlugin(nextPlugin);
                    if (!id) {
                      setId(nextPlugin);
                    }
                  }}
                />
              </>

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
            {profileValidationError ? (
              <Alert variant="destructive">
                <AlertDescription>{profileValidationError}</AlertDescription>
              </Alert>
            ) : null}
          </TabsContent>

          <TabsContent value="json" className="mt-4">
            <ConfigFormSection
              title="Advanced JSON"
              description="Use this for unknown or advanced plugin settings. Values edited here are preserved when returning to Settings."
            >
              <Textarea
                className="min-h-40 max-h-72 resize-y font-mono text-sm"
                rows={8}
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
            Create
          </Button>
        </ConfigFormActions>
      </div>
    </ResponsiveOverlay>
  );
}
