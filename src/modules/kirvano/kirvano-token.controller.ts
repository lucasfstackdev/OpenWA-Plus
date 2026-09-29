import { Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { KirvanoTokenService } from './kirvano-token.service';
import { KirvanoTokenResponseDto } from './dto';

@ApiTags('kirvano')
@Controller('sessions/:sessionId/kirvano/token')
export class KirvanoTokenController {
  constructor(private readonly tokenService: KirvanoTokenService) {}

  @Get()
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: "Get the session's Kirvano webhook token (minted on first call)" })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'The token.', type: KirvanoTokenResponseDto })
  async get(@Param('sessionId') sessionId: string): Promise<KirvanoTokenResponseDto> {
    const row = await this.tokenService.getOrCreateToken(sessionId);
    return { token: row.token };
  }

  @Post('regenerate')
  @RequireRole(ApiKeyRole.OPERATOR)
  @ApiOperation({ summary: 'Replace the session’s Kirvano webhook token, invalidating the old one' })
  @ApiParam({ name: 'sessionId', description: 'Session ID' })
  @ApiResponse({ status: 200, description: 'The new token.', type: KirvanoTokenResponseDto })
  async regenerate(@Param('sessionId') sessionId: string): Promise<KirvanoTokenResponseDto> {
    const row = await this.tokenService.regenerateToken(sessionId);
    return { token: row.token };
  }
}
