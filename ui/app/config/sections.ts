export type ConfigSection = {
  description: string;
  group: 'Your home' | 'Automations' | 'Appearance' | 'Maintenance';
  href: string;
  label: string;
  keywords: string[];
};

export const configSections = [
  {
    href: '/config/diagnostics',
    label: 'Check for problems',
    description: 'Find broken links and get a next step for each issue.',
    group: 'Maintenance',
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
    label: 'Connections & services',
    description: 'Connect devices, schedules, and virtual services.',
    group: 'Your home',
    keywords: [
      'integrations',
      'plugins',
      'mqtt',
      'cron',
      'timer',
      'dummy',
      'circadian',
    ],
  },
  {
    href: '/config/groups',
    label: 'Rooms',
    description: 'Organize devices and control them together.',
    group: 'Your home',
    keywords: ['rooms', 'memberships', 'devices', 'linked groups'],
  },
  {
    href: '/config/devices',
    label: 'Devices',
    description: 'Name, inspect, and organize your devices and sensors.',
    group: 'Your home',
    keywords: ['labels', 'sensors', 'replace', 'delete', 'device config'],
  },
  {
    href: '/config/scenes',
    label: 'Scenes',
    description: 'Save the lighting or device state you want to recall.',
    group: 'Automations',
    keywords: ['targets', 'scripts', 'colors', 'activation', 'presets'],
  },
  {
    href: '/config/routines',
    label: 'Routines',
    description: 'Choose what starts an automation and what it does.',
    group: 'Automations',
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
    description: 'Store values that automations can read and change.',
    group: 'Automations',
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
    label: 'Automation history',
    description: 'See when routines ran and what triggered them.',
    group: 'Automations',
    keywords: ['history', 'audit', 'why', 'trace', 'trigger', 'diagnostics'],
  },
  {
    href: '/config/sources',
    label: 'Computed sources',
    description: 'Use calculated values such as time-based light color.',
    group: 'Automations',
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
    description: 'Place devices and rooms on a map of your home.',
    group: 'Appearance',
    keywords: ['map', 'grid', 'walls', 'image', 'positions'],
  },
  {
    href: '/config/settings',
    label: 'App & system',
    description: 'Adjust appearance, startup behavior, and assistant settings.',
    group: 'Appearance',
    keywords: [
      'appearance',
      'theme',
      'display',
      'server',
      'core',
      'warmup',
      'runtime',
      'assistant',
      'ai',
      'api key',
      'model',
      'timezone',
      'transitions',
      'build',
      'info',
    ],
  },
  {
    href: '/config/logs',
    label: 'Logs',
    description: 'Inspect technical events when troubleshooting.',
    group: 'Maintenance',
    keywords: ['events', 'diagnostics', 'debug', 'errors'],
  },
  {
    href: '/config/import-export',
    label: 'Backups & migration',
    description: 'Save, restore, or import your configuration.',
    group: 'Maintenance',
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

// Routes that are tabs of a section but live at their own pathname; the page
// header uses these to resolve the breadcrumb without listing a duplicate entry
// on the settings home page.
export const configSectionAliases: Record<string, string> = {
  '/config/migration': '/config/import-export',
};

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
