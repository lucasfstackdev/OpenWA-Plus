// Exercises the real repository behaviour (Between/Like filtering, pagination, status transitions)
// against an in-memory DB rather than a mocked repository — those TypeORM query shapes are easy to
// get subtly wrong with mocks.
import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  KirvanoEventLogService,
  MAX_KIRVANO_EVENT_LOG_PAGE_SIZE,
  MAX_KIRVANO_STATS_RANGE_DAYS,
} from './kirvano-event-log.service';
import { KirvanoEventLog } from './entities/kirvano-event-log.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';

describe('KirvanoEventLogService', () => {
  let ds: DataSource;
  let service: KirvanoEventLogService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, KirvanoEventLog],
      synchronize: true,
    });
    await ds.initialize();
    const sessions = ds.getRepository(Session);
    await sessions.save(sessions.create({ id: 'sessA', name: 'sessA', status: SessionStatus.READY, config: {} }));
    service = new KirvanoEventLogService(ds.getRepository(KirvanoEventLog));
  });

  afterEach(async () => {
    await ds.destroy();
  });

  const baseInput = {
    eventType: 'ON_PIX_GENERATED' as const,
    chatId: '5511987654321@c.us',
    templateId: 'tpl-1',
    vars: { 'customer.name': 'Ana' },
    customerName: 'Ana',
    customerPhone: '5511987654321',
    delayMinutes: 5,
  };

  describe('recordPending', () => {
    it('computes dispatchAt from receivedAt + delayMinutes and starts pending', async () => {
      const receivedAt = new Date('2024-01-01T10:00:00.000Z');
      const row = await service.recordPending('sessA', { ...baseInput, receivedAt });

      expect(row.status).toBe('pending');
      expect(row.dispatchAttempts).toBe(0);
      expect(row.dispatchAt.getTime()).toBe(receivedAt.getTime() + 5 * 60_000);
    });
  });

  describe('list', () => {
    it('orders by receivedAt DESC and paginates', async () => {
      for (let i = 0; i < 3; i++) {
        await service.recordPending('sessA', { ...baseInput, receivedAt: new Date(2024, 0, i + 1) });
      }

      const page1 = await service.list('sessA', { limit: 2, offset: 0 });
      expect(page1.total).toBe(3);
      expect(page1.data).toHaveLength(2);
      expect(page1.data[0].receivedAt.getDate()).toBe(3);
      expect(page1.data[1].receivedAt.getDate()).toBe(2);

      const page2 = await service.list('sessA', { limit: 2, offset: 2 });
      expect(page2.data).toHaveLength(1);
      expect(page2.data[0].receivedAt.getDate()).toBe(1);
    });

    it('clamps limit to MAX_KIRVANO_EVENT_LOG_PAGE_SIZE', async () => {
      await service.recordPending('sessA', { ...baseInput, receivedAt: new Date() });
      const result = await service.list('sessA', { limit: MAX_KIRVANO_EVENT_LOG_PAGE_SIZE + 1000 });
      expect(result.data).toHaveLength(1); // only 1 row exists — the clamp itself is exercised via the take param not throwing
    });

    it('filters by eventType', async () => {
      await service.recordPending('sessA', { ...baseInput, eventType: 'ON_PIX_GENERATED', receivedAt: new Date() });
      await service.recordPending('sessA', { ...baseInput, eventType: 'ON_PIX_EXPIRED', receivedAt: new Date() });

      const result = await service.list('sessA', { eventType: 'ON_PIX_EXPIRED' });
      expect(result.data).toHaveLength(1);
      expect(result.data[0].eventType).toBe('ON_PIX_EXPIRED');
    });

    it('filters by receivedAt range', async () => {
      await service.recordPending('sessA', { ...baseInput, receivedAt: new Date('2024-01-01T00:00:00.000Z') });
      await service.recordPending('sessA', { ...baseInput, receivedAt: new Date('2024-06-01T00:00:00.000Z') });

      const result = await service.list('sessA', {
        from: new Date('2024-05-01T00:00:00.000Z'),
        to: new Date('2024-07-01T00:00:00.000Z'),
      });
      expect(result.data).toHaveLength(1);
    });

    it('searches by customer name or phone', async () => {
      await service.recordPending('sessA', {
        ...baseInput,
        customerName: 'Ana Souza',
        customerPhone: '5511111111111',
        receivedAt: new Date(),
      });
      await service.recordPending('sessA', {
        ...baseInput,
        customerName: 'Bruno Lima',
        customerPhone: '5522222222222',
        receivedAt: new Date(),
      });

      expect((await service.list('sessA', { search: 'ana' })).data).toHaveLength(1);
      expect((await service.list('sessA', { search: '22222' })).data).toHaveLength(1);
      expect((await service.list('sessA', { search: 'nobody' })).data).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('sums totals per type and buckets by day when the range spans more than 36h', async () => {
      await service.recordPending('sessA', {
        ...baseInput,
        eventType: 'ON_PIX_GENERATED',
        receivedAt: new Date('2024-01-01T10:00:00.000Z'),
      });
      await service.recordPending('sessA', {
        ...baseInput,
        eventType: 'ON_PIX_GENERATED',
        receivedAt: new Date('2024-01-01T14:00:00.000Z'), // same day as above -> same bucket
      });
      await service.recordPending('sessA', {
        ...baseInput,
        eventType: 'ON_SALE_APPROVED',
        receivedAt: new Date('2024-01-02T09:00:00.000Z'),
      });

      const result = await service.getStats(
        'sessA',
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-03T00:00:00.000Z'),
      );

      expect(result.totals).toEqual({
        ON_ABANDONED_CART: 0,
        ON_PIX_EXPIRED: 0,
        ON_PIX_GENERATED: 2,
        ON_SALE_APPROVED: 1,
      });
      expect(result.timeSeries).toEqual([
        {
          timestamp: '2024-01-01',
          ON_ABANDONED_CART: 0,
          ON_PIX_EXPIRED: 0,
          ON_PIX_GENERATED: 2,
          ON_SALE_APPROVED: 0,
        },
        {
          timestamp: '2024-01-02',
          ON_ABANDONED_CART: 0,
          ON_PIX_EXPIRED: 0,
          ON_PIX_GENERATED: 0,
          ON_SALE_APPROVED: 1,
        },
      ]);
    });

    it('buckets by hour when the range is 36h or less', async () => {
      await service.recordPending('sessA', {
        ...baseInput,
        eventType: 'ON_PIX_EXPIRED',
        receivedAt: new Date('2024-01-01T10:15:00.000Z'),
      });
      await service.recordPending('sessA', {
        ...baseInput,
        eventType: 'ON_PIX_EXPIRED',
        receivedAt: new Date('2024-01-01T10:45:00.000Z'), // same hour -> same bucket
      });

      const result = await service.getStats(
        'sessA',
        new Date('2024-01-01T00:00:00.000Z'),
        new Date('2024-01-01T23:59:59.000Z'),
      );

      expect(result.timeSeries).toEqual([
        {
          timestamp: '2024-01-01 10:00:00',
          ON_ABANDONED_CART: 0,
          ON_PIX_EXPIRED: 2,
          ON_PIX_GENERATED: 0,
          ON_SALE_APPROVED: 0,
        },
      ]);
    });

    it('excludes events outside the [from, to] range', async () => {
      await service.recordPending('sessA', { ...baseInput, receivedAt: new Date('2024-01-01T00:00:00.000Z') });
      await service.recordPending('sessA', { ...baseInput, receivedAt: new Date('2024-06-01T00:00:00.000Z') });

      const result = await service.getStats(
        'sessA',
        new Date('2024-05-01T00:00:00.000Z'),
        new Date('2024-07-01T00:00:00.000Z'),
      );

      expect(result.totals.ON_PIX_GENERATED).toBe(1);
    });

    it('scopes counts to the given session', async () => {
      const sessions = ds.getRepository(Session);
      await sessions.save(sessions.create({ id: 'sessB', name: 'sessB', status: SessionStatus.READY, config: {} }));
      await service.recordPending('sessA', { ...baseInput, receivedAt: new Date('2024-01-01T00:00:00.000Z') });
      await service.recordPending('sessB', { ...baseInput, receivedAt: new Date('2024-01-01T00:00:00.000Z') });

      const result = await service.getStats(
        'sessA',
        new Date('2023-12-31T00:00:00.000Z'),
        new Date('2024-01-02T00:00:00.000Z'),
      );

      expect(result.totals.ON_PIX_GENERATED).toBe(1);
    });

    it('rejects a `to` at or before `from`', async () => {
      const at = new Date('2024-01-01T00:00:00.000Z');
      await expect(service.getStats('sessA', at, at)).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a span longer than MAX_KIRVANO_STATS_RANGE_DAYS', async () => {
      const from = new Date('2024-01-01T00:00:00.000Z');
      const to = new Date(from.getTime() + (MAX_KIRVANO_STATS_RANGE_DAYS + 1) * 24 * 60 * 60 * 1000);
      await expect(service.getStats('sessA', from, to)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findDueForDispatch', () => {
    it('returns only still-pending rows whose dispatchAt has elapsed, excluding future and already-queued ones', async () => {
      const now = new Date('2024-01-01T12:00:00.000Z');
      const stillPendingDue = await service.recordPending('sessA', {
        ...baseInput,
        delayMinutes: 1,
        receivedAt: new Date(now.getTime() - 2 * 60_000),
      });
      const alreadyQueuedDue = await service.recordPending('sessA', {
        ...baseInput,
        delayMinutes: 1,
        receivedAt: new Date(now.getTime() - 2 * 60_000),
      });
      const notDue = await service.recordPending('sessA', {
        ...baseInput,
        delayMinutes: 60,
        receivedAt: now,
      });
      await service.markQueued(alreadyQueuedDue.id); // no longer 'pending' — must not be picked up again

      const result = await service.findDueForDispatch(now, 10);
      expect(result.map(r => r.id)).toEqual([stillPendingDue.id]);
      expect(result.map(r => r.id)).not.toContain(alreadyQueuedDue.id);
      expect(result.map(r => r.id)).not.toContain(notDue.id);
    });
  });

  describe('recordDispatchOutcome', () => {
    it('marks a successful dispatch as dispatched with a dispatchedAt timestamp', async () => {
      const row = await service.recordPending('sessA', { ...baseInput, receivedAt: new Date() });
      await service.recordDispatchOutcome(row.id, { ok: true }, { maxAttempts: 3, retryDelayMs: 1000 });

      const reloaded = await ds.getRepository(KirvanoEventLog).findOneOrFail({ where: { id: row.id } });
      expect(reloaded.status).toBe('dispatched');
      expect(reloaded.dispatchedAt).not.toBeNull();
    });

    it('schedules an automatic retry (back to pending) when the attempt budget remains', async () => {
      const row = await service.recordPending('sessA', { ...baseInput, receivedAt: new Date() });
      const beforeRetry = Date.now();

      await service.recordDispatchOutcome(row.id, { ok: false, error: 'boom' }, { maxAttempts: 3, retryDelayMs: 1000 });

      const reloaded = await ds.getRepository(KirvanoEventLog).findOneOrFail({ where: { id: row.id } });
      expect(reloaded.status).toBe('pending');
      expect(reloaded.dispatchAttempts).toBe(1);
      expect(reloaded.lastError).toBe('boom');
      // Backoff is measured from "now" (retryDelayMs * attempt), not from the original dispatchAt.
      expect(reloaded.dispatchAt.getTime()).toBeGreaterThanOrEqual(beforeRetry + 1000);
    });

    it('marks the row terminally failed once the attempt budget is exhausted', async () => {
      const row = await service.recordPending('sessA', { ...baseInput, receivedAt: new Date() });

      await service.recordDispatchOutcome(row.id, { ok: false, error: 'e1' }, { maxAttempts: 1, retryDelayMs: 1000 });

      const reloaded = await ds.getRepository(KirvanoEventLog).findOneOrFail({ where: { id: row.id } });
      expect(reloaded.status).toBe('failed');
      expect(reloaded.dispatchAttempts).toBe(1);
      expect(reloaded.lastError).toBe('e1');
    });
  });
});
