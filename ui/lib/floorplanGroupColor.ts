const hashGroupId = (groupId: string) => {
  let hash = 0;
  for (let index = 0; index < groupId.length; index += 1) {
    hash = (hash * 31 + groupId.charCodeAt(index)) % 360;
  }
  return hash;
};

export const getFloorplanGroupFill = (groupId: string, alpha = 0.22) => {
  const hue = hashGroupId(groupId);
  return `hsla(${hue}, 72%, 55%, ${alpha})`;
};

export const getFloorplanGroupStroke = (groupId: string, alpha = 0.85) => {
  const hue = hashGroupId(groupId);
  return `hsla(${hue}, 78%, 28%, ${alpha})`;
};