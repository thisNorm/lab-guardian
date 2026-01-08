// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // CORS 허용 (React 5000포트에서 접속 가능하도록)
  app.enableCors();
  
  // 포트 8000번 사용
  await app.listen(8000);
  console.log(`🚀 NestJS Backend is running on: http://192.168.0.131:8000`);
}
bootstrap();