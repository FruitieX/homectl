import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Bot,
  Monitor,
  Moon,
  Save,
  Server,
  Sun,
  Trash2,
  Wifi,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { z } from 'zod';

import { useAtom } from 'jotai';

import { useAppConfig } from '@/hooks/appConfig';
import { accentAtom, densityAtom } from '@/hooks/preferences';
import { useTheme, type ThemeMode } from '@/hooks/theme';
import { useBackdropBlurEffects } from '@/hooks/visualEffects';
import { useDeveloperMode } from '@/hooks/developerMode';
import { cn } from '@/lib/cn';
import { accents, densities } from '@/lib/preferences';
import { normalizeBuildInfo } from '@/lib/buildInfo';
import { ConfigPageHeader } from '../page-header';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/ui/primitives/card';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/ui/primitives/form';
import { Input } from '@/ui/primitives/input';
import { Label } from '@/ui/primitives/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/ui/primitives/select';
import { Skeleton } from '@/ui/primitives/skeleton';
import { Switch } from '@/ui/primitives/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { Advanced } from '@/ui/primitives/advanced';

const coreConfigFormSchema = z.object({
  warmupTimeSeconds: z.number().int().min(0).max(60),
  defaultTransitionMs: z.number().int().min(0).max(65535000).nullable(),
  sceneTransitionMs: z.number().int().min(0).max(65535000).nullable(),
});

const coreConfigApiResponseSchema = z
  .object({
    warmupTimeSeconds: z.number().optional(),
    warmup_time_seconds: z.number().optional(),
    defaultTransitionMs: z.number().nullable().optional(),
    default_transition_ms: z.number().nullable().optional(),
    sceneTransitionMs: z.number().nullable().optional(),
    scene_transition_ms: z.number().nullable().optional(),
  })
  .passthrough();

const coreConfigEnvelopeSchema = z.object({
  write: z
    .object({
      applied: z.boolean(),
      persistence: z.enum(['persisted', 'memory_only', 'failed']),
      warning: z.string().nullable(),
    })
    .optional(),
  success: z.boolean(),
  data: coreConfigApiResponseSchema.nullish(),
  error: z.string().nullish(),
});

type CoreConfigFormValues = z.infer<typeof coreConfigFormSchema>;
type CoreConfigApiResponse = z.infer<typeof coreConfigApiResponseSchema>;

const defaultValues: CoreConfigFormValues = {
  warmupTimeSeconds: 1,
  defaultTransitionMs: null,
  sceneTransitionMs: null,
};

const themeOptions: {
  value: ThemeMode;
  label: string;
  icon: ReactNode;
}[] = [
  { value: 'light', label: 'Light', icon: <Sun className="size-5" /> },
  { value: 'dark', label: 'Dark', icon: <Moon className="size-5" /> },
  { value: 'auto', label: 'Auto', icon: <Monitor className="size-5" /> },
];

const buildInfo = normalizeBuildInfo({
  version: import.meta.env.VITE_APP_VERSION,
  gitCommit: import.meta.env.VITE_GIT_COMMIT,
  buildDate: import.meta.env.VITE_BUILD_DATE,
});

function normalizeCoreConfig(
  value: CoreConfigApiResponse | null | undefined,
): CoreConfigFormValues {
  return {
    warmupTimeSeconds:
      value?.warmupTimeSeconds ?? value?.warmup_time_seconds ?? 1,
    defaultTransitionMs:
      value?.defaultTransitionMs ?? value?.default_transition_ms ?? null,
    sceneTransitionMs:
      value?.sceneTransitionMs ?? value?.scene_transition_ms ?? null,
  };
}

async function readCoreConfig(apiEndpoint: string) {
  const response = await fetch(`${apiEndpoint}/api/v1/config/core`);
  const result = coreConfigEnvelopeSchema.parse(await response.json());

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to load settings');
  }

  return normalizeCoreConfig(result.data);
}

async function updateCoreConfig(
  apiEndpoint: string,
  values: CoreConfigFormValues,
) {
  const response = await fetch(`${apiEndpoint}/api/v1/config/core`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      warmup_time_seconds: values.warmupTimeSeconds,
      default_transition_ms: values.defaultTransitionMs,
      scene_transition_ms: values.sceneTransitionMs,
    }),
  });
  const result = coreConfigEnvelopeSchema.parse(await response.json());

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to save settings');
  }

  return { values: normalizeCoreConfig(result.data), write: result.write };
}

