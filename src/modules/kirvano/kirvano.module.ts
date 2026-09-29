import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KirvanoEventConfig } from './entities/kirvano-event-config.entity';
import { KirvanoIntegration } from './entities/kirvano-integration.entity';
import { KirvanoEventLog } from './entities/kirvano-event-log.entity';
import { KirvanoService } from './kirvano.service';
import { KirvanoTokenService } from './kirvano-token.service';
import { KirvanoDispatchQueueService } from './kirvano-dispatch-queue.service';
import { KirvanoEventLogService } from './kirvano-event-log.service';
import { KirvanoEventLogSweeperService } from './kirvano-event-log-sweeper.service';
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
    TypeOrmModule.forFeature([KirvanoEventConfig, KirvanoIntegration, KirvanoEventLog], 'data'),
    TemplateModule,
    MessageModule,
    ContactModule,
  ],
  controllers: [KirvanoController, KirvanoTokenController, KirvanoReceiverController],
  providers: [
    KirvanoService,
    KirvanoTokenService,
    KirvanoDispatchQueueService,
    KirvanoEventLogService,
    KirvanoEventLogSweeperService,
    KirvanoReceiverService,
    KirvanoReceiverThrottlerGuard,
  ],
})
export class KirvanoModule {}
