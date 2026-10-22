import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { createLogger } from '@saath/logger';
import { AppModule } from './app.module';

const logger = createLogger('api');

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  app.setGlobalPrefix('v1');
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.info({ port }, 'saath-api listening');
}

void bootstrap();
