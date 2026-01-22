import { Controller, Get, HttpException, Query, Post } from '@nestjs/common';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('queues')
  async getQueues() {
    try {
      return await this.adminService.getQueueLengths();
    } catch (error) {
      throw new HttpException('Redis error', 500);
    }
  }

  @Get('dlq')
  async getDlq(@Query('take') takeParam?: string) {
    const take = Math.min(Number(takeParam || 50) || 50, 500);
    try {
      return await this.adminService.getDlqItems(take);
    } catch (error) {
      throw new HttpException('Redis error', 500);
    }
  }

  @Post('dlq/replay')
  async replayDlq(@Query('take') takeParam?: string) {
    const take = Math.min(Number(takeParam || 50) || 50, 500);
    try {
      return await this.adminService.replayDlq(take);
    } catch (error) {
      throw new HttpException('Redis error', 500);
    }
  }
}
