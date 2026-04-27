export type ConfigSection = {
  description: string;
  group: 'Core' | 'Automation' | 'Interface' | 'Operations';
  href: string;
  label: string;
  keywords: string[];
};

export const configSections = [
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
    description: 'Rules, triggers, actions, overrides, and automation status.',
    group: 'Automation',
    keywords: ['rules', 'actions', 'automation', 'trigger', 'override'],
  },
  {
    href: '/config/dashboard',
    label: 'Dashboard',
    description: 'Layouts, widgets, cards, and dashboard composition.',
    group: 'Interface',
    keywords: ['widgets', 'layout', 'cards', 'home screen'],
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
    label: 'Settings',
    description: 'Core server settings such as warmup and runtime behavior.',
    group: 'Operations',
    keywords: ['server', 'core', 'warmup', 'runtime'],
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
    label: 'Import/Export',
    description: 'JSON backups, restores, exports, and runtime snapshots.',
    group: 'Operations',
    keywords: ['backup', 'restore', 'json', 'snapshot'],
  },
  {
    href: '/config/migration',
    label: 'TOML Migration',
    description:
      'Import legacy TOML config into database-backed runtime config.',
    group: 'Operations',
    keywords: ['toml', 'legacy', 'migration', 'database'],
  },
] satisfies ConfigSection[];

export function getActiveConfigSection(pathname: string) {
  return configSections.find((section) => pathname.startsWith(section.href));
}

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
