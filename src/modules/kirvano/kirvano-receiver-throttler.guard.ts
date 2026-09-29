import { Injectable } from '@nestjs/common';
import { ProxyAwareThrottlerGuard } from '../../common/security/proxy-aware-throttler.guard';
import { resolveNonNegativeIntEnv } from '../../config/configuration';

/**
 * Rate-limit bucket keyed on the receiving session's id instead of the client IP.
 *
 * Kirvano delivers every merchant's webhooks from the same shared egress IPs, so the global
 * `ProxyAwareThrottlerGuard` — keyed on IP — would lump every OpenWA session receiving Kirvano
 * webhooks into one bucket: a burst on one session would 429 every other session's deliveries too.
 * Keying on sessionId instead sheds a single noisy session at the edge without punishing its
 * neighbors. Mirrors `src/modules/integration/instance-throttler.guard.ts` exactly, including the
 * reason it does NOT use `@Throttle()`: that metadata is reflected on the route and read by every
 * ThrottlerGuard walking a tier of that name — including the global per-IP guard, which shares the
 * same tier list — so a route-level override would silently retarget the global guard's tolerance
 * for this route too. `onModuleInit` instead replaces `this.throttlers` with a tier only this guard
 * instance evaluates.
 *
 * Applied alongside (not instead of) the global per-IP guard (this controller is `@Public()`, not
 * `@SkipThrottle()`) — two independent buckets, both enforced.
 */
@Injectable()
export class KirvanoReceiverThrottlerGuard extends ProxyAwareThrottlerGuard {
  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = [
      {
        name: 'kirvano-receiver',
        limit: resolveNonNegativeIntEnv(process.env.KIRVANO_RECEIVER_LIMIT, 120),
        ttl: resolveNonNegativeIntEnv(process.env.KIRVANO_RECEIVER_TTL, 60000),
      },
    ];
  }

  protected async getTracker(req: Record<string, unknown>): Promise<string> {
    const params = (req.params ?? {}) as { sessionId?: string };
    if (params.sessionId) {
      return `kirvano:${params.sessionId}`;
    }
    // Defensive fallback: sessionId should always be present on this route, but if this guard is
    // ever reused elsewhere (or Nest fails to populate params), don't silently share one bucket.
    return super.getTracker(req);
  }
}
