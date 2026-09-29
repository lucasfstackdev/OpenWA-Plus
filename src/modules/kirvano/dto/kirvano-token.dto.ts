import { ApiProperty } from '@nestjs/swagger';

export class KirvanoTokenResponseDto {
  @ApiProperty({ description: 'Shared secret sent by Kirvano in the security-token header' })
  token!: string;
}
