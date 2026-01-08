import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { CctvController } from './cctv/cctv.controller';
import { CctvService } from './cctv/cctv.service';
import { RobotController } from './robot/robot.controller';
import { MonitoringGateway } from './gateway/monitoring.gateway';

@Module({
  imports: [],
  controllers: [
    AppController, 
    CctvController, 
    RobotController
  ],
  providers: [
    AppService, 
    CctvService, 
    MonitoringGateway
  ],
})
export class AppModule {}