export default function SettingsPage() {
  const recordWrite = useRecordConfigWrite();
  const { apiEndpoint, wsEndpoint } = useAppConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const [settingsTab, setSettingsTab] = useState<
    'appearance' | 'core' | 'assistant' | 'info'
  >(() => {
    const tab = searchParams.get('tab');
    return tab === 'core' || tab === 'assistant' || tab === 'info'
      ? tab
      : 'appearance';
  });
  useEffect(() => {
    const tab = searchParams.get('tab');
    setSettingsTab(
      tab === 'core' || tab === 'assistant' || tab === 'info'
        ? tab
        : 'appearance',
    );
  }, [searchParams]);
  const form = useForm<CoreConfigFormValues>({
    resolver: zodResolver(coreConfigFormSchema),
    defaultValues,
  });

  const query = useQuery({
    queryKey: ['config', apiEndpoint, 'core'],
    queryFn: () => readCoreConfig(apiEndpoint),
  });

  const mutation = useMutation({
    mutationFn: (values: CoreConfigFormValues) =>
      updateCoreConfig(apiEndpoint, values),
    onSuccess: ({ values, write }) => {
      form.reset(values);
      recordWrite('Core settings', write);
      if (write?.persistence === 'persisted') toast.success('Settings saved');
      else if (write)
        toast.warning(write.warning ?? 'Settings applied in memory only.');
      else toast.success('Settings applied');
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save settings',
      );
    },
  });

  useEffect(() => {
    if (query.data && !form.formState.isDirty) {
      form.reset(query.data);
    }
  }, [form, query.data, form.formState.isDirty]);

  const onSubmit = (values: CoreConfigFormValues) => {
    mutation.mutate(values);
  };

  const changeSettingsTab = (value: string) => {
    if (
      value === 'appearance' ||
      value === 'core' ||
      value === 'assistant' ||
      value === 'info'
    ) {
      setSettingsTab(value);
      const next = new URLSearchParams(searchParams);
      if (value === 'appearance') next.delete('tab');
      else next.set('tab', value);
      setSearchParams(next, { replace: true });
    }
  };

  const displayApiEndpoint = `${apiEndpoint}/api/v1`;

  return (
    <Form {...form}>
      <div className="max-w-3xl space-y-5">
        <ConfigPageHeader
          title="App & system"
          description="Make the app feel right for you and adjust how your home starts."
        />

        {query.error && query.data && (
          <Alert variant="warning">
            <AlertTitle>Settings may be stale</AlertTitle>
            <AlertDescription>
              {query.error instanceof Error
                ? query.error.message
                : 'Failed to refresh settings'}
            </AlertDescription>
          </Alert>
        )}

        <Tabs value={settingsTab} onValueChange={changeSettingsTab}>
          <TabsList className="grid h-auto w-full grid-cols-2 sm:grid-cols-4">
            <TabsTrigger value="appearance">Appearance</TabsTrigger>
            <TabsTrigger value="core">
              Behavior{form.formState.isDirty ? ' •' : ''}
            </TabsTrigger>
            <TabsTrigger value="assistant">Assistant</TabsTrigger>
            <TabsTrigger value="info">About</TabsTrigger>
          </TabsList>

          <TabsContent value="appearance" className="mt-4">
            <AppearanceSettingsCard />
          </TabsContent>

          <TabsContent value="core" className="mt-4">
            {query.isLoading && !query.data ? (
              <div className="grid gap-4">
                <Skeleton className="h-44" />
              </div>
            ) : query.error && !query.data ? (
              <Alert variant="destructive">
                <AlertTitle>Could not load server settings</AlertTitle>
                <AlertDescription className="mt-2 flex flex-col gap-3">
                  <span>
                    {query.error instanceof Error
                      ? query.error.message
                      : 'Failed to connect to server'}
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void query.refetch()}
                  >
                    Retry
                  </Button>
                </AlertDescription>
              </Alert>
            ) : (
              <form
                id="core-settings-form"
                onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
              >
                <Card>
                  <CardHeader>
                    <CardTitle>Startup & transitions</CardTitle>
                    <CardDescription>
                      Choose when automations begin after startup. Optional
                      transition defaults are below.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FormField
                      control={form.control}
                      name="warmupTimeSeconds"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Wait before automations start (seconds)
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={0}
                              max={60}
                              inputMode="numeric"
                              value={field.value}
                              onBlur={field.onBlur}
                              onChange={(event) =>
                                field.onChange(
                                  Number.isNaN(event.target.valueAsNumber)
                                    ? 0
                                    : event.target.valueAsNumber,
                                )
                              }
                              name={field.name}
                              ref={field.ref}
                            />
                          </FormControl>
                          <FormDescription>
                            The default is 1 second. Increase it if devices are
                            still starting when routines first run.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Advanced
                      label="Transition defaults"
                      summary={
                        form.formState.errors.defaultTransitionMs ||
                        form.formState.errors.sceneTransitionMs
                          ? 'Needs attention'
                          : form.watch('defaultTransitionMs') !== null ||
                              form.watch('sceneTransitionMs') !== null
                            ? 'Customized'
                            : undefined
                      }
                      description="Leave a value empty to use the integration's own behavior. 1000 milliseconds is one second."
                      className="mt-6"
                      openWhen={Boolean(
                        form.formState.errors.defaultTransitionMs ||
                        form.formState.errors.sceneTransitionMs,
                      )}
                    >
                      <FormField
                        control={form.control}
                        name="defaultTransitionMs"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Manual controls (milliseconds)
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                max={65535000}
                                step={1}
                                inputMode="numeric"
                                placeholder="Disabled"
                                value={field.value ?? ''}
                                onBlur={field.onBlur}
                                onChange={(event) =>
                                  field.onChange(
                                    event.target.value === ''
                                      ? null
                                      : Number(event.target.value),
                                  )
                                }
                                name={field.name}
                                ref={field.ref}
                              />
                            </FormControl>
                            <FormDescription>
                              Used for sliders, color wheels, and direct device
                              controls when no explicit transition is requested.
                              Set this to 1000 for one second; leave empty to
                              use integration defaults.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="sceneTransitionMs"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Scenes (milliseconds)</FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                min={0}
                                max={65535000}
                                step={1}
                                inputMode="numeric"
                                placeholder="Use scene/default behavior"
                                value={field.value ?? ''}
                                onBlur={field.onBlur}
                                onChange={(event) =>
                                  field.onChange(
                                    event.target.value === ''
                                      ? null
                                      : Number(event.target.value),
                                  )
                                }
                                name={field.name}
                                ref={field.ref}
                              />
                            </FormControl>
                            <FormDescription>
                              Default transition for scene activations without
                              an explicit or scene-stored transition, including
                              routines and their rollouts. Set this to 1000 for
                              one second; leave empty to use integration
                              defaults.
                            </FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </Advanced>
                    <div className="mt-6 flex justify-end border-t border-border/70 pt-4">
                      <Button
                        type="submit"
                        disabled={!form.formState.isDirty || mutation.isPending}
                      >
                        <Save />
                        {mutation.isPending ? 'Saving…' : 'Save changes'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </form>
            )}
          </TabsContent>

          <TabsContent value="assistant" className="mt-4">
            <AssistantSettingsCard />
          </TabsContent>

          <TabsContent value="info" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>homectl {buildInfo.version}</CardTitle>
                <CardDescription>
                  Built {buildInfo.buildDate}. Report this version when asking
                  about a problem.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <dl className="grid gap-4 text-sm sm:grid-cols-3">
                  <div className="min-w-0 space-y-1">
                    <dt className="text-muted-foreground">Version</dt>
                    <dd className="font-medium text-foreground">
                      {buildInfo.version}
                    </dd>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <dt className="text-muted-foreground">Build date (UTC)</dt>
                    <dd className="break-all font-mono text-xs text-foreground">
                      {buildInfo.buildDate}
                    </dd>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <dt className="text-muted-foreground">Git commit</dt>
                    <dd className="break-all font-mono text-xs text-foreground">
                      {buildInfo.gitCommit}
                    </dd>
                  </div>
                </dl>
                <Advanced
                  label="Server and environment details"
                  description="Runtime endpoints this app talks to, and where the loaded build came from."
                >
                  <div className="space-y-3 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2">
                      <Server className="size-4" />
                      <span className="font-medium text-foreground">
                        API Endpoint:
                      </span>
                      <code className="rounded-md bg-muted px-1.5 py-0.5">
                        {displayApiEndpoint}
                      </code>
                    </p>
                    <p className="flex items-center gap-2">
                      <Wifi className="size-4" />
                      <span className="font-medium text-foreground">
                        WebSocket:
                      </span>
                      <code className="rounded-md bg-muted px-1.5 py-0.5">
                        {wsEndpoint}
                      </code>
                    </p>
                  </div>
                </Advanced>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </Form>
  );
}

