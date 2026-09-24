/**
 * The item's own page for a configuration reference. Diagnostics, search, and
 * history all use this so no surface sends the user to a list to search again.
 * A device key contains a slash (`zigbee2mqtt/hallway_lamp`), so it keeps its
 * slashes and each segment is escaped on its own.
 */
const SECTION_BY_ENTITY: Record<string, string> = {
  group: 'groups',
  scene: 'scenes',
  device: 'devices',
  routine: 'routines',
  integration: 'integrations',
  helper: 'helpers',
  source: 'sources',
};

export function configItemHref(entity: string, entityId: string): string {
  const encoded = encodeURIComponent(entityId);
  switch (entity) {
    case 'group':
    case 'scene':
    case 'routine':
    case 'helper':
    case 'source':
    case 'integration':
      return `/config/${SECTION_BY_ENTITY[entity]}/${encoded}`;
    case 'device':
      return `/config/devices/detail/${entityId
        .split('/')
        .map((part) => encodeURIComponent(part))
        .join('/')}`;
    default:
      return `/config?q=${encoded}`;
  }
}

export function isKnownEntity(entity: string): boolean {
  return entity in SECTION_BY_ENTITY || entity === 'device';
}
