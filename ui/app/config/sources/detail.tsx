import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import type { SourceConfig } from '@/hooks/useConfig';
import {
  useSources,
  useSourcePresets,
  readApiResponse,
} from '@/hooks/useConfig';
import { useDevicesState } from '@/hooks/websocket';
import { useAppConfig } from '@/hooks/appConfig';
import type { SourcePreview } from '@/bindings/SourcePreview';
import { describeColorName } from '@/lib/deviceColor';
import { DetailPageShell } from '@/ui/config/DetailPageShell';
import { Section } from '@/ui/config/Section';
import { useSectionEditor } from '@/ui/config/useSectionEditor';
import { useSectionParams } from '@/ui/config/useSectionParams';
import { Alert, AlertDescription } from '@/ui/primitives/alert';
import { Badge } from '@/ui/primitives/badge';
import { Button } from '@/ui/primitives/button';
import { confirmDestructive } from '@/ui/primitives/confirm-dialog';
import { EmptyState } from '@/ui/primitives/empty-state';
import { Skeleton } from '@/ui/primitives/skeleton';
import { toast } from 'sonner';

import { SourceEditor, liveValue, validationError } from './page';

/** A few points of a previewed day, enough to see the shape of the curve. */
function PreviewSamples({ preview }: { preview: SourcePreview }) {
  const samples = Array.isArray(preview.samples) ? preview.samples : [];
  if (samples.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No samples were returned for this definition.
      </p>
    );
  }
  const step = Math.max(1, Math.ceil(samples.length / 6));
  const shown = samples.filter((_sample, index) => index % step === 0);
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-border/60">
        {shown.map((sample) => (
          <li
            key={String(sample.time_ms)}
            className="flex items-center justify-between gap-3 py-1.5 text-sm"
          >
            <span className="tabular-nums text-muted-foreground">
              {sample.local_time}
            </span>
            <span className="text-foreground">
              {sample.profile?.brightness
                ? `${Math.round(sample.profile.brightness * 100)}%${
                    sample.profile.color
                      ? ` · ${describeColorName(sample.profile.color)}`
                      : ''
                  }`
                : 'Off'}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {samples.length} samples across {preview.timezone}, every{' '}
        {Math.round(Number(preview.step_ms) / 60000)} min.
      </p>
    </div>
  );
}

export default function SourceDetailPage() {
  const { id: routeId } = useParams();
  const navigate = useNavigate();
  const { apiEndpoint } = useAppConfig();
  const { data: sources, loading, error, update, remove } = useSources();
  const { data: presets } = useSourcePresets();
  const liveDevices = useDevicesState();
  const { activeSection, openSection } = useSectionParams();
  const headingRefs = useRef<Record<string, HTMLElement | null>>({});

  const source = useMemo(
    () => (sources ?? []).find((entry) => entry.id === routeId),
    [sources, routeId],
  );
  const live = routeId ? liveValue(liveDevices?.[`computed/${routeId}`]) : null;

  const [preview, setPreview] = useState<SourcePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  useAssistantPageContext({
    kind: 'computed_source',
    id: source?.id,
    label: source?.name,
  });

  useEffect(() => {
    if (!activeSection) return;
    const node = headingRefs.current[activeSection];
    if (node) {
      node.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
  }, [activeSection]);

  const runPreview = useCallback(async () => {
    if (!source) return;
    setPreviewing(true);
    setPreviewError(null);
    try {
      const response = await fetch(
        `${apiEndpoint}/api/v1/config/source-preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            timezone: source.timezone,
            compute: source.compute,
            samples: 24,
          }),
        },
      );
      const result = await readApiResponse<SourcePreview>(
        response,
        'Failed to preview this source',
      );
      setPreview(result.data ?? null);
    } catch (previewFailure) {
      setPreviewError(
        previewFailure instanceof Error
          ? previewFailure.message
          : 'Failed to preview this source',
      );
    } finally {
      setPreviewing(false);
    }
  }, [apiEndpoint, source]);

  const configEditor = useSectionEditor<SourceConfig>({
    item: source,
    fields: [
      'id',
      'name',
      'enabled',
      'timezone',
      'refresh_interval_ms',
      'compute',
    ],
    validate: (values) => {
      const message = validationError({
        ...source,
        ...values,
      } as SourceConfig);
      return message ? [{ field: 'compute', message }] : [];
    },
    save: async (values) => {
      if (!source) return;
      await update(source.id, { ...source, ...values });
    },
  });

  const crumbs = [
    { label: 'Settings', to: '/config' },
    { label: 'Computed sources', to: '/config/sources' },
    { label: routeId ?? 'Source' },
  ];

  if (loading) {
    return (
      <DetailPageShell
        crumbs={crumbs}
        backTo="/config/sources"
        backLabel="Back to sources"
        title={routeId ?? 'Source'}
      >
        <Skeleton className="h-32 w-full rounded-2xl" />
      </DetailPageShell>
    );
  }

  if (!source) {
    return (
      <DetailPageShell
        crumbs={crumbs}
        backTo="/config/sources"
        backLabel="Back to sources"
        title={routeId ?? 'Source'}
      >
        <EmptyState
          title="This source is not in the current configuration"
          description={`${routeId ?? 'It'} may have been deleted or renamed. Open Computed sources to pick another.`}
        />
      </DetailPageShell>
    );
  }

  const deleteSource = () => {
    void (async () => {
      const confirmed = await confirmDestructive(
        `Delete source "${source.name}"?`,
        'It stops publishing values; routines that read it lose their input.',
      );
      if (!confirmed) return;
      try {
        await remove(source.id);
        toast.success(`Deleted ${source.name}`);
        void navigate('/config/sources', { replace: true });
      } catch (nextError) {
        toast.error(
          nextError instanceof Error ? nextError.message : 'Failed to delete',
        );
      }
    })();
  };

  const computeKind =
    source.compute.kind === 'script'
      ? source.compute.preset
        ? `Script from preset ${source.compute.preset.id} v${source.compute.preset.version}`
        : 'Custom script'
      : 'Built-in circadian preset';

  return (
    <DetailPageShell
      crumbs={crumbs}
      backTo="/config/sources"
      backLabel="Back to sources"
      title={source.name || source.id}
      status={
        <>
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge variant={source.enabled ? 'outline' : 'muted'}>
              {source.enabled ? 'Enabled' : 'Disabled'}
            </Badge>
            <span className="text-sm text-muted-foreground">
              computed/{source.id}
            </span>
          </span>
          <span className="block text-muted-foreground">
            {source.enabled
              ? `Publishes every ${Math.round(source.refresh_interval_ms / 1000)}s in ${source.timezone}.`
              : 'Disabled: it never computes or publishes.'}
          </span>
        </>
      }
    >
      <div className="space-y-4">
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* Output and freshness lead the page. */}
        <div className="space-y-2">
          <p className="text-2xl font-semibold text-foreground">
            {live ?? 'No output received yet'}
          </p>
          <p className="text-sm text-muted-foreground">
            {live
              ? 'What this source publishes right now.'
              : source.enabled
                ? 'The source has not published a value in this session.'
                : 'A disabled source never computes or publishes.'}
          </p>
        </div>

        <Section<SourceConfig>
          id="preview"
          title="Preview"
          summary="What it would publish across a local day"
          open={activeSection === 'preview'}
          onOpenChange={(open) => openSection(open ? 'preview' : null)}
          headingRef={(node) => {
            headingRefs.current.preview = node;
          }}
          api={configEditor}
          editable={false}
          readView={
            <div className="space-y-3">
              {/* Say which values the preview uses before the reader trusts it. */}
              <p className="text-sm text-muted-foreground">
                Preview evaluates the <strong>saved</strong> definition — not
                unsaved edits in the configuration section below. It is a
                computed profile, not a device reading.
              </p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={previewing}
                onClick={() => void runPreview()}
              >
                {previewing ? 'Computing…' : "Preview today's output"}
              </Button>
              {previewError ? (
                <p role="alert" className="text-sm text-destructive">
                  {previewError}
                </p>
              ) : null}
              {preview ? (
                preview.unsupported_reason ? (
                  <Alert>
                    <AlertDescription>
                      {preview.unsupported_reason}
                    </AlertDescription>
                  </Alert>
                ) : (
                  <PreviewSamples preview={preview} />
                )
              ) : null}
            </div>
          }
          renderEditor={() => null}
        />

        <Section<SourceConfig>
          id="configuration"
          title="Configuration"
          summary={`${computeKind} · ${source.timezone}`}
          open={activeSection === 'configuration'}
          onOpenChange={(open) => openSection(open ? 'configuration' : null)}
          headingRef={(node) => {
            headingRefs.current.configuration = node;
          }}
          api={configEditor}
          readView={
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Name
                </dt>
                <dd className="text-sm text-foreground">{source.name}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Id
                </dt>
                <dd className="truncate text-sm text-foreground">
                  {source.id}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Timezone
                </dt>
                <dd className="text-sm text-foreground">{source.timezone}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Refresh interval
                </dt>
                <dd className="text-sm text-foreground">
                  {Math.round(source.refresh_interval_ms / 1000)}s
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  Compute
                </dt>
                <dd className="text-sm text-foreground">{computeKind}</dd>
              </div>
            </dl>
          }
          renderEditor={(api) => (
            <SourceEditor
              draft={{ ...source, ...(api.draft ?? {}) }}
              presets={presets ?? []}
              onChange={(next) => api.patch(next)}
              onSave={() => undefined}
              onCancel={() => undefined}
              saving={false}
              error={null}
              isNew={false}
              hideCurrentOutput
              hideActions
            />
          )}
        />

        <Section<SourceConfig>
          id="danger"
          title="Delete this source"
          summary="Routines that read it lose their input"
          open={activeSection === 'danger'}
          onOpenChange={(open) => openSection(open ? 'danger' : null)}
          headingRef={(node) => {
            headingRefs.current.danger = node;
          }}
          api={configEditor}
          editable={false}
          danger
          readView={
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Deleting this source stops the values it publishes; routines
                that read it lose their input.
              </p>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={deleteSource}
              >
                Delete this source
              </Button>
            </div>
          }
          renderEditor={() => null}
        />
      </div>
    </DetailPageShell>
  );
}
