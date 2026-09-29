import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `kirvano_event_logs` — one row per Kirvano webhook event received, persisted before the
 * delayed dispatch it feeds (pending -> queued -> dispatched, or pending -> ... -> failed once the
 * retry budget is exhausted). `vars`/`chatId`/`templateId` let the sweeper re-hydrate the dispatch job
 * without re-reading the original webhook payload. CASCADE FK to sessions: the log entry has no
 * meaning after its session is gone. Hand-authored because `synchronize` is off on the `data`
 * connection for Postgres (and optional on SQLite), same reasoning as the sibling Kirvano migrations.
 */
export class AddKirvanoEventLogs1786400000000 implements MigrationInterface {
  name = 'AddKirvanoEventLogs1786400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('kirvano_event_logs')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "kirvano_event_logs" ("id" varchar PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::varchar, ` +
          `"sessionId" varchar NOT NULL, "eventType" varchar(40) NOT NULL, ` +
          `"receivedAt" timestamp NOT NULL, "dispatchAt" timestamp NOT NULL, ` +
          `"status" varchar(20) NOT NULL DEFAULT 'pending', ` +
          `"customerName" varchar NULL, "customerPhone" varchar NULL, ` +
          `"chatId" varchar NOT NULL, "templateId" varchar NOT NULL, "vars" text NOT NULL, ` +
          `"dispatchAttempts" integer NOT NULL DEFAULT 0, "lastError" varchar NULL, "dispatchedAt" timestamp NULL, ` +
          `"createdAt" timestamp NOT NULL DEFAULT NOW(), ` +
          `CONSTRAINT "FK_kirvano_event_logs_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE)`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "kirvano_event_logs" ("id" varchar PRIMARY KEY NOT NULL, ` +
          `"sessionId" varchar NOT NULL, "eventType" varchar(40) NOT NULL, ` +
          `"receivedAt" text NOT NULL, "dispatchAt" text NOT NULL, ` +
          `"status" varchar(20) NOT NULL DEFAULT 'pending', ` +
          `"customerName" varchar NULL, "customerPhone" varchar NULL, ` +
          `"chatId" varchar NOT NULL, "templateId" varchar NOT NULL, "vars" text NOT NULL, ` +
          `"dispatchAttempts" integer NOT NULL DEFAULT (0), "lastError" varchar NULL, "dispatchedAt" text NULL, ` +
          `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `CONSTRAINT "FK_kirvano_event_logs_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
      );
    }

    await queryRunner.query(
      `CREATE INDEX "IDX_kirvano_event_logs_session_received" ON "kirvano_event_logs" ("sessionId", "receivedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_kirvano_event_logs_status_dispatchAt" ON "kirvano_event_logs" ("status", "dispatchAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // IF EXISTS so revert is idempotent on a synchronize-bootstrapped DB, where this migration was
    // recorded via the up() hasTable early-return and the named indexes were never created.
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kirvano_event_logs_status_dispatchAt"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_kirvano_event_logs_session_received"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "kirvano_event_logs"`);
  }
}
