import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { RedisModule } from './redis.module';

@Module({
  imports: [RedisModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
