'use client';

import dynamicImport from 'next/dynamic';
const NoSSRViewport = dynamicImport(() => import('./Viewport'), { ssr: false });

export default function Page() {
  return (
    <>
      <NoSSRViewport />
    </>
  );
}
