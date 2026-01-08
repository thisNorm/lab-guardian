import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MonitoringGateway } from '../gateway/monitoring.gateway';

@Controller('api/robot')
export class RobotController {
  constructor(private readonly gateway: MonitoringGateway) {}

  // 현재 연결된 로봇의 리스트나 상태를 가져오기
  @Get('status')
  getRobotStatus() {
    return { id: 'rasbot-01', status: 'ONLINE', battery: '85%' };
  }

  // 웹에서 로봇에게 내리는 명령 중계
  @Post('command/:id')
  controlRobot(@Param('id') id: string, @Body() body: { action: string }) {
    console.log(`🤖 Robot ${id} 명령 수신: ${body.action}`);
    
    // 필요 시 게이트웨이를 통해 조종 상태를 브로드캐스트
    this.gateway.server.emit('robot_status_update', { id, action: body.action });
    
    return { success: true, target: id, command: body.action };
  }
}