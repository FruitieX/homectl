import { useParams } from 'react-router-dom';
import { RoutineEditor } from './editor';
export default function RoutineDetailPage() {
  const { id } = useParams();
  return <RoutineEditor key={id} id={id} />;
}
