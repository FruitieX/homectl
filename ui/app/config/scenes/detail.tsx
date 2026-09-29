import { useParams } from 'react-router-dom';
import { SceneEditor } from './editor';
export default function SceneDetailPage() {
  const { id = '' } = useParams();
  return <SceneEditor key={id} id={id} />;
}
