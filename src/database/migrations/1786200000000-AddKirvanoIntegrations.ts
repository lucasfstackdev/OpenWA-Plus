import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `kirvano_integrations` — one row per session holding the shared secret the Kirvano webhook
 * receiver compares against the `security-token` header. `sessionId` is the primary key (not
 * generated): a session either has a token or doesn't, there's nothing else to key on. CASCADE FK to
 * sessions: the token has no meaning after its session is gone. Hand-authored because `synchronize` is
 * off on the `data` connection for Postgres (and optional on SQLite).
 */
export class AddKirvanoIntegrations1786200000000 implements MigrationInterface {
  name = 'AddKirvanoIntegrations1786200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('kirvano_integrations')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `CREATE TABLE "kirvano_integrations" ("sessionId" varchar PRIMARY KEY NOT NULL, ` +
          `"token" varchar(64) NOT NULL, ` +
          `"createdAt" timestamp NOT NULL DEFAULT NOW(), "updatedAt" timestamp NOT NULL DEFAULT NOW(), ` +
          `CONSTRAINT "FK_kirvano_integrations_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE)`,
      );
    } else {
      await queryRunner.query(
        `CREATE TABLE "kirvano_integrations" ("sessionId" varchar PRIMARY KEY NOT NULL, ` +
          `"token" varchar(64) NOT NULL, ` +
          `"createdAt" datetime NOT NULL DEFAULT (datetime('now')), "updatedAt" datetime NOT NULL DEFAULT (datetime('now')), ` +
          `CONSTRAINT "FK_kirvano_integrations_sessionId" FOREIGN KEY ("sessionId") REFERENCES "sessions" ("id") ON DELETE CASCADE ON UPDATE NO ACTION)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "kirvano_integrations"`);
  }
}
