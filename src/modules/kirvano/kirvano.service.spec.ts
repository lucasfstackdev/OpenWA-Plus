// Exercises the real seeding/idempotency contract against an in-memory DB rather than a mocked
// repository: the interesting behaviour here is "first list seeds defaults exactly once" and
// "session scoping", both of which are easy to get subtly wrong with mocks.
import { DataSource } from 'typeorm';
import { NotFoundException } from '@nestjs/common';
import { KirvanoService } from './kirvano.service';
import { KIRVANO_EVENT_TYPES, KirvanoEventConfig } from './entities/kirvano-event-config.entity';
import { KIRVANO_DEFAULT_TEMPLATES } from './kirvano-default-templates';
import { TemplateService } from '../template/template.service';
import { Template } from '../template/entities/template.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';

describe('KirvanoService', () => {
  let ds: DataSource;
  let service: KirvanoService;
  let templateService: TemplateService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, Template, KirvanoEventConfig],
      synchronize: true,
    });
    await ds.initialize();
    const sessions = ds.getRepository(Session);
    for (const id of ['sessA', 'sessB']) {
      await sessions.save(sessions.create({ id, name: id, status: SessionStatus.READY, config: {} }));
    }
    templateService = new TemplateService(ds.getRepository(Template));
    service = new KirvanoService(ds.getRepository(KirvanoEventConfig), templateService);
  });

  afterEach(async () => {
    await ds.destroy();
  });

  describe('listEvents', () => {
    it('seeds all 4 events with their default template, enabled', async () => {
      const configs = await service.listEvents('sessA');

      expect(configs.map(c => c.eventType)).toEqual(KIRVANO_EVENT_TYPES);
      for (const config of configs) {
        expect(config.enabled).toBe(true);
        const template = await templateService.findOne('sessA', config.templateId);
        expect(template.name).toBe(KIRVANO_DEFAULT_TEMPLATES[config.eventType].name);
        expect(template.body).toBe(KIRVANO_DEFAULT_TEMPLATES[config.eventType].body);
      }
    });

    it('is idempotent: a second call returns the same rows without creating duplicate templates', async () => {
      const first = await service.listEvents('sessA');
      const second = await service.listEvents('sessA');

      expect(second.map(c => c.id)).toEqual(first.map(c => c.id));
      expect(second.map(c => c.templateId)).toEqual(first.map(c => c.templateId));
      expect(await templateService.findBySession('sessA')).toHaveLength(4);
    });

    it('scopes seeding independently per session', async () => {
      await service.listEvents('sessA');
      const bConfigs = await service.listEvents('sessB');

      expect(bConfigs.every(c => c.sessionId === 'sessB')).toBe(true);
      expect(await templateService.findBySession('sessB')).toHaveLength(4);
    });
  });

  describe('updateEvent', () => {
    it('toggles enabled', async () => {
      await service.listEvents('sessA');
      const updated = await service.updateEvent('sessA', 'ON_PIX_GENERATED', { enabled: false });
      expect(updated.enabled).toBe(false);
    });

    it('switches to another existing template in the same session', async () => {
      await service.listEvents('sessA');
      const custom = await templateService.create('sessA', { name: 'my-custom', body: 'Hi {{customer.name}}' });

      const updated = await service.updateEvent('sessA', 'ON_PIX_GENERATED', { templateId: custom.id });
      expect(updated.templateId).toBe(custom.id);
    });

    it('rejects an unknown event type', async () => {
      await expect(service.updateEvent('sessA', 'NOT_A_REAL_EVENT', {})).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a templateId from another session', async () => {
      await service.listEvents('sessA');
      const otherSessionTemplate = await templateService.create('sessB', { name: 'not-mine', body: 'x' });

      await expect(
        service.updateEvent('sessA', 'ON_PIX_GENERATED', { templateId: otherSessionTemplate.id }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
