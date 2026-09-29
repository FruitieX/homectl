// Static schema fixture for Study 03, not a serializer for the HTML prototype.
// Synthetic catalog: mqtt_home/hall_motion (/occupancy, /illuminance),
// helpers lighting_enabled, manual_override, home_mode; group hallway;
// scenes evening_glow and hallway_off. No backend writes or commands.
import type { RoutineDefinitionV2 } from '../../ui/bindings/RoutineDefinitionV2';
import type { ConditionExpr } from '../../ui/bindings/ConditionExpr';

const motion = (value: boolean): ConditionExpr => ({
  kind: 'comparison',
  source: {
    kind: 'device',
    device: { integration_id: 'mqtt_home', device_id: 'hall_motion' },
    path: '/occupancy',
  },
  operator: 'eq',
  value,
});

export const complexRoutineFixture = {
  triggers: [
    { kind: 'predicate_transition', id: 'motion_detected', predicate: motion(true) },
    { kind: 'timer_fired', id: 'idle_finished', timer: 'hallway_idle' },
  ],
  condition: {
    kind: 'all',
    conditions: [
      { kind: 'comparison', source: { kind: 'helper', helper: 'lighting_enabled' }, operator: 'eq', value: true },
      { kind: 'not', condition: { kind: 'comparison', source: { kind: 'helper', helper: 'manual_override' }, operator: 'eq', value: true } },
    ],
  },
  program: {
    kind: 'native',
    steps: [{
      action: 'choose', id: 'choose_motion_state',
      branches: [
        {
          id: 'motion_and_dark',
          condition: {
            kind: 'all', conditions: [
              motion(true),
              { kind: 'any', conditions: [
                { kind: 'comparison', source: { kind: 'device', device: { integration_id: 'mqtt_home', device_id: 'hall_motion' }, path: '/illuminance' }, operator: 'lt', value: 30 },
                { kind: 'comparison', source: { kind: 'helper', helper: 'home_mode' }, operator: 'eq', value: 'Night' },
              ] },
            ],
          },
          steps: [
            { action: 'activate_scene', id: 'activate_evening', scene_id: 'evening_glow', targets: { devices: [], groups: ['hallway'] }, use_scene_transition: true },
            { action: 'replace_timer', id: 'restart_idle', timer: 'hallway_idle', delay_ms: 120000n },
          ],
        },
        {
          id: 'motion_clear', condition: motion(false),
          steps: [{ action: 'activate_scene', id: 'activate_off', scene_id: 'hallway_off', targets: { devices: [], groups: ['hallway'] }, use_scene_transition: true }],
        },
      ],
    }],
  },
  execution: { mode: 'queued', max_actions: 16 },
} satisfies RoutineDefinitionV2;