function AppearanceSettingsCard() {
  const [themeMode, setThemeMode] = useTheme();
  const [blurEffectsEnabled, setBlurEffectsEnabled] = useBackdropBlurEffects();
  const [accent, setAccent] = useAtom(accentAtom);
  const [density, setDensity] = useAtom(densityAtom);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          Choose a theme or let homectl follow the system preference.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-muted p-1">
            {themeOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={themeMode === option.value ? 'default' : 'ghost'}
                className={cn(
                  'h-16 flex-col rounded-xl text-xs sm:h-11 sm:flex-row sm:text-sm',
                  themeMode === option.value && 'shadow-sm',
                )}
                onClick={() => setThemeMode(option.value)}
              >
                {option.icon}
                <span>{option.label}</span>
              </Button>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            {themeMode === 'auto'
              ? 'Theme follows your system preference.'
              : `Using ${themeMode} theme.`}
          </p>

          <div className="space-y-2 rounded-2xl border border-border bg-muted/30 p-4">
            <div className="space-y-1">
              <span className="block text-sm font-medium text-foreground">
                Accent color
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                Tints primary buttons, focus rings, and charts.
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {accents.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-label={`Use ${option.label} accent`}
                  aria-pressed={accent === option.id}
                  onClick={() => setAccent(option.id)}
                  className={cn(
                    'size-9 rounded-full border-2 transition',
                    accent === option.id
                      ? 'border-foreground'
                      : 'border-transparent hover:border-border',
                  )}
                  style={{ backgroundColor: option.swatch }}
                />
              ))}
            </div>
          </div>

          <div className="space-y-2 rounded-2xl border border-border bg-muted/30 p-4">
            <div className="space-y-1">
              <span className="block text-sm font-medium text-foreground">
                Density
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                Compact fits more rows on screen; comfortable keeps larger touch
                targets.
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 rounded-2xl bg-muted p-1">
              {densities.map((option) => (
                <Button
                  key={option}
                  type="button"
                  variant={density === option ? 'default' : 'ghost'}
                  className={cn(
                    'h-11 rounded-xl',
                    density === option && 'shadow-sm',
                  )}
                  onClick={() => setDensity(option)}
                >
                  {option === 'compact' ? 'Compact' : 'Comfortable'}
                </Button>
              ))}
            </div>
          </div>

          <Advanced
            label="Display performance and troubleshooting"
            summary={blurEffectsEnabled ? undefined : 'Customized'}
          >
            <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-muted/30 p-4">
              <span className="space-y-1">
                <span className="block text-sm font-medium text-foreground">
                  Blur effects
                </span>
                <span className="block text-xs leading-5 text-muted-foreground">
                  Store this setting in this browser only. Disable it on slower
                  dashboard clients to make overlay and sticky-element scrolling
                  cheaper.
                </span>
              </span>
              <Switch
                type="button"
                checked={blurEffectsEnabled}
                onCheckedChange={setBlurEffectsEnabled}
                aria-label="Enable blur effects"
              />
            </div>
            <DeveloperModeSetting />
          </Advanced>
        </div>
      </CardContent>
    </Card>
  );
}

