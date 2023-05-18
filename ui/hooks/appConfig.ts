'use client';

import { Config } from 'app/config/route';
import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useEffect, useState } from 'react';

const appConfigAtom = atom<Config | null>(null);

export const useProvideAppConfig = () => {
  const [loaded, setLoaded] = useState(false);
  const setConfig = useSetAtom(appConfigAtom);

  useEffect(() => {
    const performFetch = async () => {
      const res = await fetch('/config');
      const json = await res.json();
      setConfig(json);
      setLoaded(true);
    };

    performFetch().catch(console.error);
  }, [setConfig]);

  return loaded;
};

export const useAppConfig = (): Config => {
  const config = useAtomValue(appConfigAtom);

  if (config === null) {
    throw new Error(
      'Calling useAppConfig before config has loaded is a fatal error. Make sure your app waits for useProvideAppConfig to return true before rendering.',
    );
  }

  return config;
};
