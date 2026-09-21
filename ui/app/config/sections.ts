export type ConfigSection = {
  description: string;
  group: 'Core' | 'Automation' | 'Interface' | 'Operations';
  href: string;
  label: string;
  keywords: string[];
};

export const configSections = [
  {
    href: '/config/diagnostics',
    label: 'Configuration check',
    description:
      'Find missing references, group loops, and unresolved scene assignments.',
    group: 'Operations',
    keywords: [
      'diagnostics',
      'issues',
      'broken',
      'references',
      'checks',
      'warnings',
    ],
  },
  {
    href: '/config/integrations',
    label: 'Integrations',
    description:
      'Plugin instances, schedules, MQTT bridges, and virtual devices.',
    group: 'Core',
    keywords: ['plugins', 'mqtt', 'cron', 'timer', 'dummy', 'circadian'],
  },
  {
    href: '/config/groups',
    label: 'Groups',
    description:
      'Device collections, nested groups, hidden rooms, and memberships.',
    group: 'Core',
    keywords: ['rooms', 'memberships', 'devices', 'linked groups'],
  },
  {
    href: '/config/devices',
    label: 'Devices',
    description:
      'Display names, sensor interaction mappings, replacement, and cleanup.',
    group: 'Core',
    keywords: ['labels', 'sensors', 'replace', 'delete', 'device config'],
  },
  {
    href: '/config/scenes',
    label: 'Scenes',
    description:
      'Device/group target states, scene links, scripts, and activation presets.',
    group: 'Automation',
    keywords: ['targets', 'scripts', 'colors', 'activation', 'presets'],
  },
  {
    href: '/config/routines',
    label: 'Routines',
    description: 'Triggers, conditions, programs, and automation status.',
    group: 'Automation',
    keywords: [
      'rules',
      'actions',
      'programs',
      'automation',
      'trigger',
      'override',
    ],
  },
  {
    href: '/config/helpers',
    label: 'Helpers',
    description:
      'Typed values routines, scripts, and widgets read and write, with live values and persistence.',
    group: 'Automation',
    keywords: [
      'helper',
      'state',
      'boolean',
      'enum',
      'number',
      'string',
      'mode',
      'value',
    ],
  },
  {
    href: '/config/routine-history',
    label: 'Routine History',
    description:
      'Recent routine activations, manual triggers, source devices, and rule traces.',
    group: 'Automation',
    keywords: ['history', 'audit', 'why', 'trace', 'trigger', 'diagnostics'],
  },
  {
    href: '/config/sources',
    label: 'Computed sources',
    description:
      'Server-computed circadian profiles published as read-only sensors, with forkable script presets.',
    group: 'Automation',
    keywords: [
      'computed',
      'source',
      'circadian',
      'kelvin',
      'script',
      'preset',
      'alias',
    ],
  },
  {
    href: '/config/floorplan',
    label: 'Floorplan',
    description:
      'Floorplan grids, background images, device positions, and group masks.',
    group: 'Interface',
    keywords: ['map', 'grid', 'walls', 'image', 'positions'],
  },
  {
    href: '/config/settings',
    label: 'System',
    description:
      'Appearance, core server settings, warmup, and runtime behavior.',
    group: 'Operations',
    keywords: [
      'appearance',
      'theme',
      'display',
      'server',
      'core',
      'warmup',
      'runtime',
    ],
  },
  {
    href: '/config/logs',
    label: 'Logs',
    description: 'Runtime log stream, levels, and operational diagnostics.',
    group: 'Operations',
    keywords: ['events', 'diagnostics', 'debug', 'errors'],
  },
  {
    href: '/config/import-export',
    label: 'Backups & Migration',
    description:
      'JSON backups, restores, runtime snapshots, and legacy TOML import.',
    group: 'Operations',
    keywords: [
      'backup',
      'restore',
      'json',
      'snapshot',
      'toml',
      'legacy',
      'migration',
      'database',
    ],
  },
] satisfies ConfigSection[];

export function matchesConfigSectionSearch(
  section: ConfigSection,
  search: string,
) {
  const normalizedSearch = search.trim().toLowerCase();
  if (!normalizedSearch) {
    return true;
  }

  return [
    section.label,
    section.description,
    section.group,
    section.href,
    ...section.keywords,
  ]
    .join(' ')
    .toLowerCase()
    .includes(normalizedSearch);
}
