import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
async function main() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.enableCors({ origin: ['https://app.example.org'] });
}
