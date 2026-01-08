// src/app.controller.ts
import { Controller, Post, Body } from '@nestjs/common';
import { MonitoringGateway } from './gateway/monitoring.gateway'; // 폴더 구조에 맞춰 경로 확인

@Controller('api')
export class AppController {
  constructor(private readonly monitoringGateway: MonitoringGateway) {}

  @Post('detect')
  handleDetect(@Body() detectionData: { cam_id: string; label: string; confidence: number }) {
    console.log(`🚨 [감지!] ${detectionData.cam_id} 구역에 ${detectionData.label} 출현`);
    
    // 이 부분에서 broadcastDetection 메서드 이름이 Gateway와 일치하는지 확인하세요.
    this.monitoringGateway.broadcastDetection({
      cam_id: detectionData.cam_id,
      label: detectionData.label,
      status: 'DANGER', // 인터페이스에 정의한 타입에 맞춤
      message: `${detectionData.label} 감지됨!`,
      timestamp: new Date().toISOString(),
    });

    return { status: 'success', received: detectionData.cam_id };
  }
}