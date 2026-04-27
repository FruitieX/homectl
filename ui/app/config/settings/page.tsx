import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Save, Server, Wifi } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { useAppConfig } from '@/hooks/appConfig';
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
import { Skeleton } from '@/ui/primitives/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';

const coreConfigFormSchema = z.object({
  warmupTimeSeconds: z.number().int().min(0).max(60),
});

const coreConfigApiResponseSchema = z
  .object({
    warmupTimeSeconds: z.number().optional(),
    warmup_time_seconds: z.number().optional(),
  })
  .passthrough();

const coreConfigEnvelopeSchema = z.object({
  success: z.boolean(),
  data: coreConfigApiResponseSchema.nullish(),
  error: z.string().nullish(),
});

type CoreConfigFormValues = z.infer<typeof coreConfigFormSchema>;
type CoreConfigApiResponse = z.infer<typeof coreConfigApiResponseSchema>;

const defaultValues: CoreConfigFormValues = {
  warmupTimeSeconds: 1,
};

function normalizeCoreConfig(
  value: CoreConfigApiResponse | null | undefined,
): CoreConfigFormValues {
  return {
    warmupTimeSeconds:
      value?.warmupTimeSeconds ?? value?.warmup_time_seconds ?? 1,
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
    }),
  });
  const result = coreConfigEnvelopeSchema.parse(await response.json());

  if (!response.ok || !result.success) {
    throw new Error(result.error || 'Failed to save settings');
  }

  return normalizeCoreConfig(result.data);
}

export default function SettingsPage() {
  const { apiEndpoint } = useAppConfig();
  const [settingsTab, setSettingsTab] = useState<'core' | 'info'>('core');
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
    onSuccess: (values) => {
      form.reset(values);
      toast.success('Settings saved');
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save settings',
      );
    },
  });

  useEffect(() => {
    if (query.data) {
      form.reset(query.data);
    }
  }, [form, query.data]);

  const onSubmit = (values: CoreConfigFormValues) => {
    mutation.mutate(values);
  };

  const changeSettingsTab = (value: string) => {
    if (value === 'core' || value === 'info') {
      setSettingsTab(value);
    }
  };

  if (query.isLoading) {
    return (
      <div className="grid max-w-3xl gap-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-44" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  if (query.error && !query.data) {
    return (
      <Alert variant="destructive" className="max-w-3xl">
        <AlertTitle>Could not load settings</AlertTitle>
        <AlertDescription className="mt-2 flex flex-col gap-3">
          <span>
            {query.error instanceof Error
              ? query.error.message
              : 'Failed to connect to server'}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void query.refetch()}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <Form {...form}>
      <form
        className="max-w-3xl space-y-5"
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Server Settings
            </h1>
            <p className="text-sm text-muted-foreground">
              Tune startup behavior and inspect server endpoints.
            </p>
          </div>
          <Button
            type="submit"
            disabled={!form.formState.isDirty || mutation.isPending}
            className="w-full sm:w-auto"
          >
            <Save />
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>

        {query.error && (
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
          <TabsList className="grid h-auto w-full grid-cols-2">
            <TabsTrigger value="core">Core</TabsTrigger>
            <TabsTrigger value="info">Info</TabsTrigger>
          </TabsList>

          <TabsContent value="core" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Core Settings</CardTitle>
                <CardDescription>
                  Controls how long homectl waits before automation routines
                  begin.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FormField
                  control={form.control}
                  name="warmupTimeSeconds"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Warmup Time (seconds)</FormLabel>
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
                        Increase this if devices are not ready when routines
                        first run.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="info" className="mt-4">
            <Card>
              <CardHeader>
                <CardTitle>Server Information</CardTitle>
                <CardDescription>
                  Runtime endpoints exposed by the server process.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p className="flex items-center gap-2">
                  <Server className="size-4" />
                  <span className="font-medium text-foreground">
                    API Endpoint:
                  </span>
                  <code className="rounded-md bg-muted px-1.5 py-0.5">
                    /api/v1
                  </code>
                </p>
                <p className="flex items-center gap-2">
                  <Wifi className="size-4" />
                  <span className="font-medium text-foreground">
                    WebSocket:
                  </span>
                  <code className="rounded-md bg-muted px-1.5 py-0.5">
                    /api/v1/ws
                  </code>
                </p>
                <p>
                  Dashboard source settings now live on each configurable widget
                  instance in Config → Dashboard.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </form>
    </Form>
  );
}
