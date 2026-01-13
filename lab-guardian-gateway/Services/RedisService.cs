using StackExchange.Redis;

namespace lab_guardian_gateway.Services;

public class RedisService {
    private readonly IDatabase _db;
    public RedisService() {
        var redis = ConnectionMultiplexer.Connect("127.0.0.1:6379");
        _db = redis.GetDatabase();
    }
    public async Task SaveStatusAsync(string robotId, string data) {
        await _db.StringSetAsync($"robot:{robotId}:status", data, TimeSpan.FromMinutes(30));
    }
}