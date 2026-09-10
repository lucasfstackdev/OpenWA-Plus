import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KirvanoEventConfig } from './entities/kirvano-event-config.entity';
import { KirvanoIntegration } from './entities/kirvano-integration.entity';
import { KirvanoService } from './kirvano.service';
import { KirvanoTokenService } from './kirvano-token.service';
import { KirvanoDispatchQueueService } from './kirvano-dispatch-queue.service';
import { KirvanoReceiverService } from './kirvano-receiver.service';
import { KirvanoReceiverThrottlerGuard } from './kirvano-receiver-throttler.guard';
import { KirvanoController } from './kirvano.controller';
import { KirvanoTokenController } from './kirvano-token.controller';
import { KirvanoReceiverController } from './kirvano-receiver.controller';
import { TemplateModule } from '../template/template.module';
import { MessageModule } from '../message/message.module';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([KirvanoEventConfig, KirvanoIntegration], 'data'),
    TemplateModule,
    MessageModule,
    ContactModule,
  ],
  controllers: [KirvanoController, KirvanoTokenController, KirvanoReceiverController],
  providers: [
    KirvanoService,
    KirvanoTokenService,
    KirvanoDispatchQueueService,
    KirvanoReceiverService,
    KirvanoReceiverThrottlerGuard,
  ],
})
export class KirvanoModule {}
