import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { KirvanoIntegration } from './entities/kirvano-integration.entity';
import { constantTimeEqual } from '../../common/security/constantTimeEqual';
import { isUniqueConstraintError } from '../../common/utils/unique-constraint.util';
import { createLogger } from '../../common/services/logger.service';

@Injectable()
export class KirvanoTokenService {
  private readonly logger = createLogger('KirvanoTokenService');

  constructor(
    @InjectRepository(KirvanoIntegration, 'data')
    private readonly repository: Repository<KirvanoIntegration>,
  ) {}

  /** Idempotent: returns the session's existing token, or mints and persists one on first call. */
  async getOrCreateToken(sessionId: string): Promise<KirvanoIntegration> {
    const existing = await this.repository.findOne({ where: { sessionId } });
    if (existing) return existing;

    const created = this.repository.create({ sessionId, token: randomUUID() });
    try {
      return await this.repository.save(created);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        // Lost a create race for this sessionId — the other writer's row is now there.
        const winner = await this.repository.findOne({ where: { sessionId } });
        if (winner) return winner;
      }
      throw err;
    }
  }

  /** Overwrites the session's token with a fresh one, invalidating the old one immediately. */
  async regenerateToken(sessionId: string): Promise<KirvanoIntegration> {
    const current = await this.getOrCreateToken(sessionId);
    current.token = randomUUID();
    const saved = await this.repository.save(current);
    this.logger.log('Kirvano receiver token regenerated', { sessionId });
    return saved;
  }

  /**
   * Throws UnauthorizedException for a missing header, a session with no token configured yet, or a
   * mismatched token — all three cases look identical to the caller, so a probe can't learn whether a
   * sessionId even exists from the response.
   */
  async assertValidToken(sessionId: string, presented: string | undefined): Promise<void> {
    if (!presented) {
      throw new UnauthorizedException('Missing security-token header');
    }
    const row = await this.repository.findOne({ where: { sessionId } });
    if (!row || !constantTimeEqual(presented, row.token)) {
      throw new UnauthorizedException('Invalid Kirvano token');
    }
  }
}
