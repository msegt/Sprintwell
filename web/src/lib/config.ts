import { useEffect, useState } from 'react';
import { api } from './api';

export interface PublicConfig {
  appName: string;
  version: string;
  donationUrl: string;
  sourceUrl: string;
  gitlab: { enabled: boolean; url: string };
}

let cached: Promise<PublicConfig> | null = null;

/** Server settings that the web app needs (loaded once per page load). */
export function usePublicConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    cached ??= api<PublicConfig>('GET', '/api/config').catch((e) => {
      cached = null;
      throw e;
    });
    let live = true;
    cached.then((c) => live && setConfig(c), () => undefined);
    return () => {
      live = false;
    };
  }, []);
  return config;
}
