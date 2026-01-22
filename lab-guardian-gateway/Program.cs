using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using lab_guardian_gateway.Data;
using lab_guardian_gateway.Models;
using lab_guardian_gateway.Services;
using lab_guardian_gateway.Workers;
using Fleck;
using StackExchange.Redis;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

// 1. DB 설정 (초기화용)
string dbName = "LogDatabase.db";
string baseDirectory = @"C:\Users\kisoo\Desktop\lab-guardian\lab-guardian-gateway";
string dbFullPath = Path.Combine(baseDirectory, dbName);

try {
    using (var dbInitializer = new LabDbContext()) {
        dbInitializer.Database.EnsureCreated();
    }
} catch (Exception ex) {
    Console.WriteLine($"[DB 오류] {ex.Message}");
}

// 2. 서버 구동 설정
var cts = new CancellationTokenSource();

var builder = WebApplication.CreateBuilder(args);
builder.WebHost.UseUrls("http://0.0.0.0:8081");
builder.Services.AddCors(options => {
    options.AddDefaultPolicy(policy => policy
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowAnyOrigin());
});

var app = builder.Build();
app.UseCors();

app.MapGet("/health", () => Results.Json(new {
    status = "ok",
    time = DateTime.UtcNow.ToString("o"),
}));

app.MapGet("/api/logs/recent", (int? take, string? type) => {
    int takeCount = Math.Min(Math.Max(take ?? 50, 1), 200);
    string logType = string.IsNullOrWhiteSpace(type) ? "all" : type.Trim().ToLowerInvariant();

    using var db = new LabDbContext();
    var query = db.EventLogs.AsQueryable();

    if (logType == "cctv") {
        query = query.Where(log => log.CctvLog != null);
    } else if (logType == "robot") {
        query = query.Where(log => log.RobotLog != null);
    }

    var items = query
        .OrderByDescending(log => log.CreatedAt)
        .Take(takeCount)
        .Select(log => new {
            id = log.Id,
            camId = log.CamId,
            createdAt = log.CreatedAt,
            cctvLog = log.CctvLog,
            robotLog = log.RobotLog,
            snapshotPath = log.SnapshotPath,
        })
        .ToList();

    return Results.Json(new { count = items.Count, items });
});
var allSockets = new List<IWebSocketConnection>();
var websocketServer = new WebSocketServer("ws://0.0.0.0:8080");

websocketServer.Start(socket => {
    socket.OnOpen = () => allSockets.Add(socket);
    socket.OnClose = () => allSockets.Remove(socket);
});

// 🚀 [핵심 수정 1] Redis 연결 (서버 시작 시 1회만 연결)
// 매 요청마다 DB를 여는 대신, 미리 열어둔 Redis 파이프라인을 사용함
var redisMux = ConnectionMultiplexer.Connect("127.0.0.1:6379");
var redisDb = redisMux.GetDatabase();
var queueMetrics = new RedisQueueMetrics(redisDb);
var backlogCache = new RedisQueueBacklogCache(redisDb);
var workerCts = new CancellationTokenSource();
_ = Task.Run(async () => {
    try {
        await RunWithRestartAsync("Metrics", () => queueMetrics.RunLogLoopAsync(workerCts.Token), workerCts.Token);
    } catch (Exception ex) {
        Console.WriteLine($"[Metrics task failed] {ex.Message}");
    }
});
_ = Task.Run(async () => {
    try {
        await RunWithRestartAsync("Worker", () => new RedisEventWorker(redisDb, queueMetrics).RunAsync(workerCts.Token), workerCts.Token);
    } catch (Exception ex) {
        Console.WriteLine($"[Worker task failed] {ex.Message}");
    }
});
_ = Task.Run(async () => {
    try {
        await RunWithRestartAsync("BacklogCache", () => backlogCache.RunAsync(workerCts.Token), workerCts.Token);
    } catch (Exception ex) {
        Console.WriteLine($"[BacklogCache task failed] {ex.Message}");
    }
});

