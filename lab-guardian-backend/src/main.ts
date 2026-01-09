// lab-guardian-backend/src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// lab-guardian-backend/src/main.ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true, // 요청이 들어오는 도메인을 자동으로 허용
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
  });

  await app.listen(8000, '0.0.0.0'); // 모든 IP 접속 허용
  console.log(`🚀 NestJS Hub running on: http://192.168.0.131:8000`);
}
bootstrap();