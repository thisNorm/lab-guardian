import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

// 1. 전송 데이터 타입 정의 (가독성 및 유지보수 향상)
interface DetectionPayload {
  cam_id: string;
  label: string;
  status: 'IDLE' | 'DANGER' | 'PATROL';
  message: string;
  timestamp: string;
}

@WebSocketGateway({
  cors: { origin: '*' },
  namespace: 'monitoring', // 네임스페이스를 지정하면 다른 소켓들과 분리 관리가 가능합니다.
})
export class MonitoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // 클라이언트가 연결되었을 때
  handleConnection(client: Socket) {
    const { address } = client.handshake;
    console.log(`🌐 [Connected] Client ID: ${client.id} | IP: ${address}`);
  }

  // 클라이언트 연결이 끊겼을 때
  handleDisconnect(client: Socket) {
    console.log(`❌ [Disconnected] Client ID: ${client.id}`);
  }

  /**
   * 외부(CctvController)에서 감지 데이터를 받아 
   * 연결된 모든 React 클라이언트에 실시간 브로드캐스팅합니다.
   */
  broadcastDetection(data: DetectionPayload) {
    console.log(`📡 [Broadcasting] Alert from ${data.cam_id}`);
    this.server.emit('alarm_event', data);
  }
}