var listener = new TcpListener(IPAddress.Any, 8888);
listener.Start();

Console.CancelKeyPress += (_, e) => {
    e.Cancel = true;
    cts.Cancel();
    try {
        listener.Stop();
    } catch {
        // ignore shutdown errors
    }
};

app.MapGet("/api/queues", async () => {
    try {
        var danger = await redisDb.ListLengthAsync(RedisQueueConfig.DangerQueue);
        var eventLen = await redisDb.ListLengthAsync(RedisQueueConfig.EventQueue);
        var dlq = await redisDb.ListLengthAsync(RedisQueueConfig.DlqQueue);
        return Results.Json(new { danger, @event = eventLen, dlq });
    } catch {
        return Results.Problem("Redis error", statusCode: 500);
    }
});

app.MapGet("/api/dlq", async (int? take) => {
    int takeCount = Math.Min(Math.Max(take ?? 50, 1), 500);
    try {
        var rawItems = await redisDb.ListRangeAsync(RedisQueueConfig.DlqQueue, -takeCount, -1);
        var items = rawItems.Select(item => {
            var raw = item.ToString();
            try {
                var parsed = JsonSerializer.Deserialize<object>(raw);
                return new { parsed } as object;
            } catch {
                return new { raw } as object;
            }
        }).ToList();
        return Results.Json(new { count = items.Count, items });
    } catch {
        return Results.Problem("Redis error", statusCode: 500);
    }
});

app.MapPost("/api/dlq/replay", async (int? take) => {
    int takeCount = Math.Min(Math.Max(take ?? 50, 1), 500);
    int replayed = 0;
    int failed = 0;
    Console.WriteLine("[DLQ] manual replay initiated");

    try {
        for (int i = 0; i < takeCount; i++) {
            var item = await redisDb.ListRightPopAsync(RedisQueueConfig.DlqQueue);
            if (item.IsNullOrEmpty) break;
            try {
                await redisDb.ListRightPushAsync(RedisQueueConfig.EventQueue, item);
                replayed++;
            } catch {
                failed++;
            }
        }
    } catch {
        return Results.Problem("Redis error", statusCode: 500);
    }

    return Results.Json(new { replayed, failed });
});

await app.StartAsync();

Console.WriteLine("--------------------------------------------------");
Console.WriteLine("🚀 게이트웨이 통합 관제 시작 (Redis Buffered Ver)");
Console.WriteLine("--------------------------------------------------");

