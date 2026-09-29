import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAppConfig } from '@/hooks/appConfig';
import { readApiResponse } from '@/hooks/useConfig';
import { useRecordConfigWrite } from '@/hooks/configWriteStatus';
import type { ColorCalibrationProfile } from '@/bindings/ColorCalibrationProfile';
import type { ColorCalibrationAssignment } from '@/bindings/ColorCalibrationAssignment';
import type { DeviceColorCalibration } from '@/bindings/DeviceColorCalibration';

export type CalibrationEditorView = {
  profiles: ColorCalibrationProfile[];
  assignments: ColorCalibrationAssignment[];
  legacy: DeviceColorCalibration[];
  revision_token: string;
};
export type CalibrationEdit = {
  profile?: ColorCalibrationProfile | null;
  profile_id: string | null;
  device_keys: string[];
};

export function useCalibrationEditor() {
  const { apiEndpoint } = useAppConfig();
  const client = useQueryClient();
  const recordWrite = useRecordConfigWrite();
  const queryKey = ['config', apiEndpoint, 'calibration-editor'];
  const url = `${apiEndpoint}/api/v1/config/calibration-editor`;
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }) =>
      (
        await readApiResponse<CalibrationEditorView>(
          await fetch(url, {
            signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
          }),
          'Could not load calibration profiles',
        )
      ).data!,
  });
  return {
    ...query,
    save: async (value: CalibrationEdit, expected: string) => {
      await client.cancelQueries({ queryKey });
      const result = await readApiResponse<CalibrationEditorView>(
        await fetch(url, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...value, expected }),
          signal: AbortSignal.timeout(20000),
        }),
        'Could not save calibration',
      );
      recordWrite('calibration-editor', result.write);
      client.setQueryData(queryKey, result.data);
      await client.invalidateQueries({ queryKey: ['config'] });
      return result.data!;
    },
  };
}

export function deviceCalibration(view: CalibrationEditorView, key: string) {
  const assignment = view.assignments.find((row) => row.device_key === key);
  const profile = assignment
    ? view.profiles.find((row) => row.id === assignment.profile_id)
    : undefined;
  const resolved = profile ?? view.legacy.find((row) => row.device_key === key);
  return { profile, resolved };
}
