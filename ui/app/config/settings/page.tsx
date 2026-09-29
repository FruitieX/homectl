import { AssistantSection } from './AssistantSection';
import { BehaviorSection } from './BehaviorSection';
import { SettingsSection } from '@/ui/settings/SettingsSection';
import { useSettingsPreferences } from '@/hooks/useSettingsPreferences';
import { PreferencesSection } from '@/ui/settings/PreferencesSection';
import { useSearchParams } from 'react-router-dom';
import { useAppConfig } from '@/hooks/appConfig';
import { normalizeBuildInfo } from '@/lib/buildInfo';
import { ConfigPageHeader } from '../page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/ui/primitives/tabs';
import { AppearanceSection } from './AppearanceSection';

const buildInfo = normalizeBuildInfo({
  version: import.meta.env.VITE_APP_VERSION,
  gitCommit: import.meta.env.VITE_GIT_COMMIT,
  buildDate: import.meta.env.VITE_BUILD_DATE,
});

export default function SettingsPage() {
  const [params, setParams] = useSearchParams();
  const { apiEndpoint, wsEndpoint } = useAppConfig();
  const { advanced } = useSettingsPreferences();
  const requestedTab = params.get('tab') ?? 'appearance';
  const tab = ['appearance', 'core', 'assistant', 'info'].includes(requestedTab)
    ? requestedTab
    : 'appearance';
  return (
    <div className="settings-page">
      <ConfigPageHeader
        title="App & system"
        description="Appearance, shared system behavior and assistant provider settings."
      />
      <Tabs
        value={tab}
        onValueChange={(value) =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              next.set('tab', value);
              return next;
            },
            { replace: true },
          )
        }
      >
        <TabsList className="flex h-auto w-fit max-w-full gap-1 overflow-x-auto">
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
          <TabsTrigger value="core">Behavior</TabsTrigger>
          <TabsTrigger value="assistant">Assistant</TabsTrigger>
          <TabsTrigger value="info">About</TabsTrigger>
        </TabsList>
        <TabsContent value="appearance" className="mt-4 space-y-4">
          <PreferencesSection />
          <AppearanceSection />
        </TabsContent>
        <TabsContent value="core" className="mt-4">
          <BehaviorSection />
        </TabsContent>
        <TabsContent value="assistant" className="mt-4">
          <div className="space-y-4">
            <AssistantSection />
          </div>
        </TabsContent>
        <TabsContent value="info" className="mt-4">
          <SettingsSection title="About homectl">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-muted-foreground">Version</dt>
                <dd>{buildInfo.version}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Built (UTC)</dt>
                <dd>{buildInfo.buildDate}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Commit</dt>
                <dd className="break-all font-mono text-xs">
                  {buildInfo.gitCommit}
                </dd>
              </div>
            </dl>
            {advanced && (
              <dl className="grid gap-3 text-xs sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">API endpoint</dt>
                  <dd className="break-all">
                    {apiEndpoint || location.origin}/api/v1
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">WebSocket</dt>
                  <dd className="break-all">{wsEndpoint}</dd>
                </div>
              </dl>
            )}
          </SettingsSection>
        </TabsContent>
      </Tabs>
    </div>
  );
}
