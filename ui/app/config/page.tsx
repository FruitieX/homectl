import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function ConfigPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate('/config/integrations', { replace: true });
  }, [navigate]);

  return (
    <div className="flex items-center justify-center h-full">
      <span className="loading loading-spinner loading-lg"></span>
    </div>
  );
}
