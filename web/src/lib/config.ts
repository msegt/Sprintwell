import { useEffect, useState } from 'react';
import { api } from './api';

export interface PublicConfig {
  appName: string;
  version: string;
  donationUrl: string;
  sourceUrl: string;
  /** enabled: token verification, project tokens and webhooks; oauth: Sign in with GitLab as well. */
  gitlab: { enabled: boolean; url: string; oauth: boolean };
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