function DeveloperModeSetting() {
  const [developerMode, setDeveloperMode] = useDeveloperMode();

  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-border bg-muted/30 p-4">
      <span className="space-y-1">
        <span className="block text-sm font-medium text-foreground">
          Developer mode
        </span>
        <span className="block text-xs leading-5 text-muted-foreground">
          Show troubleshooting actions in the navigation, such as a manual page
          refresh. This setting is stored in this browser.
        </span>
      </span>
      <Switch
        type="button"
        checked={developerMode}
        onCheckedChange={setDeveloperMode}
        aria-label="Enable developer mode"
      />
    </div>
  );
}

const assistantSettingsSchema = z.object({
  enabled: z.boolean(),
  baseUrl: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  apiKeySet: z.boolean(),
  reasoningEffort: z.enum(['low', 'medium', 'high']).nullable().optional(),
  maxTokens: z.number(),
  timeoutMs: z.number(),
  timezone: z.string().nullable().optional(),
});

const assistantEnvelopeSchema = z.object({
  success: z.boolean(),
  data: assistantSettingsSchema.nullish(),
  error: z.string().nullish(),
  write: z
    .object({
      applied: z.boolean(),
      persistence: z.enum(['persisted', 'memory_only', 'failed']),
      warning: z.string().nullable(),
    })
    .optional(),
});

