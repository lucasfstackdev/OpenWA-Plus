import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { KirvanoEventConfig } from './entities/kirvano-event-config.entity';
import { KirvanoService } from './kirvano.service';
import { KirvanoController } from './kirvano.controller';
import { TemplateModule } from '../template/template.module';

@Module({
  imports: [TypeOrmModule.forFeature([KirvanoEventConfig], 'data'), TemplateModule],
  controllers: [KirvanoController],
  providers: [KirvanoService],
})
export class KirvanoModule {}
