import { Injectable } from '@nestjs/common';
import { MonitoringGateway } from '../gateway/monitoring.gateway';

@Injectable()
export class CctvService {
  constructor(private readonly gateway: MonitoringGateway) {}

  async processDetection(data: any) {
    const alertData = {
      ...data,
      status: 'DANGER',
      message: `${data.cam_id} 구역에서 ${data.label} 감지!`,
      timestamp: new Date().toISOString(),
    };

    // 로직 처리 후 게이트웨이로 전송
    this.gateway.broadcastDetection(alertData);
    return alertData;
  }
}