// src/monitoring.gateway.ts
import { WebSocketGateway, WebSocketServer, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

@WebSocketGateway({
  cors: { origin: '*' }, // 모든 도메인 허용 (React 5000포트 포함)
})
export class MonitoringGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  handleConnection(client: Socket) {
    console.log(`🌐 웹 클라이언트 접속: ${client.id}`);
  }

  handleDisconnect(client: Socket) {
    console.log(`❌ 웹 클라이언트 접속 해제: ${client.id}`);
  }

  // 외부(Controller)에서 호출하여 웹으로 알람을 쏘는 메서드
  broadcastDetection(data: any) {
    this.server.emit('detection_event', data);
  }
}