import type { Config } from '../config';
import type { Repo } from '../repo';
import { GitlabAuth } from './auth';
import { GitlabSync } from './sync';

export interface Gitlab {
  auth: GitlabAuth;
  sync: GitlabSync;
}

export function createGitlab(repo: Repo, config: Config): Gitlab {
  const auth = new GitlabAuth(repo, config);
  return { auth, sync: new GitlabSync(repo, auth, config) };
}
