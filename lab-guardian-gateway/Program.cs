using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using lab_guardian_gateway.Data;
using lab_guardian_gateway.Models;
using lab_guardian_gateway.Services;
using Fleck;

// 1. DB 설정 확인
string dbName = "LogDatabase.db";
// 💡 경로가 정확한지 다시 한번 확인해주세요.
string baseDirectory = @"C:\Users\kisoo\Desktop\lab-guardian\lab-guardian-gateway";
string dbFullPath = Path.Combine(baseDirectory, dbName);

Console.ForegroundColor = ConsoleColor.Cyan;
Console.WriteLine($"[시스템] DB 파일 경로: {dbFullPath}");
Console.ResetColor();

// DB 생성 테스트
try {
    using (var dbInitializer = new LabDbContext()) {
        if (dbInitializer.Database.EnsureCreated()) {
            Console.WriteLine("[DB] 새 데이터베이스 파일이 생성되었습니다.");
        } else {
            Console.WriteLine("[DB] 기존 데이터베이스 파일을 로드했습니다.");
        }
    }
} catch (Exception ex) {
    Console.ForegroundColor = ConsoleColor.Red;
    Console.WriteLine($"[치명적 오류] DB 파일 접근 실패!\n{ex.Message}");
    Console.ResetColor();
}

// 2. 서버 구동
var allSockets = new List<IWebSocketConnection>();
var websocketServer = new WebSocketServer("ws://0.0.0.0:8080");

websocketServer.Start(socket => {
    socket.OnOpen = () => allSockets.Add(socket);
    socket.OnClose = () => allSockets.Remove(socket);
});

var listener = new TcpListener(IPAddress.Any, 8888);
listener.Start();

Console.WriteLine("--------------------------------------------------");
Console.WriteLine("🚀 게이트웨이 정상 가동 중...");
Console.WriteLine("   - 평상시(IDLE)에는 로그를 출력하지 않습니다.");
Console.WriteLine("   - 위험(DANGER) 감지 시에만 알림 및 저장이 수행됩니다.");
Console.WriteLine("--------------------------------------------------");

while (true)
{
    var client = await listener.AcceptTcpClientAsync();
    
    // 로봇 연결 로그 (한 번만 출력됨)
    // Console.WriteLine($"[네트워크] 클라이언트 접속 (IP: {client.Client.RemoteEndPoint})");

    _ = Task.Run(async () => {
        using var stream = client.GetStream();
        var buffer = new byte[2048];
        
        try {
            while (true)
            {
                int n = await stream.ReadAsync(buffer, 0, buffer.Length);
                if (n == 0) break;

                string rawData = Encoding.UTF8.GetString(buffer, 0, n);
                
                // 🚫 [수정] IDLE 로그 폭탄 방지 (주석 처리)
                // Console.WriteLine($"📥 [수신] Raw Data: '{rawData.Trim()}'");

                if (rawData.Contains("HTTP")) continue; 

                string status = ParseStatus(rawData);

                // -----------------------------------------------------
                // 💾 DB 저장 및 로직 처리
                // -----------------------------------------------------
                using var db = new LabDbContext();
                EventLog savedLog = null;

                // 🔥 DANGER 일 때만 콘솔 출력 및 DB 저장
                if (status == "DANGER")
                {
                    Console.ForegroundColor = ConsoleColor.Red;
                    Console.WriteLine($"\n🚨 [긴급] 침입자 감지! ({DateTime.Now:HH:mm:ss})");
                    Console.WriteLine($"   -> DB 저장 시도 중...");

                    savedLog = new EventLog {
                        CamId = "CCTV_Webcam_100",
                        CctvLog = $"침입자 감지! (Raw: {status})",
                        RobotLog = null, // 사진처럼 로봇 로그는 비움
                        CreatedAt = DateTime.Now
                    };
                    
                    try {
                        db.EventLogs.Add(savedLog);
                        int result = await db.SaveChangesAsync(); // 저장 실행
                        
                        if(result > 0) {
                            Console.ForegroundColor = ConsoleColor.Green;
                            Console.WriteLine($"   ✅ [저장 성공] DB 기록 완료 (ID: {savedLog.Id})");
                        } else {
                            Console.ForegroundColor = ConsoleColor.Yellow;
                            Console.WriteLine("   ⚠️ [저장 경고] 변경사항 없음");
                        }
                    } 
                    catch (Exception dbEx) {
                        Console.ForegroundColor = ConsoleColor.Red;
                        Console.WriteLine($"   ❌ [저장 실패] {dbEx.Message}");
                    }
                    Console.ResetColor();
                }
                else 
                {
                    // IDLE 상태일 때는 DB 저장 안 함 & 콘솔 출력 안 함 (조용히 처리)
                    savedLog = new EventLog {
                        CamId = "Robot_01",
                        RobotLog = status,
                        CctvLog = null,
                        CreatedAt = DateTime.Now
                    };
                }

                // -----------------------------------------------------
                // 📡 웹 전송 (Websocket Push)
                // -----------------------------------------------------
                // IDLE이든 DANGER든 웹에는 계속 상태를 보내줘야 화면(초록/빨강)이 갱신됨
                var jsonPayload = JsonSerializer.Serialize(new {
                    status = status,
                    camId = savedLog.CamId,
                    message = status == "DANGER" ? savedLog.CctvLog : savedLog.RobotLog,
                    time = savedLog.CreatedAt.ToString("HH:mm:ss")
                });

                foreach (var socket in allSockets.ToList())
                {
                    if (socket.IsAvailable) socket.Send(jsonPayload);
                }
            }
        }
        catch (Exception) { 
            // 연결 끊김 에러도 너무 자주 뜨면 주석 처리 가능
            // Console.WriteLine($"[연결 종료] {ex.Message}"); 
        }
        finally { 
            client.Close(); 
        }
    });
}

static string ParseStatus(string data)
{
    string upper = data.ToUpper();
    if (upper.Contains("DANGER")) return "DANGER";
    return "IDLE"; 
}