/**
 * Database schema shared by the SQLite and PostgreSQL dialects.
 * Portable choices: text ids, ISO-8601 text timestamps, JSON stored as text,
 * booleans avoided in favour of status columns.
 */
export interface UsersTable {
  id: string;
  display_name: string;
  email: string | null;
  created_at: string;
  deleted_at: string | null;
}

export interface SessionsTable {
  id: string;
  user_id: string;
  token_hash: string;
  created_at: string;
  last_seen_at: string;
}

export interface DeviceLinksTable {
  code_hash: string;
  user_id: string;
  expires_at: string;
}

export interface TeamsTable {
  id: string;
  name: string;
  invite_code: string;
  settings: string;
  created_at: string;
  created_by: string;
  class_id: string | null;
}

export interface MembershipsTable {
  team_id: string;
  user_id: string;
  role: string;
  joined_at: string;
}

export interface CharterItemsTable {
  id: string;
  team_id: string;
  kind: string;
  text: string;
  position: number;
  updated_at: string;
  updated_by: string | null;
}

export interface SprintsTable {
  id: string;
  team_id: string;
  name: string;
  goal: string;
  start_date: string | null;
  end_date: string | null;
  status: string;
  goal_met: string | null;
  capacity: string;
  created_at: string;
  closed_at: string | null;
  gitlab_milestone_id: string | null;
}

export interface StoriesTable {
  id: string;
  team_id: string;
  sprint_id: string | null;
  kind: string;
  title: string;
  as_a: string;
  i_want: string;
  so_that: string;
  acceptance_criteria: string;
  notes: string;
  estimate: string | null;
  status: string;
  invest: string;
  dor: string;
  external_url: string;
  tasks: string;
  owner_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  done_at: string | null;
  gitlab_iid: number | null;
  gitlab_estimate: string | null;
  gitlab_updated_at: string | null;
}

export interface ActionsTable {
  id: string;
  team_id: string;
  kind: string;
  text: string;
  owner_id: string | null;
  due_date: string | null;
  status: string;
  meeting_id: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface RisksTable {
  id: string;
  team_id: string;
  title: string;
  description: string;
  category: string;
  likelihood: number;
  impact: number;
  countermeasure: string;
  owner_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MeetingsTable {
  id: string;
  team_id: string;
  kind: string;
  title: string;
  sprint_id: string | null;
  facilitator_id: string;
  phase: string;
  state: string;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
}

export interface GitlabAccountsTable {
  user_id: string;
  gitlab_id: string;
  username: string;
  name: string;
  scopes: string;
  /** Encrypted. */
  access_token: string;
  /** Encrypted. */
  refresh_token: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OauthStatesTable {
  state_hash: string;
  verifier: string;
  purpose: string;
  user_id: string | null;
  return_to: string;
  created_at: string;
}

export interface ClassesTable {
  id: string;
  name: string;
  staff_code: string;
  settings: string;
  created_by: string;
  created_at: string;
}

export interface ClassStaffTable {
  class_id: string;
  user_id: string;
  role: string;
  added_at: string;
}

export interface ActivityTable {
  id: string;
  team_id: string;
  user_id: string | null;
  at: string;
  /** 'sprintwell' or 'gitlab'. */
  source: string;
  kind: string;
  summary: string;
  url: string;
  /** Unique key that stops the same thing being logged twice (e.g. a GitLab event id). */
  dedupe: string | null;
}

export interface TeamGitlabTable {
  team_id: string;
  project_id: string;
  path: string;
  web_url: string;
  /** Address of this Sprintwell server when the project was linked (needed to refresh tokens). */
  origin: string;
  linked_by: string;
  linked_at: string;
  last_sync_at: string | null;
  /** GitLab events newer than this have not been read yet. */
  events_after: string | null;
  /** 'weight', 'label' or 'unknown': where estimates go in this GitLab. */
  estimate_field: string;
}

export interface Database {
  users: UsersTable;
  sessions: SessionsTable;
  device_links: DeviceLinksTable;
  teams: TeamsTable;
  memberships: MembershipsTable;
  charter_items: CharterItemsTable;
  sprints: SprintsTable;
  stories: StoriesTable;
  actions: ActionsTable;
  risks: RisksTable;
  meetings: MeetingsTable;
  gitlab_accounts: GitlabAccountsTable;
  oauth_states: OauthStatesTable;
  classes: ClassesTable;
  class_staff: ClassStaffTable;
  activity: ActivityTable;
  team_gitlab: TeamGitlabTable;
}
