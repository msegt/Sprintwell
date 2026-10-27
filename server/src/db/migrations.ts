import type { Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/**
 * Migrations are written with Kysely's schema builder so the same code runs on
 * SQLite and PostgreSQL. Never edit a migration that has shipped: add a new one.
 */
export const migrations: Record<string, Migration> = {
  '001_initial': {
    async up(db: Kysely<any>) {
      await db.schema
        .createTable('users')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('display_name', 'text', (c) => c.notNull())
        .addColumn('email', 'text', (c) => c.unique())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('deleted_at', 'text')
        .execute();

      await db.schema
        .createTable('sessions')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('token_hash', 'text', (c) => c.notNull().unique())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('last_seen_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('device_links')
        .addColumn('code_hash', 'text', (c) => c.primaryKey())
        .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('expires_at', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('teams')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('invite_code', 'text', (c) => c.notNull().unique())
        .addColumn('settings', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('created_by', 'text', (c) => c.notNull())
        .execute();

      await db.schema
        .createTable('memberships')
        .addColumn('team_id', 'text', (c) => c.notNull().references('teams.id').onDelete('cascade'))
        .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('role', 'text', (c) => c.notNull())
        .addColumn('joined_at', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('memberships_pk', ['team_id', 'user_id'])
        .execute();
      await db.schema.createIndex('memberships_user_idx').on('memberships').column('user_id').execute();

      const teamChild = (name: string) =>
        db.schema
          .createTable(name)
          .addColumn('id', 'text', (c) => c.primaryKey())
          .addColumn('team_id', 'text', (c) => c.notNull().references('teams.id').onDelete('cascade'));

      await teamChild('charter_items')
        .addColumn('kind', 'text', (c) => c.notNull())
        .addColumn('text', 'text', (c) => c.notNull())
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('updated_at', 'text', (c) => c.notNull())
        .addColumn('updated_by', 'text')
        .execute();

      await teamChild('sprints')
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('goal', 'text', (c) => c.notNull())
        .addColumn('start_date', 'text')
        .addColumn('end_date', 'text')
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('goal_met', 'text')
        .addColumn('capacity', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('closed_at', 'text')
        .execute();

      await teamChild('stories')
        .addColumn('sprint_id', 'text')
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('as_a', 'text', (c) => c.notNull())
        .addColumn('i_want', 'text', (c) => c.notNull())
        .addColumn('so_that', 'text', (c) => c.notNull())
        .addColumn('acceptance_criteria', 'text', (c) => c.notNull())
        .addColumn('notes', 'text', (c) => c.notNull())
        .addColumn('estimate', 'text')
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('invest', 'text', (c) => c.notNull())
        .addColumn('dor', 'text', (c) => c.notNull())
        .addColumn('external_url', 'text', (c) => c.notNull())
        .addColumn('tasks', 'text', (c) => c.notNull())
        .addColumn('owner_id', 'text')
        .addColumn('position', 'integer', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('updated_at', 'text', (c) => c.notNull())
        .addColumn('done_at', 'text')
        .execute();

      await teamChild('actions')
        .addColumn('kind', 'text', (c) => c.notNull())
        .addColumn('text', 'text', (c) => c.notNull())
        .addColumn('owner_id', 'text')
        .addColumn('due_date', 'text')
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('meeting_id', 'text')
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('completed_at', 'text')
        .execute();

      await teamChild('risks')
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('description', 'text', (c) => c.notNull())
        .addColumn('category', 'text', (c) => c.notNull())
        .addColumn('likelihood', 'integer', (c) => c.notNull())
        .addColumn('impact', 'integer', (c) => c.notNull())
        .addColumn('countermeasure', 'text', (c) => c.notNull())
        .addColumn('owner_id', 'text')
        .addColumn('status', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('updated_at', 'text', (c) => c.notNull())
        .execute();

      await teamChild('meetings')
        .addColumn('kind', 'text', (c) => c.notNull())
        .addColumn('title', 'text', (c) => c.notNull())
        .addColumn('sprint_id', 'text')
        .addColumn('facilitator_id', 'text', (c) => c.notNull())
        .addColumn('phase', 'text', (c) => c.notNull())
        .addColumn('state', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('updated_at', 'text', (c) => c.notNull())
        .addColumn('ended_at', 'text')
        .execute();

      for (const table of ['charter_items', 'sprints', 'stories', 'actions', 'risks', 'meetings']) {
        await db.schema.createIndex(`${table}_team_idx`).on(table).column('team_id').execute();
      }
      await db.schema.createIndex('sessions_user_idx').on('sessions').column('user_id').execute();
    },
  },

  '002_story_kind': {
    async up(db: Kysely<any>) {
      await db.schema
        .alterTable('stories')
        .addColumn('kind', 'text', (c) => c.notNull().defaultTo('story'))
        .execute();
    },
  },

  '003_gitlab_accounts': {
    async up(db: Kysely<any>) {
      // One GitLab identity per person. Tokens are stored encrypted (AES-256-GCM).
      await db.schema
        .createTable('gitlab_accounts')
        .addColumn('user_id', 'text', (c) => c.primaryKey().references('users.id').onDelete('cascade'))
        .addColumn('gitlab_id', 'text', (c) => c.notNull().unique())
        .addColumn('username', 'text', (c) => c.notNull())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('scopes', 'text', (c) => c.notNull())
        .addColumn('access_token', 'text', (c) => c.notNull())
        .addColumn('refresh_token', 'text')
        .addColumn('expires_at', 'text')
        .addColumn('created_at', 'text', (c) => c.notNull())
        .addColumn('updated_at', 'text', (c) => c.notNull())
        .execute();
      // Short-lived OAuth "state" values that tie a GitLab redirect back to the request that started it.
      await db.schema
        .createTable('oauth_states')
        .addColumn('state_hash', 'text', (c) => c.primaryKey())
        .addColumn('verifier', 'text', (c) => c.notNull())
        .addColumn('purpose', 'text', (c) => c.notNull())
        .addColumn('user_id', 'text')
        .addColumn('return_to', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();
    },
  },

  '004_classes_activity': {
    async up(db: Kysely<any>) {
      // A class groups teams run by teaching staff (e.g. one cohort of a module).
      await db.schema
        .createTable('classes')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('name', 'text', (c) => c.notNull())
        .addColumn('staff_code', 'text', (c) => c.notNull().unique())
        .addColumn('settings', 'text', (c) => c.notNull())
        .addColumn('created_by', 'text', (c) => c.notNull())
        .addColumn('created_at', 'text', (c) => c.notNull())
        .execute();
      await db.schema
        .createTable('class_staff')
        .addColumn('class_id', 'text', (c) => c.notNull().references('classes.id').onDelete('cascade'))
        .addColumn('user_id', 'text', (c) => c.notNull().references('users.id').onDelete('cascade'))
        .addColumn('role', 'text', (c) => c.notNull())
        .addColumn('added_at', 'text', (c) => c.notNull())
        .addPrimaryKeyConstraint('class_staff_pk', ['class_id', 'user_id'])
        .execute();
      await db.schema.createIndex('class_staff_user_idx').on('class_staff').column('user_id').execute();
      await db.schema.alterTable('teams').addColumn('class_id', 'text').execute();
      await db.schema.createIndex('teams_class_idx').on('teams').column('class_id').execute();

      // Who did what in a team, for the team itself and its teaching staff.
      await db.schema
        .createTable('activity')
        .addColumn('id', 'text', (c) => c.primaryKey())
        .addColumn('team_id', 'text', (c) => c.notNull().references('teams.id').onDelete('cascade'))
        .addColumn('user_id', 'text')
        .addColumn('at', 'text', (c) => c.notNull())
        .addColumn('source', 'text', (c) => c.notNull())
        .addColumn('kind', 'text', (c) => c.notNull())
        .addColumn('summary', 'text', (c) => c.notNull())
        .addColumn('url', 'text', (c) => c.notNull())
        .addColumn('dedupe', 'text', (c) => c.unique())
        .execute();
      await db.schema.createIndex('activity_team_at_idx').on('activity').columns(['team_id', 'at']).execute();
    },
  },

  '005_gitlab_sync': {
    async up(db: Kysely<any>) {
      // The GitLab project a team works in.
      await db.schema
        .createTable('team_gitlab')
        .addColumn('team_id', 'text', (c) => c.primaryKey().references('teams.id').onDelete('cascade'))
        .addColumn('project_id', 'text', (c) => c.notNull())
        .addColumn('path', 'text', (c) => c.notNull())
        .addColumn('web_url', 'text', (c) => c.notNull())
        .addColumn('origin', 'text', (c) => c.notNull())
        .addColumn('linked_by', 'text', (c) => c.notNull())
        .addColumn('linked_at', 'text', (c) => c.notNull())
        .addColumn('last_sync_at', 'text')
        .addColumn('events_after', 'text')
        .addColumn('estimate_field', 'text', (c) => c.notNull().defaultTo('unknown'))
        .execute();
      await db.schema.alterTable('stories').addColumn('gitlab_iid', 'integer').execute();
      // The estimate GitLab last had, so sync knows what changed on which side.
      await db.schema.alterTable('stories').addColumn('gitlab_estimate', 'text').execute();
      await db.schema.alterTable('stories').addColumn('gitlab_updated_at', 'text').execute();
      await db.schema.createIndex('stories_gitlab_idx').on('stories').columns(['team_id', 'gitlab_iid']).execute();
      await db.schema.alterTable('sprints').addColumn('gitlab_milestone_id', 'text').execute();
    },
  },

  '006_oauth_nonce_sync_cursor': {
    async up(db: Kysely<any>) {
      // Ties a GitLab sign-in to the browser that started it.
      await db.schema.alterTable('oauth_states').addColumn('nonce_hash', 'text').execute();
      // Where the next issue import continues when one sync could not read everything.
      await db.schema.alterTable('team_gitlab').addColumn('issues_after', 'text').execute();
    },
  },
};
