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
  description: string;
  group: ConfigSectionGroup;
  href: string;
  label: string;
  keywords: string[];
};

export const configSections = [
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
    icon: Lightbulb,
    label: 'Devices',
    description: 'Name, inspect, and organize your devices and sensors.',
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
    icon: LayoutDashboard,
    label: 'Dashboards',
    description: 'Manage layouts and the widgets shown on each display.',
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
    icon: Radio,
    label: 'Sensor catalog',
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
    icon: ShieldAlert,
    label: 'Check for problems',
    description: 'Find broken links and get a next step for each issue.',
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
    icon: History,
    label: 'Routine activity',
    description: 'See what ran, what was blocked and the recorded reasons.',
    group: 'System',
    keywords: ['history', 'audit', 'why', 'trace', 'trigger', 'diagnostics'],
  },
  {
    href: '/config/sensor-history',
    icon: Activity,
    label: 'Sensor activity',
    description: 'Inspect recorded value changes across your sensors.',
    group: 'System',
    keywords: ['sensor', 'history', 'changes', 'events'],
  },
  {
    href: '/config/logs',
    icon: ScrollText,
    label: 'Logs',
    description: 'Inspect technical events when troubleshooting.',
    group: 'System',
    keywords: ['events', 'diagnostics', 'debug', 'errors'],
  },
  {
    href: '/config/import-export',
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
