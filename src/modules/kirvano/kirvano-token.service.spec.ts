import { DataSource } from 'typeorm';
import { UnauthorizedException } from '@nestjs/common';
import { KirvanoTokenService } from './kirvano-token.service';
import { KirvanoIntegration } from './entities/kirvano-integration.entity';
import { Session, SessionStatus } from '../session/entities/session.entity';

describe('KirvanoTokenService', () => {
  let ds: DataSource;
  let service: KirvanoTokenService;

  beforeEach(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Session, KirvanoIntegration],
      synchronize: true,
    });
    await ds.initialize();
    const sessions = ds.getRepository(Session);
    for (const id of ['sessA', 'sessB']) {
      await sessions.save(sessions.create({ id, name: id, status: SessionStatus.READY, config: {} }));
    }
    service = new KirvanoTokenService(ds.getRepository(KirvanoIntegration));
  });

  afterEach(async () => {
    await ds.destroy();
  });

  describe('getOrCreateToken', () => {
    it('mints a token on first call and returns the same one on later calls', async () => {
      const first = await service.getOrCreateToken('sessA');
      expect(first.token).toEqual(expect.any(String));
      expect(first.token.length).toBeGreaterThan(0);

      const second = await service.getOrCreateToken('sessA');
      expect(second.token).toBe(first.token);
    });

    it('scopes tokens independently per session', async () => {
      const a = await service.getOrCreateToken('sessA');
      const b = await service.getOrCreateToken('sessB');
      expect(a.token).not.toBe(b.token);
    });
  });

  describe('regenerateToken', () => {
    it('replaces the token, invalidating the old one', async () => {
      const original = await service.getOrCreateToken('sessA');
      const regenerated = await service.regenerateToken('sessA');

      expect(regenerated.token).not.toBe(original.token);
      await expect(service.assertValidToken('sessA', original.token)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(service.assertValidToken('sessA', regenerated.token)).resolves.toBeUndefined();
    });

    it('works even when no token existed yet', async () => {
      const regenerated = await service.regenerateToken('sessB');
      expect(regenerated.token).toEqual(expect.any(String));
    });
  });

  describe('assertValidToken', () => {
    it('rejects a missing header', async () => {
      await expect(service.assertValidToken('sessA', undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects when the session has no token configured', async () => {
      await expect(service.assertValidToken('sessA', 'anything')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects a wrong token', async () => {
      await service.getOrCreateToken('sessA');
      await expect(service.assertValidToken('sessA', 'not-the-token')).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('accepts the correct token', async () => {
      const { token } = await service.getOrCreateToken('sessA');
      await expect(service.assertValidToken('sessA', token)).resolves.toBeUndefined();
    });
  });
});
