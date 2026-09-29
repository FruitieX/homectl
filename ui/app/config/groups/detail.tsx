import { useParams } from 'react-router-dom';
import { GroupEditor } from './editor';
export default function GroupDetailPage() {
  const { id = '' } = useParams();
  return <GroupEditor key={id} id={id} />;
}
