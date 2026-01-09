import { Controller, Get, Post, Body, Param } from '@nestjs/common';
import { MonitoringGateway } from '../gateway/monitoring.gateway';

@Controller('api/robot') // ✅ 경로를 'api/robot'으로 통일
export class RobotController {
  constructor(private readonly gateway: MonitoringGateway) {}

  // 1. 초기 로봇 목록 가져오기 (React의 axios.get 호출 대응)
  @Get() 
  getRobots() {
    // 실제 운영 시 DB에서 가져오지만, 현재는 테스트용 더미 데이터를 반환합니다.
    return [
      { id: 1, name: 'Rasbot #1', status: 'IDLE' },
      { id: 999, name: 'RealSense Cam', status: 'IDLE' }
    ];
  }

  // 2. 개별 로봇 상태 상세 조회
  @Get(':id/status')
  getRobotStatus(@Param('id') id: string) {
    return { id, status: 'ONLINE', battery: '85%' };
  }

  // 3. 로봇 명령 제어 (React의 axios.post 호출 대응)
  @Post('command/:id')
  controlRobot(@Param('id') id: string, @Body() body: { action: string }) {
    console.log(`🤖 Robot ${id} 명령 수신: ${body.action}`);
    
    // 소켓 네임스페이스 'monitoring'을 통해 상태 전파
    this.gateway.server.emit('robot_status_update', { id, action: body.action });
    
    return { success: true, target: id, command: body.action };
  }
}