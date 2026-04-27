import { z } from 'zod';

import { type JsonValue } from '@/bindings/serde_json/JsonValue';

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);

export const configIdSchema = z
  .string()
  .trim()
  .min(1, 'ID is required')
  .regex(/^[a-zA-Z0-9_./:-]+$/, 'Use letters, numbers, _, ., /, :, or -');

export const configNameSchema = z.string().trim().min(1, 'Name is required');

export const integrationSchema = z.object({
  id: configIdSchema,
  plugin: configIdSchema,
  config: z.record(z.string(), jsonValueSchema),
  enabled: z.boolean(),
});

export const groupSchema = z.object({
  id: configIdSchema,
  name: configNameSchema,
  hidden: z.boolean(),
  devices: z.array(
    z.object({
      integration_id: configIdSchema,
      device_id: configIdSchema,
    }),
  ),
  linked_groups: z.array(configIdSchema),
  device_keys: z.array(configIdSchema).optional(),
});

export const deviceColorSchema = z.union([
  z.object({
    Hs: z.object({
      h: z.number().min(0).max(360),
      s: z.number().min(0).max(1),
    }),
  }),
  z.object({
    Xy: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }),
  }),
  z.object({
    Rgb: z.object({
      r: z.number().min(0).max(255),
      g: z.number().min(0).max(255),
      b: z.number().min(0).max(255),
    }),
  }),
  z.object({ Ct: z.object({ ct: z.number().positive() }) }),
]);

export const sceneDeviceStateSchema = z.object({
  power: z.boolean().optional(),
  color: deviceColorSchema.optional(),
  brightness: z.number().min(0).max(1).optional(),
  transition: z.number().min(0).optional(),
});

export const activateSceneDescriptorSchema = z.object({
  scene_id: configIdSchema,
  device_keys: z.array(configIdSchema).optional(),
  group_keys: z.array(configIdSchema).optional(),
  use_scene_transition: z.boolean().optional(),
  transition: z.number().min(0).optional(),
});

export const sceneDeviceLinkSchema = z.object({
  brightness: z.number().min(0).max(1).optional(),
  integration_id: configIdSchema,
  device_id: configIdSchema.optional(),
});

export const sceneDeviceConfigSchema = z.union([
  sceneDeviceLinkSchema,
  activateSceneDescriptorSchema,
  sceneDeviceStateSchema,
]);

export const sceneSchema = z.object({
  id: configIdSchema,
  name: configNameSchema,
  hidden: z.boolean(),
  script: z.string().optional(),
  device_states: z.record(z.string(), sceneDeviceConfigSchema),
  group_states: z.record(z.string(), sceneDeviceConfigSchema),
});

export const routineSchema = z.object({
  id: configIdSchema,
  name: configNameSchema,
  enabled: z.boolean(),
  rules: z.array(jsonValueSchema),
  actions: z.array(jsonValueSchema),
});

export const deviceDisplayNameOverrideSchema = z.object({
  device_key: configIdSchema,
  display_name: configNameSchema,
});

export const floorplanMetadataSchema = z.object({
  id: configIdSchema,
  name: configNameSchema,
});

export type IntegrationFormValues = z.infer<typeof integrationSchema>;
export type GroupFormValues = z.infer<typeof groupSchema>;
export type SceneFormValues = z.infer<typeof sceneSchema>;
export type RoutineFormValues = z.infer<typeof routineSchema>;
