import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { readApiResponse } from '@/hooks/useConfig';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
export type FloorplanImage =
  | { kind: 'none' }
  | {
      kind: 'stored';
      revision: string;
      mime_type: string | null;
      bytes: number;
    }
  | { kind: 'upload'; mime_type: string; data_base64: string };
export type FloorplanDraft = {
  id: string;
  name: string;
  grid_data: string | null;
  image: FloorplanImage;
  revision_token: string;
};
export function useFloorplanEditor(id: string, creating: boolean) {
  const { apiEndpoint } = useAppConfig(),
    client = useQueryClient(),
    recordWrite = useRecordConfigWrite();
  const base = `${apiEndpoint}/api/v1/config/floorplans`;
  const key = ['config', apiEndpoint, 'floorplan-editor', id];
  const saved = useQuery({
    queryKey: key,
    enabled: !!id && !creating,
    queryFn: async ({ signal }) =>
      (
        await readApiResponse<FloorplanDraft>(
          await fetch(`${base}/${encodeURIComponent(id)}/editor`, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          }),
          'Could not load the floorplan.',
        )
      ).data!,
    refetchInterval: 30000,
  });
  return {
    apiEndpoint,
    saved,
    save: async (value: FloorplanDraft, expected: FloorplanDraft) => {
      await client.cancelQueries({ queryKey: key });
      const result = await readApiResponse<FloorplanDraft>(
        await fetch(`${base}/${encodeURIComponent(value.id)}/editor`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...value,
            expected: creating ? undefined : expected.revision_token,
            create_only: creating,
          }),
          signal: AbortSignal.timeout(30000),
        }),
        'Could not save the floorplan.',
      );
      recordWrite(`floorplan/${value.id}`, result.write);
      client.setQueryData(
        ['config', apiEndpoint, 'floorplan-editor', value.id],
        result.data,
      );
      void client.invalidateQueries({ queryKey: ['config'] });
      return result.data!;
    },
    remove: async (expected: FloorplanDraft) => {
      const result = await readApiResponse<unknown>(
        await fetch(`${base}/${encodeURIComponent(id)}/editor`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ expected: expected.revision_token }),
          signal: AbortSignal.timeout(20000),
        }),
        'Could not delete the floorplan.',
      );
      recordWrite(`floorplan/${id}`, result.write);
      await client.invalidateQueries({ queryKey: ['config'] });
    },
  };
}
