using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using lab_guardian_gateway.Data;
using lab_guardian_gateway.Models;
using lab_guardian_gateway.Services;
using Fleck;

// 1. DB 설정 및 초기화
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

var listener = new TcpListener(IPAddress.Any, 8888);
listener.Start();

Console.WriteLine("--------------------------------------------------");
Console.WriteLine("🚀 게이트웨이 통합 관제 시작 (Warning Free Ver)");
Console.WriteLine("--------------------------------------------------");

while (true)
{
    var client = await listener.AcceptTcpClientAsync();
    
    _ = Task.Run(async () => {
        try {
            // [수정 1] CS8600, CS8602 해결: Null 안전 접근
            // RemoteEndPoint가 null이면 "Unknown"을 넣도록 처리
            var endPoint = client.Client.RemoteEndPoint as IPEndPoint;
            string clientIp = endPoint?.Address.ToString() ?? "Unknown";
            
            // Console.WriteLine($"[DEBUG] 접속 감지: {clientIp}");

            using var stream = client.GetStream();
            var buffer = new byte[2048];
            
            while (true)
            {
                int n = await stream.ReadAsync(buffer, 0, buffer.Length);
                if (n == 0) break;

                string rawData = Encoding.UTF8.GetString(buffer, 0, n).Trim();
                
                // HTTP 요청 필터링
                if (string.IsNullOrEmpty(rawData) || rawData.StartsWith("GET") || rawData.Contains("HTTP")) continue; 

                // 1. 데이터 파싱
                string deviceId = "Unknown";
                string status = "SAFE";

                if (rawData.Contains(':')) {
                    string[] parts = rawData.Split(':');
                    deviceId = parts.Length > 0 ? parts[0] : "Unknown";
                    status = parts.Length > 1 ? parts[1] : "SAFE";
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

                string finalLogEntry = $"[{status}] {displayMsg}";

                // 3. DB 저장 및 웹소켓 전송
                try {
                    using (var db = new LabDbContext()) {
                        // Null 체크 (deviceId가 null일 경우 대비)
                        deviceId ??= "Unknown";
                        bool isCctv = deviceId.ToUpper().Contains("CCTV") || deviceId.ToUpper().Contains("WEBCAM");
                        
                        var newLog = new EventLog {
                            CamId = deviceId,
                            CreatedAt = DateTime.Now,
                            CctvLog = isCctv ? finalLogEntry : null,
                            RobotLog = !isCctv ? finalLogEntry : null
                        };

                        db.EventLogs.Add(newLog);
                        await db.SaveChangesAsync();

                        // 콘솔 출력
                        Console.ForegroundColor = status == "DANGER" ? ConsoleColor.Red : ConsoleColor.Yellow;
                        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] ✅ [DB 저장] {deviceId}: {displayMsg}");
                        Console.ResetColor();

                        // 4. 웹소켓 실시간 전송
                        var jsonPayload = JsonSerializer.Serialize(new {
                            status = status,
                            camId = deviceId,
                            message = finalLogEntry,
                            time = newLog.CreatedAt.ToString("HH:mm:ss")
                        });

                        foreach (var socket in allSockets.ToList()) {
                            if (socket.IsAvailable) 
                            {
                                // [수정 2] CS4014 해결: 비동기 결과를 기다리지 않음을 명시 (Discard)
                                _ = socket.Send(jsonPayload);
                            }
                        }
                    }
                } catch (Exception dbEx) {
                    Console.WriteLine($"❌ [DB 오류] {deviceId}: {dbEx.Message}");
                }
            }
        }
        catch (Exception) { 
            // 연결 종료 시 조용히 처리
        }
        finally {
            client.Close();
        }
    });
}