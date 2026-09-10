// Uses a fake clock (`now`/`sleep` swapped on the instance — see the service's test-seam comment)
// instead of real timers: the pacing logic is asserted by how far the fake clock advances, not by
// actually waiting 5+ seconds per test.
import { KirvanoDispatchQueueService, KirvanoDispatchJob } from './kirvano-dispatch-queue.service';
import type { MessageService } from '../message/message.service';

async function flush(turns = 50): Promise<void> {
  for (let i = 0; i < turns; i++) await Promise.resolve();
}

function job(overrides: Partial<KirvanoDispatchJob> = {}): KirvanoDispatchJob {
  return { chatId: '5511999999999@c.us', templateId: 'tpl-1', vars: {}, eventType: 'ON_PIX_GENERATED', ...overrides };
}

describe('KirvanoDispatchQueueService', () => {
  let clock: number;
  let sendTemplate: jest.Mock;
  let sendTimes: number[];
  let service: KirvanoDispatchQueueService;

  beforeEach(() => {
    clock = 0;
    sendTimes = [];
    sendTemplate = jest.fn().mockImplementation(() => {
      sendTimes.push(clock);
      return Promise.resolve({ messageId: 'wamid.x', timestamp: clock });
    });
    service = new KirvanoDispatchQueueService({ sendTemplate } as unknown as MessageService);
    service.now = () => clock;
    service.sleep = (ms: number) => {
      clock += ms;
      return Promise.resolve();
    };
  });

  it('sends the first two jobs for a session immediately, without waiting', async () => {
    service.enqueue('sessA', job());
    service.enqueue('sessA', job());
    await flush();

    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(sendTimes).toEqual([0, 0]);
    expect(clock).toBe(0);
  });

  it('queues a 3rd job in the same session until the 5s window frees up', async () => {
    service.enqueue('sessA', job());
    service.enqueue('sessA', job());
    service.enqueue('sessA', job());
    await flush();

    expect(sendTemplate).toHaveBeenCalledTimes(3);
    expect(sendTimes).toEqual([0, 0, 5000]);
  });

  it('passes chatId/templateId/vars through to MessageService.sendTemplate', async () => {
    service.enqueue(
      'sessA',
      job({ chatId: '5511988887777@c.us', templateId: 'tpl-xyz', vars: { 'customer.name': 'Ana' } }),
    );
    await flush();

    expect(sendTemplate).toHaveBeenCalledWith('sessA', {
      chatId: '5511988887777@c.us',
      templateId: 'tpl-xyz',
      vars: { 'customer.name': 'Ana' },
    });
  });

  it('keeps each session on its own independent window', async () => {
    // Drain sessA's window fully (2 immediate + 1 delayed to t=5000).
    service.enqueue('sessA', job());
    service.enqueue('sessA', job());
    service.enqueue('sessA', job());
    await flush();
    expect(clock).toBe(5000);

    // sessB has no history of its own — its first send must not inherit sessA's window.
    service.enqueue('sessB', job());
    await flush();

    expect(sendTemplate).toHaveBeenLastCalledWith('sessB', expect.anything());
    expect(clock).toBe(5000); // no further wait was needed
  });

  it('keeps draining the queue after one job fails to send', async () => {
    sendTemplate.mockImplementationOnce(() => Promise.reject(new Error('session offline')));

    service.enqueue('sessA', job());
    service.enqueue('sessA', job());
    await flush();

    expect(sendTemplate).toHaveBeenCalledTimes(2);
  });
});
