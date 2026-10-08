import {
  Activity,
  Timer,
  ShieldAlert,
  Plug,
  House,
  Lightbulb,
  SlidersHorizontal,
  Palette,
  Workflow,
  Blocks,
  Variable,
  History,
  Calculator,
  Radio,
  Database,
  Map,
  LayoutDashboard,
  Settings,
  ScrollText,
  ArchiveRestore,
  type LucideIcon,
} from 'lucide-react';

// Settings are grouped by the task a person is doing, and the catalog below is
// listed in the order it appears in navigation and on the overview.
export const configSectionGroups = [
  'Your home',
  'Automations',
  'Displays',
  'System',
] as const;
export type ConfigSectionGroup = (typeof configSectionGroups)[number];

export type ConfigSection = {
  icon: LucideIcon;
  /**
   * Set for pages shown as a tab of another section. They stay searchable but
   * are not listed separately in navigation or on the settings overview.
   */
  parent?: string;
  /** Shorter name used on the tab strip; defaults to the label. */
  tabLabel?: string;
  description: string;
  group: ConfigSectionGroup;
  href: string;
  label: string;
  keywords: string[];
};

export const configCatalog = [
  {
    href: '/config/groups',
    icon: House,
    label: 'Rooms & groups',
    description: 'Organize devices and control them together.',
    group: 'Your home',
    keywords: ['rooms', 'memberships', 'devices', 'linked groups'],
  },
  {
    href: '/config/devices',
    tabLabel: 'Devices',
    icon: Lightbulb,
    label: 'Devices',
    description: 'Name, inspect and calibrate your devices and sensors.',
    group: 'Your home',
    keywords: ['labels', 'sensors', 'replace', 'delete', 'device config'],
  },
  {
    href: '/config/integrations',
    icon: Plug,
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
    href: '/config/calibration',
    parent: '/config/devices',
    icon: SlidersHorizontal,
    label: 'Light calibration',
    description: 'Make lights match: color and brightness profiles.',
    group: 'Your home',
    keywords: ['calibration', 'profile', 'color match', 'brightness curve'],
  },
  {
    href: '/config/scenes',
    icon: Palette,
    label: 'Scenes',
    description: 'Save the lighting or device state you want to recall.',
    group: 'Automations',
    keywords: ['targets', 'scripts', 'colors', 'activation', 'presets'],
  },
  {
    href: '/config/routines',
    icon: Workflow,
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
    href: '/config/timers',
    icon: Timer,
    label: 'Timers',
    description: 'Countdowns, scheduled actions and ready-by times.',
    group: 'Automations',
    keywords: ['timer', 'countdown', 'car heater', 'ready by', 'schedule'],
  },
  {
    href: '/config/helpers',
    icon: Variable,
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
    href: '/config/blocks',
    icon: Blocks,
    label: 'Blocks',
    description: 'Reuse conditions and actions across automations.',
    group: 'Automations',
    keywords: [
      'block',
      'reusable',
      'logic',
      'parameters',
      'actions',
      'conditions',
    ],
  },
  {
    href: '/config/sources',
    icon: Calculator,
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
    href: '/config/dashboard',
    tabLabel: 'Dashboards',
    icon: LayoutDashboard,
    label: 'Dashboards',
    description: 'Layouts, widgets and the data sources they show.',
    group: 'Displays',
    keywords: ['widgets', 'layouts', 'cards', 'selections', 'dashboard'],
  },
  {
    href: '/config/floorplan',
    icon: Map,
    label: 'Floorplan',
    description: 'Place devices and rooms on a map of your home.',
    group: 'Displays',
    keywords: ['map', 'grid', 'walls', 'image', 'positions'],
  },
  {
    href: '/config/widget-sources',
    parent: '/config/dashboard',
    tabLabel: 'Data sources',
    icon: Database,
    label: 'Widget sources',
    description:
      'Connect weather, calendar, transport and historical sensor data.',
    group: 'Displays',
    keywords: [
      'widgets',
      'influxdb',
      'token',
      'calendar',
      'feed',
      'weather',
      'train',
    ],
  },
  {
    href: '/config/sensors',
    parent: '/config/dashboard',
    tabLabel: 'Sensor names',
    icon: Radio,
    label: 'Sensor names',
    description: 'Name dashboard sensors and organize their groups.',
    group: 'Displays',
    keywords: [
      'sensors',
      'catalog',
      'temperature',
      'humidity',
      'influxdb',
      'widgets',
    ],
  },
  {
    href: '/config/settings',
    icon: Settings,
    label: 'App & system',
    description: 'Adjust appearance, startup behavior, and assistant settings.',
    group: 'System',
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
    href: '/config/diagnostics',
    tabLabel: 'Problems',
    icon: ShieldAlert,
    label: 'Activity & problems',
    description: 'Fix broken links, see what ran and inspect technical logs.',
    group: 'System',
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
    href: '/config/routine-history',
    parent: '/config/diagnostics',
    icon: History,
    label: 'Routine activity',
    description: 'See what ran, what was blocked and the recorded reasons.',
    group: 'System',
    keywords: ['history', 'audit', 'why', 'trace', 'trigger', 'diagnostics'],
  },
  {
    href: '/config/sensor-history',
    parent: '/config/diagnostics',
    icon: Activity,
    label: 'Sensor activity',
    description: 'Inspect recorded value changes across your sensors.',
    group: 'System',
    keywords: ['sensor', 'history', 'changes', 'events'],
  },
  {
    href: '/config/logs',
    parent: '/config/diagnostics',
    icon: ScrollText,
    label: 'Logs',
    description: 'Inspect technical events when troubleshooting.',
    group: 'System',
    keywords: ['events', 'diagnostics', 'debug', 'errors'],
  },
  {
    href: '/config/import-export',
    tabLabel: 'Backups',
    icon: ArchiveRestore,
    label: 'Backups & restore',
    description: 'Save, restore, or import your configuration.',
    group: 'System',
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
  {
    href: '/config/migration',
    icon: ArchiveRestore,
    label: 'Legacy import',
    description: 'Import entries from an older TOML setup.',
    group: 'System',
    parent: '/config/import-export',
    keywords: ['toml', 'legacy', 'migration', 'import'],
  },
] satisfies ConfigSection[];

/** Top-level sections, in navigation order. */
export const configSections: ConfigSection[] = configCatalog.filter(
  (section: ConfigSection) => !section.parent,
);

/** The most specific catalog entry, tabs included, for a settings path. */
export function configCatalogEntry(
  pathname: string,
): ConfigSection | undefined {
  const entries: ConfigSection[] = configCatalog;
  return (
    entries.find((entry) => entry.href === pathname) ??
    entries
      .filter((entry) => pathname.startsWith(`${entry.href}/`))
      .sort((a, b) => b.href.length - a.href.length)[0]
  );
}

/**
 * The navigation section a settings path belongs to, so tabs and detail pages
 * highlight and name their parent section.
 */
export function resolveConfigSection(
  pathname: string,
): ConfigSection | undefined {
  const entry = configCatalogEntry(pathname);
  if (!entry?.parent) return entry;
  return configSections.find((section) => section.href === entry.parent);
}

export type ConfigSectionTab = { href: string; label: string; active: boolean };

/** Tabs shared by a section and the pages merged into it, if it has any. */
export function configSectionTabs(pathname: string): ConfigSectionTab[] {
  const entry = configCatalogEntry(pathname);
  if (!entry) return [];
  const root = entry.parent ?? entry.href;
  const entries: ConfigSection[] = configCatalog;
  const members = entries.filter(
    (section) => section.href === root || section.parent === root,
  );
  if (members.length < 2) return [];
  return members.map((section) => ({
    href: section.href,
    label: section.tabLabel ?? section.label,
    active: section.href === entry.href,
  }));
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
