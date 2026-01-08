import { Controller, Post, Body } from '@nestjs/common';
import { CctvService } from './cctv.service';

@Controller('api/cctv')
export class CctvController {
  constructor(private readonly cctvService: CctvService) {}

  @Post('detect')
  async handleDetect(@Body() detectionData: any) {
    return await this.cctvService.processDetection(detectionData);
  }
}