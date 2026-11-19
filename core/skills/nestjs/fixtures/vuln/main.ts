import { NestFactory } from '@nestjs/core';
async function main() {
  const app = await NestFactory.create(AppModule); // EXPECT nestjs.validation-pipe-missing
  app.enableCors(); // EXPECT nestjs.cors-open
}
