import { KirvanoEventLogSweeperService } from './kirvano-event-log-sweeper.service';
import type { KirvanoEventLogService } from './kirvano-event-log.service';
import type { KirvanoDispatchQueueService, KirvanoDispatchJob } from './kirvano-dispatch-queue.service';
import type { KirvanoEventLog } from './entities/kirvano-event-log.entity';

function row(overrides: Partial<KirvanoEventLog> = {}): KirvanoEventLog {
  return {
    id: 'log-1',
    sessionId: 'sessA',
    eventType: 'ON_PIX_GENERATED',
    receivedAt: new Date(),
    dispatchAt: new Date(),
    status: 'pending',
    customerName: 'Ana',
    customerPhone: '5511999999999',
    chatId: '5511999999999@c.us',
    templateId: 'tpl-1',
    vars: { 'customer.name': 'Ana' },
    dispatchAttempts: 0,
    lastError: null,
    dispatchedAt: null,
    createdAt: new Date(),
    ...overrides,
  } as KirvanoEventLog;
}

const opts = { intervalMs: 5000, maxAttempts: 3, retryDelayMs: 1000 };

describe('KirvanoEventLogSweeperService', () => {
  let eventLogService: {
    findDueForDispatch: jest.Mock;
    markQueued: jest.Mock;
    recordDispatchOutcome: jest.Mock;
  };
  let dispatchQueue: { enqueue: jest.Mock };
  let service: KirvanoEventLogSweeperService;

  beforeEach(() => {
    eventLogService = {
      findDueForDispatch: jest.fn().mockResolvedValue([]),
      markQueued: jest.fn().mockResolvedValue(undefined),
      recordDispatchOutcome: jest.fn().mockResolvedValue(undefined),
    };
    dispatchQueue = { enqueue: jest.fn() };
    service = new KirvanoEventLogSweeperService(
      eventLogService as unknown as KirvanoEventLogService,
      dispatchQueue as unknown as KirvanoDispatchQueueService,
    );
  });

  it('does nothing when no row is due', async () => {
    await service.sweep(opts);
    expect(dispatchQueue.enqueue).not.toHaveBeenCalled();
  });

  it('marks a due row queued before enqueueing it, with the job rehydrated from the row', async () => {
    const due = row();
    eventLogService.findDueForDispatch.mockResolvedValue([due]);

    await service.sweep(opts);

    expect(eventLogService.markQueued).toHaveBeenCalledWith('log-1');
    expect(dispatchQueue.enqueue).toHaveBeenCalledWith(
      'sessA',
      expect.objectContaining({
        chatId: '5511999999999@c.us',
        templateId: 'tpl-1',
        vars: { 'customer.name': 'Ana' },
        eventType: 'ON_PIX_GENERATED',
      }),
    );
  });

  it('records a successful outcome via onSettled', async () => {
    eventLogService.findDueForDispatch.mockResolvedValue([row()]);
    let capturedJob: KirvanoDispatchJob | undefined;
    dispatchQueue.enqueue.mockImplementation((_sessionId: string, job: KirvanoDispatchJob) => {
      capturedJob = job;
    });

    await service.sweep(opts);
    capturedJob?.onSettled?.({ outcome: 'sent' });
    await Promise.resolve();

    expect(eventLogService.recordDispatchOutcome).toHaveBeenCalledWith(
      'log-1',
      { ok: true },
      { maxAttempts: 3, retryDelayMs: 1000 },
    );
  });

  it('records a failed outcome via onSettled', async () => {
    eventLogService.findDueForDispatch.mockResolvedValue([row()]);
    let capturedJob: KirvanoDispatchJob | undefined;
    dispatchQueue.enqueue.mockImplementation((_sessionId: string, job: KirvanoDispatchJob) => {
      capturedJob = job;
    });

    await service.sweep(opts);
    capturedJob?.onSettled?.({ outcome: 'failed', error: 'session offline' });
    await Promise.resolve();

    expect(eventLogService.recordDispatchOutcome).toHaveBeenCalledWith(
      'log-1',
      { ok: false, error: 'session offline' },
      { maxAttempts: 3, retryDelayMs: 1000 },
    );
  });

  it('does not run a second sweep pass concurrently with one already in progress', async () => {
    let resolveFind: (rows: KirvanoEventLog[]) => void = () => {};
    eventLogService.findDueForDispatch.mockReturnValue(
      new Promise(resolve => {
        resolveFind = resolve;
      }),
    );

    const first = service.sweep(opts);
    const second = service.sweep(opts); // fires while `first` is still awaiting findDueForDispatch

    resolveFind([]);
    await Promise.all([first, second]);

    expect(eventLogService.findDueForDispatch).toHaveBeenCalledTimes(1);
  });
});