type AssistantSettings = z.infer<typeof assistantSettingsSchema>;

type AssistantFormState = {
  baseUrl: string;
  model: string;
  apiKey: string;
  reasoningEffort: string;
  maxTokens: string;
  timeoutMs: string;
  timezone: string;
};

function assistantFormFromSettings(
  settings: AssistantSettings | null | undefined,
): AssistantFormState {
  return {
    baseUrl: settings?.baseUrl ?? '',
    model: settings?.model ?? '',
    apiKey: '',
    reasoningEffort: settings?.reasoningEffort ?? '',
    maxTokens: String(settings?.maxTokens ?? 2048),
    timeoutMs: String(settings?.timeoutMs ?? 60000),
    timezone: settings?.timezone ?? '',
  };
}

async function readAssistantSettings(apiEndpoint: string) {
  const response = await fetch(
    `${apiEndpoint}/api/v1/config/assistant/settings`,
  );
  const result = assistantEnvelopeSchema.parse(await response.json());

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to load assistant settings');
  }

  return result.data ?? null;
}

async function updateAssistantSettings(
  apiEndpoint: string,
  form: AssistantFormState,
  includeApiKey: boolean,
) {
  const body: Record<string, unknown> = {
    baseUrl: form.baseUrl,
    model: form.model,
    reasoningEffort: form.reasoningEffort,
    timezone: form.timezone,
  };
  if (form.maxTokens !== '') {
    body.maxTokens = Number(form.maxTokens);
  }
  if (form.timeoutMs !== '') {
    body.timeoutMs = Number(form.timeoutMs);
  }
  if (includeApiKey) {
    body.apiKey = form.apiKey;
  }

  const response = await fetch(
    `${apiEndpoint}/api/v1/config/assistant/settings`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  const result = assistantEnvelopeSchema.parse(await response.json());

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to save assistant settings');
  }

  return { settings: result.data ?? null, write: result.write };
}

