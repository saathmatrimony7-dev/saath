import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { MeController } from './me.controller';
import { PrismaModule } from './prisma/prisma.module';
import { IdentityModule } from './modules/identity/identity.module';
import { LlmGatewayModule } from './modules/llm-gateway/llm-gateway.module';
import { TaxonomyModule } from './modules/taxonomy/taxonomy.module';

@Module({
  imports: [PrismaModule, IdentityModule, LlmGatewayModule, TaxonomyModule],
  controllers: [HealthController, MeController],
})
export class AppModule {}
