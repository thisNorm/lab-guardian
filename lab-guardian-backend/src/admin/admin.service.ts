import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

type DlqItem = { parsed: object } | { raw: string };

@Injectable()
export class AdminService {
  constructor(private readonly redisService: RedisService) {}

  async getQueueLengths() {
    const redis = this.redisService.getClient();
    const [danger, event, dlq] = await Promise.all([
      redis.llen('danger_queue'),
      redis.llen('event_queue'),
      redis.llen('dlq_queue'),
    ]);

    return {
      danger,
      event,
      dlq,
    };
  }

  async getDlqItems(take: number) {
    const redis = this.redisService.getClient();
    const total = await redis.llen('dlq_queue');
    if (total === 0) {
      return { count: 0, items: [] as DlqItem[] };
    }

    const start = Math.max(total - take, 0);
    const rawItems = await redis.lrange('dlq_queue', start, total - 1);
    const items = rawItems.map((item) => {
      try {
        return { parsed: JSON.parse(item) } as DlqItem;
      } catch {
        return { raw: item } as DlqItem;
      }
    });

    return { count: items.length, items };
  }

  async replayDlq(take: number) {
    const redis = this.redisService.getClient();
    let replayed = 0;
    let failed = 0;

    // DLQ 수동 복구만 허용 (자동 재처리 없음)
    console.log('manual DLQ replay, operator-initiated');

    for (let i = 0; i < take; i++) {
      const item = await redis.lpop('dlq_queue');
      if (!item) break;
      try {
        await redis.rpush('event_queue', item);
        replayed++;
      } catch (error) {
        console.error(`DLQ replay failed: ${String(error)}`);
        failed++;
      }
    }

    return { replayed, failed };
  }
}
