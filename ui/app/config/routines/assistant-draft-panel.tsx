import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';

import {
  AssistantDraft,
  useAssistantStatus,
  useDraftRoutine,
} from '@/hooks/useAssistant';
import { Alert, AlertDescription, AlertTitle } from '@/ui/primitives/alert';
import { Button } from '@/ui/primitives/button';
import { ConfigFormSection } from '@/ui/config-form';
import { Textarea } from '@/ui/primitives/textarea';

/**
 * Prompt-to-draft helper for the routine composer. Renders nothing unless the
 * deployment configured an assistant provider, and never saves on its own:
 * the drafted definition is loaded into the editor for review.
 */
export function AssistantDraftPanel({
  onDraft,
}: {
  onDraft: (draft: AssistantDraft) => void;
}) {
  const { enabled, model } = useAssistantStatus();
  const draftMutation = useDraftRoutine();
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState<AssistantDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) {
    return null;
  }

  const submit = async () => {
    if (!prompt.trim()) {
      return;
    }
    setError(null);
    try {
      const draft = await draftMutation.mutateAsync({ prompt: prompt.trim() });
      setResult(draft);
      onDraft(draft);
      toast.success('Draft loaded into the editor');
    } catch (draftError) {
      setResult(null);
      setError(
        draftError instanceof Error ? draftError.message : 'Failed to draft',
      );
    }
  };

  return (
    <ConfigFormSection
      title="Describe it"
      description={
        model
          ? `Ask ${model} for a first draft, then review it below. Nothing is saved automatically.`
          : 'Describe the automation and review the draft below. Nothing is saved automatically.'
      }
    >
      <div className="space-y-4">
        <Textarea
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          placeholder="Turn on the hallway lamp when motion is detected, but only after sunset"
          className="min-h-20"
          disabled={draftMutation.isPending}
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Drafts are validated against your devices, scenes, groups, and
            helpers before they reach the editor.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={!prompt.trim() || draftMutation.isPending}
            onClick={() => void submit()}
          >
            {draftMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Drafting…
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Draft with AI
              </>
            )}
          </Button>
        </div>

        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {result && result.warnings.length > 0 ? (
          <Alert variant="warning">
            <AlertTitle>Review these assumptions</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}
      </div>
    </ConfigFormSection>
  );
}
