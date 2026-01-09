// src/prisma.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  // ❌ constructor 부분 삭제!
  // (이제 schema.prisma에서 주소를 자동으로 가져옵니다)
  
  async onModuleInit() {
    await this.$connect();
  }
}