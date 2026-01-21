using System.Collections.Concurrent;
using StackExchange.Redis;

namespace lab_guardian_gateway.Services;

public sealed class RedisQueueMetrics {
    private readonly IDatabase _redis;
    private readonly ConcurrentDictionary<string, long> _droppedByType =
        new(StringComparer.OrdinalIgnoreCase);
    private long _droppedTotal;

    public RedisQueueMetrics(IDatabase redis) {
        _redis = redis;
    }

    public void IncrementDropped(string type) {
        Interlocked.Increment(ref _droppedTotal);
        _droppedByType.AddOrUpdate(type, 1, (_, v) => v + 1);
    }

    public async Task RunLogLoopAsync(CancellationToken ct) {
        var timer = new PeriodicTimer(TimeSpan.FromSeconds(60));
        while (await timer.WaitForNextTickAsync(ct)) {
            long dangerLen = await _redis.ListLengthAsync(RedisQueueConfig.DangerQueue);
            long eventLen = await _redis.ListLengthAsync(RedisQueueConfig.EventQueue);
            long dlqLen = await _redis.ListLengthAsync(RedisQueueConfig.DlqQueue);

            long total = Interlocked.Read(ref _droppedTotal);
            string byType = _droppedByType.Count == 0
                ? "-"
                : string.Join(", ", _droppedByType.OrderBy(kv => kv.Key)
                    .Select(kv => $"{kv.Key}:{kv.Value}"));

            Console.WriteLine(
                $"[{DateTime.Now:HH:mm:ss}] [Queue] danger={dangerLen} event={eventLen} dlq={dlqLen} dropped_total={total} dropped_by_type={byType}"
            );
        }
    }
}
