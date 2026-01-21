using System.Text.Json;
using lab_guardian_gateway.Data;
using lab_guardian_gateway.Models;
using lab_guardian_gateway.Services;
using StackExchange.Redis;

namespace lab_guardian_gateway.Workers;

public sealed class RedisEventWorker {
    private readonly IDatabase _redis;
    private readonly RedisQueueMetrics _metrics;
    private readonly int _dangerBurstLimit;
    private readonly int _batchSize;
    private readonly TimeSpan _batchFlushInterval;
    private readonly TimeSpan _idleDelay = TimeSpan.FromMilliseconds(50);

    public RedisEventWorker(
        IDatabase redis,
        RedisQueueMetrics metrics,
        int dangerBurstLimit = RedisQueueConfig.DangerBurstLimit,
        int batchSize = RedisQueueConfig.BatchSize,
        TimeSpan? batchFlushInterval = null
    ) {
        _redis = redis;
        _metrics = metrics;
        _dangerBurstLimit = dangerBurstLimit;
        _batchSize = batchSize;
        _batchFlushInterval = batchFlushInterval ?? TimeSpan.FromMilliseconds(250);
    }

    public async Task RunAsync(CancellationToken ct) {
        var batch = new List<EventLog>(_batchSize);
        var lastFlush = DateTime.UtcNow;
        int dangerStreak = 0;

        // Priority pop keeps DANGER ahead of normal logs; burst limit avoids starvation.
        while (!ct.IsCancellationRequested) {
            RedisValue payload = RedisValue.Null;

            if (dangerStreak < _dangerBurstLimit) {
                payload = await _redis.ListLeftPopAsync(RedisQueueConfig.DangerQueue);
                if (!payload.IsNullOrEmpty) {
                    dangerStreak++;
                }
            }

            if (payload.IsNullOrEmpty) {
                payload = await _redis.ListLeftPopAsync(RedisQueueConfig.EventQueue);
                if (!payload.IsNullOrEmpty) {
                    dangerStreak = 0;
                }
            }

            if (payload.IsNullOrEmpty) {
                if (batch.Count > 0 && DateTime.UtcNow - lastFlush >= _batchFlushInterval) {
                    await FlushAsync(batch, ct);
                    lastFlush = DateTime.UtcNow;
                }

                await Task.Delay(_idleDelay, ct);
                continue;
            }

            try {
                var log = JsonSerializer.Deserialize<EventLog>(payload!);
                if (log != null) {
                    batch.Add(log);
                } else {
                    _metrics.IncrementDropped("bad_json");
                }
            } catch {
                _metrics.IncrementDropped("bad_json");
            }

            if (batch.Count >= _batchSize) {
                await FlushAsync(batch, ct);
                lastFlush = DateTime.UtcNow;
            }
        }
    }

    private async Task FlushAsync(List<EventLog> batch, CancellationToken ct) {
        if (batch.Count == 0) return;

        try {
            using var db = new LabDbContext();
            db.EventLogs.AddRange(batch);
            await db.SaveChangesAsync(ct);
        } catch (Exception ex) {
            // DB 저장 실패 이벤트는 유실 대신 DLQ로 격리한다(자동 재처리는 하지 않음).
            _metrics.IncrementDropped("db_error");
            Console.WriteLine($"[Worker] DB save failed, moving batch to DLQ: {ex.Message}");

            foreach (var log in batch) {
                try {
                    string json = JsonSerializer.Serialize(log);
                    await _redis.ListRightPushAsync(RedisQueueConfig.DlqQueue, json);
                    _metrics.IncrementDropped("moved_to_dlq");
                } catch {
                    _metrics.IncrementDropped("dlq_push_failed");
                }
            }
        } finally {
            batch.Clear();
        }
    }
}
