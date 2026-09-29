import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `kirvano_event_configs` — per-session mapping of a Kirvano checkout webhook event to the
 * message template that should be sent for it, and whether the event is active. `templateId` is not
 * a DB-level FK (it points into `templates`, owned by a separate module) — resolved and validated in
 * application code instead, same reasoning as leaving `webhooks.filters` as plain JSON. CASCADE FK to
 * sessions: the config has no meaning after its session is gone. Hand-authored because `synchronize`
 * is off on the `data` connection for Postgres (and optional on SQLite).
 */
export class AddKirvanoEventConfigs1786100000000 implements MigrationInterface {
  name = 'AddKirvanoEventConfigs1786100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('kirvano_event_configs')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "kirvano_event_configs" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
          `"sessionId" varchar NOT NULL, "eventType" varchar(40) NOT NULL, "templateId" varchar NOT NULL, ` +
          `"enabled" boolean NOT NULL DEFAULT true, ` +
          `"createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW(), ` +
          `CONSTRAINT "FK_kirvano_event_configs_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE)`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "kirvano_event_configs" ("id" varchar PRIMARY KEY NOT NULL, ` +
          `"sessionId" varchar NOT NULL, "eventType" varchar(40) NOT NULL, "templateId" varchar NOT NULL, ` +
          `"enabled" boolean NOT NULL DEFAULT (1), ` +
          `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `CONSTRAINT "FK_kirvano_event_configs_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
      );
    }

    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_kirvano_event_configs_session_event" ON "kirvano_event_configs" ("sessionId", "eventType")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IF EXISTS so revert is idempotent on a synchronize-bootstrapped DB, where this migration was
    // recorded via the up() hasTable early-return and the named index was never created.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kirvano_event_configs_session_event"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kirvano_event_configs"`);
  }
}
