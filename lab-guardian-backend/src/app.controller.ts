// src/app.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { MonitoringGateway } from './gateway/monitoring.gateway';

@Controller('api')
export class AppController {
  constructor(private readonly monitoringGateway: MonitoringGateway) {}

  @Post('detect')
  handleDetect(@Body() detectionData: { cam_id: string; label: string; confidence: number }) {
    console.log(`🚨 [감지!] ${detectionData.cam_id} 구역에 ${detectionData.label} 출현`);
    
    // 게이트웨이를 통해 연결된 모든 React 클라이언트에게 전송
    this.monitoringGateway.broadcastDetection({
      ...detectionData,
      timestamp: new Date().toISOString(),
      alert: true
    });

    return { status: 'success', received: detectionData.cam_id };
  }
}