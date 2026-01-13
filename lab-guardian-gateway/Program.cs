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
Console.WriteLine("🚀 게이트웨이 통합 관제 시작 (일관된 로그 모드)");
Console.WriteLine("--------------------------------------------------");

while (true)
{
    var client = await listener.AcceptTcpClientAsync();
    
    _ = Task.Run(async () => {
        using var stream = client.GetStream();
        var buffer = new byte[2048];
        
        try {
            while (true)
            {
                int n = await stream.ReadAsync(buffer, 0, buffer.Length);
                if (n == 0) break;

                string rawData = Encoding.UTF8.GetString(buffer, 0, n).Trim();
                if (string.IsNullOrEmpty(rawData) || rawData.Contains("HTTP")) continue; 

                // 1. 데이터 파싱
                string deviceId = "Unknown";
                string status = "SAFE";

                if (rawData.Contains(':')) {
                    string[] parts = rawData.Split(':');
                    deviceId = parts[0] ?? "Unknown";
                    status = parts[1] ?? "SAFE";
                }

                // 2. 일관된 상태별 메시지 생성 (요구사항 반영)
                string displayMsg = status switch {
                    "DANGER" => "🚨 침입자 감지!",
                    "SAFE" => "✅ 이상 없음 (정기 보고)",
                    "CONNECTED" => "🌐 장치 연결 성공",
                    "DISCONNECTED" => "❌ 장치 연결 끊김",
                    "CONTROL" => "🎮 조종 모드 (전체화면)",
                    "MONITOR" => "🛡️ 감시 모드 (전체화면 해제)",
                    _ => status
                };

                // 3. 로그 기록 및 전송 로직
                using var db = new LabDbContext();
                bool isCctv = deviceId.ToUpper().Contains("CCTV") || deviceId.ToUpper().Contains("WEBCAM");
                string finalLogEntry = $"[{status}] {displayMsg}";

                var newLog = new EventLog {
                    CamId = deviceId, // CamId에 기기 이름 고정
                    CreatedAt = DateTime.Now,
                    CctvLog = isCctv ? finalLogEntry : null,
                    RobotLog = !isCctv ? finalLogEntry : null
                };

                // 중요 로그(DANGER, CONNECT 등)는 DB 저장, SAFE는 웹 전송만 권장 (선택 가능)
                try {
                    db.EventLogs.Add(newLog);
                    await db.SaveChangesAsync();
                    
                    Console.ForegroundColor = status == "DANGER" ? ConsoleColor.Red : ConsoleColor.Yellow;
                    Console.WriteLine($"✅ [DB] {deviceId}: {displayMsg}");
                    Console.ResetColor();
                } catch (Exception) { }

                // 웹소켓 실시간 전송
                var jsonPayload = JsonSerializer.Serialize(new {
                    status = status,
                    camId = deviceId,
                    message = finalLogEntry,
                    time = newLog.CreatedAt.ToString("HH:mm:ss")
                });

                foreach (var socket in allSockets.ToList()) {
                    if (socket.IsAvailable) socket.Send(jsonPayload);
                }
            }
        }
        catch (Exception) { client.Close(); }
    });
}