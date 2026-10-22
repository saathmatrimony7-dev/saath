import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // TODO(P0-06): replace console with the redaction logger
  console.log(`saath-api listening on :${port}`);
}

void bootstrap();
