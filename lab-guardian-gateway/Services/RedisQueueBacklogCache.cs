using StackExchange.Redis;

namespace lab_guardian_gateway.Services;

public sealed class RedisQueueBacklogCache {
    private readonly IDatabase _redis;
    private long _eventBacklog;
    private long _dangerBacklog;

    public RedisQueueBacklogCache(IDatabase redis) {
        _redis = redis;
    }

    public long EventBacklog => Interlocked.Read(ref _eventBacklog);
    public long DangerBacklog => Interlocked.Read(ref _dangerBacklog);

    public async Task RunAsync(CancellationToken ct) {
        var timer = new PeriodicTimer(TimeSpan.FromSeconds(1));
        while (await timer.WaitForNextTickAsync(ct)) {
            long eventLen = await _redis.ListLengthAsync(RedisQueueConfig.EventQueue);
            long dangerLen = await _redis.ListLengthAsync(RedisQueueConfig.DangerQueue);
            Interlocked.Exchange(ref _eventBacklog, eventLen);
            Interlocked.Exchange(ref _dangerBacklog, dangerLen);
        }
    }
}