while (!cts.IsCancellationRequested)
{
    TcpClient client;
    try {
        client = await listener.AcceptTcpClientAsync();
    } catch (ObjectDisposedException) when (cts.IsCancellationRequested) {
        break;
    } catch (SocketException) when (cts.IsCancellationRequested) {
        break;
    }
    
    _ = Task.Run(async () => {
        try {
            var endPoint = client.Client.RemoteEndPoint as IPEndPoint;
            string clientIp = endPoint?.Address.ToString() ?? "Unknown";

            using var stream = client.GetStream();
            var buffer = new byte[2048];
            
            while (true)
            {
                int n = await stream.ReadAsync(buffer, 0, buffer.Length);
                if (n == 0) break;

                string rawData = Encoding.UTF8.GetString(buffer, 0, n).Trim();
                
                if (string.IsNullOrEmpty(rawData) || rawData.StartsWith("GET") || rawData.Contains("HTTP")) continue; 

                // 1. 데이터 파싱
                string deviceId = "Unknown";
                string status = "SAFE";
                string? imagePath = null;

                if (rawData.Contains(':')) {
                    string[] parts = rawData.Split(':', 3);
                    deviceId = parts.Length > 0 ? parts[0] : "Unknown";
                    status = parts.Length > 1 ? parts[1] : "SAFE";
                    if (parts.Length > 2) imagePath = parts[2];
                }

                // 2. 메시지 생성
                string displayMsg = status switch {
                    "DANGER" => "🚨 침입자 감지!",
                    "SAFE" => "✅ 이상 없음 (정기 보고)",
                    "CONNECTED" => "🌐 장치 연결 성공",
                    "DISCONNECTED" => "❌ 장치 연결 끊김",
                    "CONTROL" => "🎮 조종 모드 (전체화면)",
                    "MONITOR" => "🛡️ 감시 모드 (전체화면 해제)",
                    _ => status
                };

                // 로그 길이 축소: 스냅샷 메시지는 UI 로그에 포함하지 않음
                string finalLogEntry = $"[{status}] {displayMsg}";

                // 3. Redis 버퍼링 및 웹소켓 전송
                try {
                    deviceId ??= "Unknown";
                    bool isDanger = status.Equals("DANGER", StringComparison.OrdinalIgnoreCase);
                    bool isCctv = deviceId.ToUpper().Contains("CCTV") || deviceId.ToUpper().Contains("WEBCAM");
                    
                    var newLog = new EventLog {
                        CamId = deviceId,
                        CreatedAt = DateTime.Now,
                        CctvLog = isCctv ? finalLogEntry : null,
                        RobotLog = !isCctv ? finalLogEntry : null,
                        SnapshotPath = imagePath
                    };

                    // 🚀 [핵심 수정 2] DB 직접 저장(Lock 유발) 코드 제거 -> Redis 큐(List)에 적재
                    // Write-Back 패턴: 여기서 Redis에 넣으면, 별도의 Worker가 나중에 꺼내서 DB에 저장함
                    string jsonLog = JsonSerializer.Serialize(newLog);
                    string queueKey = isDanger ? RedisQueueConfig.DangerQueue : RedisQueueConfig.EventQueue;

                    // DB 스톨 방지: backlog 임계치 이상이면 저중요 로그만 드랍 (DANGER는 보존)
                    bool shouldEnqueue = true;
                    if (!isDanger) {
                        if (backlogCache.EventBacklog >= RedisQueueConfig.BacklogThreshold) {
                            queueMetrics.IncrementDropped(status);
                            shouldEnqueue = false;
                        }
                    }

                    if (shouldEnqueue) {
                        await redisDb.ListRightPushAsync(queueKey, jsonLog);
                    }

                    // 콘솔 출력
                    Console.ForegroundColor = isDanger ? ConsoleColor.Red : ConsoleColor.Yellow;
                    if (shouldEnqueue) {
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] 🚀 [Redis 적재] {deviceId}: {displayMsg}");
                    } else {
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] 🚀 [Redis 드랍] {deviceId}: {displayMsg}");
                    }
                    if(!string.IsNullOrEmpty(imagePath)) Console.WriteLine($"   └─ 🖼️ 경로: {imagePath}");
                    Console.ResetColor();

                    // 4. 웹소켓 실시간 전송 (UI 업데이트용)
                    var jsonPayload = JsonSerializer.Serialize(new {
                        status = status,
                        camId = deviceId,
                        message = finalLogEntry,
                        time = newLog.CreatedAt.ToString("HH:mm:ss"),
                        snapshot = imagePath
                    });

                    foreach (var socket in allSockets.ToList()) {
                        if (socket.IsAvailable) _ = socket.Send(jsonPayload);
                    }

                } catch (Exception ex) {
                    Console.WriteLine($"❌ [오류] {deviceId}: {ex.Message}");
                }
            }
        }
        catch (Exception) { 
            // 연결 종료 처리
        }
        finally {
            client.Close();
        }
    });
}

await app.StopAsync();

static async Task RunWithRestartAsync(string name, Func<Task> runAsync, CancellationToken ct) {
    while (!ct.IsCancellationRequested) {
        try {
            await runAsync();
            return;
        } catch (Exception ex) {
            Console.WriteLine($"[{name} crashed] {ex.Message}");
            await Task.Delay(TimeSpan.FromSeconds(1), ct);
        }
    }
}
