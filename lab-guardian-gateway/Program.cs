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
_ = Task.Run(() => RunWithRestartAsync("Metrics", () => queueMetrics.RunLogLoopAsync(workerCts.Token), workerCts.Token));
_ = Task.Run(() => RunWithRestartAsync("Worker", () => new RedisEventWorker(redisDb, queueMetrics).RunAsync(workerCts.Token), workerCts.Token));
_ = Task.Run(() => RunWithRestartAsync("BacklogCache", () => backlogCache.RunAsync(workerCts.Token), workerCts.Token));

var listener = new TcpListener(IPAddress.Any, 8888);
listener.Start();

Console.WriteLine("--------------------------------------------------");
Console.WriteLine("🚀 게이트웨이 통합 관제 시작 (Redis Buffered Ver)");
Console.WriteLine("--------------------------------------------------");

while (true)
{
    var client = await listener.AcceptTcpClientAsync();
    
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

                if (!string.IsNullOrEmpty(imagePath)) displayMsg += " (📸 스냅샷 저장됨)";
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
