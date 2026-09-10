import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { KIRVANO_EVENT_TYPES, KirvanoEventConfig, KirvanoEventType } from './entities/kirvano-event-config.entity';
import { KIRVANO_DEFAULT_TEMPLATES } from './kirvano-default-templates';
import { UpdateKirvanoEventConfigDto } from './dto';
import { TemplateService } from '../template/template.service';
import { createLogger } from '../../common/services/logger.service';

@Injectable()
export class KirvanoService {
  private readonly logger = createLogger('KirvanoService');

  constructor(
    @InjectRepository(KirvanoEventConfig, 'data')
    private readonly repository: Repository<KirvanoEventConfig>,
    private readonly templateService: TemplateService,
  ) {}

  /**
   * Returns the session's 4 Kirvano event configs, in fixed event order. The first call for a given
   * session lazily creates the default template + config row for any event that doesn't have one yet
   * — this is the "already selected the default" behaviour the dashboard card expects on first load.
   */
  async listEvents(sessionId: string): Promise<KirvanoEventConfig[]> {
    const configs: KirvanoEventConfig[] = [];
    for (const eventType of KIRVANO_EVENT_TYPES) {
      configs.push(await this.ensureConfig(sessionId, eventType));
    }
    return configs;
  }

  async updateEvent(
    sessionId: string,
    eventType: string,
    dto: UpdateKirvanoEventConfigDto,
  ): Promise<KirvanoEventConfig> {
    const validEventType = this.assertValidEventType(eventType);
    const config = await this.ensureConfig(sessionId, validEventType);

    if (dto.templateId !== undefined) {
      // Throws NotFoundException if the template doesn't exist or belongs to another session.
      await this.templateService.findOne(sessionId, dto.templateId);
      config.templateId = dto.templateId;
    }
    if (dto.enabled !== undefined) {
      config.enabled = dto.enabled;
    }

    const saved = await this.repository.save(config);
    this.logger.log('Kirvano event config updated', { sessionId, eventType: validEventType });
    return saved;
  }

  private assertValidEventType(eventType: string): KirvanoEventType {
    if (!(KIRVANO_EVENT_TYPES as string[]).includes(eventType)) {
      throw new NotFoundException(`Unknown Kirvano event type '${eventType}'`);
    }
    return eventType as KirvanoEventType;
  }

  private async ensureConfig(sessionId: string, eventType: KirvanoEventType): Promise<KirvanoEventConfig> {
    const existing = await this.repository.findOne({ where: { sessionId, eventType } });
    if (existing) {
      return existing;
    }

    const template = await this.ensureDefaultTemplate(sessionId, eventType);
    const created = this.repository.create({ sessionId, eventType, templateId: template.id, enabled: true });

    try {
      return await this.repository.save(created);
    } catch {
      // Lost a create race for this (sessionId, eventType) pair (unique index) — the other writer's
      // row is now there, so just return it.
      const winner = await this.repository.findOne({ where: { sessionId, eventType } });
      if (winner) return winner;
      throw new NotFoundException(`Could not create or find Kirvano config for event '${eventType}'`);
    }
  }

  private async ensureDefaultTemplate(sessionId: string, eventType: KirvanoEventType) {
    const { name, body } = KIRVANO_DEFAULT_TEMPLATES[eventType];
    try {
      return await this.templateService.create(sessionId, { name, body });
    } catch (err) {
      if (err instanceof ConflictException) {
        // A default template with this name already exists for the session (created by a previous
        // call, or manually) — reuse it instead of failing.
        return this.templateService.resolve(sessionId, { templateName: name });
      }
      throw err;
    }
  }
}
