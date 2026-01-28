'use client';

import { redirect } from 'next/navigation';
import { useEffect } from 'react';

export default function ConfigPage() {
  useEffect(() => {
    redirect('/config/integrations');
  }, []);

  return (
    <div className="flex items-center justify-center h-full">
      <span className="loading loading-spinner loading-lg"></span>
    </div>
  );
}
