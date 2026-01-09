import { Controller, Post, Body } from '@nestjs/common';
// 👇 여기가 빨간줄이었다면 이제 사라질 겁니다.
import { PrismaService } from './prisma.service'; 

@Controller('api/cctv')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('detect')
  async logDetection(@Body() body: { cam_id: string; status: string; message: string }) {
    console.log(`📥 [LOG 수신됨] ID: ${body.cam_id}`);

    try {
      const isCctv = body.cam_id.toLowerCase().includes('cctv');

      // DB 저장 시도
      const result = await this.prisma.eventLog.create({
        data: {
          camId: body.cam_id,
          cctvLog: isCctv ? body.message : undefined,
          robotLog: !isCctv ? body.message : undefined,
        },
      });
      console.log("✅ [DB 저장 성공] 저장된 번호:", result.id);
      return { success: true };
    } catch (e) {
      console.error("❌ [DB 저장 실패]", e);
    }
  }
}