function AssistantSettingsCard() {
  const recordWrite = useRecordConfigWrite();
  const { apiEndpoint } = useAppConfig();
  const [form, setForm] = useState<AssistantFormState>(() =>
    assistantFormFromSettings(null),
  );

  const query = useQuery({
    queryKey: ['config', apiEndpoint, 'assistant'],
    queryFn: () => readAssistantSettings(apiEndpoint),
  });

  useEffect(() => {
    if (query.data !== undefined) {
      setForm(assistantFormFromSettings(query.data));
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: () =>
      updateAssistantSettings(apiEndpoint, form, form.apiKey.length > 0),
    onSuccess: ({ settings, write }) => {
      setForm(assistantFormFromSettings(settings));
      recordWrite('Assistant settings', write);
      if (write?.persistence === 'persisted')
        toast.success('Assistant settings saved');
      else if (write) toast.warning(write.warning ?? 'Applied in memory only.');
      else toast.success('Assistant settings applied');
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to save assistant settings',
      );
    },
  });

  const clearKey = useMutation({
    mutationFn: () =>
      updateAssistantSettings(apiEndpoint, { ...form, apiKey: '' }, true),
    onSuccess: ({ settings, write }) => {
      setForm(assistantFormFromSettings(settings));
      recordWrite('Assistant API key', write);
      if (write?.persistence === 'persisted')
        toast.success('Stored API key cleared');
      else if (write) toast.warning(write.warning ?? 'Applied in memory only.');
      else toast.success('Stored API key cleared');
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to clear API key',
      );
    },
  });

  const fieldProps = (key: keyof AssistantFormState) => ({
    value: form[key],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setForm((previous) => ({ ...previous, [key]: event.target.value })),
  });

  const enabled = form.baseUrl.length > 0 && form.model.length > 0;

  const validationError = (() => {
    if (form.baseUrl.trim().length > 0 !== form.model.trim().length > 0) {
      return 'Set both a base URL and a model, or leave both empty to disable the assistant.';
    }
    if (
      form.maxTokens !== '' &&
      (!Number.isFinite(Number(form.maxTokens)) || Number(form.maxTokens) < 1)
    ) {
      return 'Max tokens must be a number of at least 1.';
    }
    if (
      form.timeoutMs !== '' &&
      (!Number.isFinite(Number(form.timeoutMs)) ||
        Number(form.timeoutMs) < 1000)
    ) {
      return 'Timeout must be at least 1000 ms.';
    }
    return null;
  })();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="size-4" />
          Configuration assistant
        </CardTitle>
        <CardDescription>
          Optional help with configuration and device actions. Your provider
          settings are stored on the server; the API key is never sent back.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {query.isLoading && !query.data ? (
          <Skeleton className="h-44" />
        ) : query.error && query.data === undefined ? (
          <Alert variant="destructive">
            <AlertTitle>Could not load assistant settings</AlertTitle>
            <AlertDescription className="mt-2 flex flex-col gap-3">
              <span>
                {query.error instanceof Error
                  ? query.error.message
                  : 'Failed to connect to server'}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void query.refetch()}
              >
                Retry
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              if (!validationError) {
                mutation.mutate();
              }
            }}
          >
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span
                className={cn(
                  'size-2 rounded-full',
                  enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40',
                )}
              />
              {enabled
                ? `Ready to use ${form.model}`
                : 'Off — add a provider URL and model to turn it on.'}
            </p>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="assistant-base-url">Base URL</Label>
                <Input
                  id="assistant-base-url"
                  placeholder="https://opencode.ai/zen/go/v1"
                  {...fieldProps('baseUrl')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assistant-model">Model</Label>
                <Input
                  id="assistant-model"
                  placeholder="deepseek-v4.1-flash"
                  {...fieldProps('model')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="assistant-api-key">API key</Label>
                <Input
                  id="assistant-api-key"
                  type="password"
                  autoComplete="off"
                  placeholder={
                    query.data?.apiKeySet
                      ? 'Stored — leave blank to keep'
                      : 'Optional'
                  }
                  {...fieldProps('apiKey')}
                />
                {query.data?.apiKeySet && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-auto px-0 text-xs text-muted-foreground"
                    disabled={clearKey.isPending}
                    onClick={() => clearKey.mutate()}
                  >
                    <Trash2 className="size-3" />
                    Clear stored key
                  </Button>
                )}
              </div>
            </div>
            <Advanced
              label="Provider options"
              summary={
                validationError !== null &&
                !validationError.startsWith('Set both')
                  ? 'Needs attention'
                  : form.reasoningEffort ||
                      form.timezone ||
                      form.maxTokens !== '2048' ||
                      form.timeoutMs !== '60000'
                    ? 'Customized'
                    : undefined
              }
              description="Use these only if your provider needs different limits, reasoning, or timezone settings."
              openWhen={
                validationError !== null &&
                !validationError.startsWith('Set both')
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="assistant-effort">Reasoning effort</Label>
                  <Select
                    value={form.reasoningEffort || 'default'}
                    onValueChange={(value) =>
                      setForm((previous) => ({
                        ...previous,
                        reasoningEffort: value === 'default' ? '' : value,
                      }))
                    }
                  >
                    <SelectTrigger id="assistant-effort">
                      <SelectValue placeholder="Provider default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Provider default</SelectItem>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assistant-timezone">Timezone</Label>
                  <Input
                    id="assistant-timezone"
                    placeholder="Europe/Helsinki"
                    {...fieldProps('timezone')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assistant-max-tokens">Max tokens</Label>
                  <Input
                    id="assistant-max-tokens"
                    type="number"
                    min={1}
                    inputMode="numeric"
                    {...fieldProps('maxTokens')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="assistant-timeout">Timeout (ms)</Label>
                  <Input
                    id="assistant-timeout"
                    type="number"
                    min={1000}
                    step={1000}
                    inputMode="numeric"
                    {...fieldProps('timeoutMs')}
                  />
                </div>
              </div>
            </Advanced>

            {validationError ? (
              <p className="text-xs text-destructive">{validationError}</p>
            ) : null}

            <Button
              type="submit"
              disabled={
                mutation.isPending ||
                clearKey.isPending ||
                validationError !== null
              }
            >
              <Save />
              {mutation.isPending ? 'Saving…' : 'Save assistant settings'}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
