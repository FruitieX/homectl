import { Link, useParams } from 'react-router-dom';
import { useAssistantPageContext } from '@/assistant/useAssistantPageContext';
import { useGroupsState } from '@/hooks/websocket';
import { Button } from '@/ui/primitives/button';
import { EmptyState } from '@/ui/primitives/empty-state';
import Viewport from '../map/Viewport';

/**
 * Room detail: the floorplan view with the group filter active and the room
 * controls sheet open. Replaces the old preview-plus-lists room page.
 */
export default function GroupViewport() {
  const { id } = useParams();
  const groups = useGroupsState();
  const group = id ? groups?.[id] : null;
  useAssistantPageContext(
    group && id ? { kind: 'group', id, label: group.name } : { kind: 'group' },
  );
  if (!groups)
    return (
      <p role="status" className="p-6 text-muted-foreground">
        Loading room…
      </p>
    );
  if (!group || !id)
    return (
      <EmptyState
        title="Room not found"
        action={
          <Button asChild>
            <Link to="/groups">Back to rooms</Link>
          </Button>
        }
      />
    );
  return <Viewport groupId={id} />;
}
