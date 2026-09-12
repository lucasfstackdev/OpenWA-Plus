import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `delayMinutes` to `kirvano_event_configs` — the time to wait between receiving a Kirvano
 * webhook and enqueuing the corresponding message for dispatch. Defaults to 1 so every existing config
 * row keeps behaving close to today's "dispatch immediately" behaviour without needing a backfill
 * decision. Hand-authored because `synchronize` is off on the `data` connection for Postgres (and
 * optional on SQLite), same reasoning as the table's own creation migration.
 */
export class AddKirvanoEventDelayMinutes1786300000000 implements MigrationInterface {
  name = 'AddKirvanoEventDelayMinutes1786300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasColumn('kirvano_event_configs', 'delayMinutes')) return;
    const isPostgres = queryRunner.dataSource.options.type === 'postgres';

    if (isPostgres) {
      await queryRunner.query(
        `ALTER TABLE "kirvano_event_configs" ADD COLUMN "delayMinutes" integer NOT NULL DEFAULT 1`,
      );
    } else {
      await queryRunner.query(
        `ALTER TABLE "kirvano_event_configs" ADD COLUMN "delayMinutes" integer NOT NULL DEFAULT (1)`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('kirvano_event_configs', 'delayMinutes'))) return;
    await queryRunner.query(`ALTER TABLE "kirvano_event_configs" DROP COLUMN "delayMinutes"`);
  }
}
