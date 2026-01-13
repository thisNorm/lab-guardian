import time, socket, threading, cv2, numpy as np
import uvicorn, os, asyncio, sys
from functools import wraps
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from ai_detector import AIDetector 

PC_IP = "192.168.0.149"
PORT_GATEWAY = 8888
PORT_ALGO = 3000

app = FastAPI()
detector = AIDetector()

# 전역 변수
camera_streams = {}          
last_seen = {}               
last_heartbeat_times = {}    
current_device_status = {}   

# ✨ [핵심] 2단계 시청자 관리
active_viewers = set()       # 1단계: 웹 요청이 들어옴 (AI 연산 시작)
verified_viewers = set()     # 2단계: 연결 성공 로그까지 보냄 (DANGER 전송 허용)

HEARTBEAT_INTERVAL = 600     

def send_to_gateway(cam_id, status_msg):
    try:
        full_msg = f"{cam_id}:{status_msg}"
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            s.connect((PC_IP, PORT_GATEWAY))
            s.sendall(full_msg.encode('utf-8'))
    except Exception as e:
        print(f"❌ [전송 실패] {e}")

@app.post("/update_mode/{robot_id}")
async def update_mode(robot_id: str, mode_data: dict):
    mode = mode_data.get("mode", "UNKNOWN")
    status_code = "CONTROL" if mode == "CONTROL" else "MONITOR"
    send_to_gateway(robot_id, status_code)
    return {"status": "success"}

@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: str, file: UploadFile = File(...)):
    """ ✅ 데이터 수신부 (유령 로그 차단 로직 적용) """
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None: return {"status": "fail"}

        last_seen[robot_id] = time.time()

        # 1. 시청자가 없으면 AI 탐지 자체를 스킵 (CPU 절약)
        if robot_id not in active_viewers:
            camera_streams[robot_id] = frame
            return {"status": "ignored"}

        # 2. AI 탐지 수행
        annotated_frame, new_ids, all_objects = detector.detect_and_track(robot_id, frame)

        # 3. 위험 감지 및 로그 전송 로직
        if new_ids:
            # 🚀 [수정] '인증된 시청자'일 때만 DANGER 로그 전송
            # 브라우저가 몰래 재접속 중일 때는(verified 아님) 로그를 막음
            if robot_id in verified_viewers:
                if current_device_status.get(robot_id) != "DANGER":
                    current_device_status[robot_id] = "DANGER"
                    send_to_gateway(robot_id, "DANGER")
            
            # 타이머는 계속 리셋 (화면 켰을 때 바로 알 수 있게)
            last_heartbeat_times[robot_id] = time.time()
        else:
            if current_device_status.get(robot_id) == "DANGER":
                current_device_status[robot_id] = "SAFE"
                last_heartbeat_times[robot_id] = time.time()

        # 4. 정기 보고 (SAFE) - 인증된 시청자가 있을 때만 전송
        last_send = last_heartbeat_times.get(robot_id, 0)
        if time.time() - last_send >= HEARTBEAT_INTERVAL:
            if robot_id in verified_viewers and current_device_status.get(robot_id) != "DANGER":
                send_to_gateway(robot_id, "SAFE")
                last_heartbeat_times[robot_id] = time.time()

        camera_streams[robot_id] = annotated_frame
        return {"status": "ok"}
    except: return {"status": "error"}

@app.get("/video_feed/{cam_id}")
def video_feed(cam_id: str):
    """ ✅ 웹 스트리밍 송출부 """
    def generate():
        is_logged = False
        active_viewers.add(cam_id) # 1단계: 요청 접수
        
        try:
            while True:
                current_time = time.time()
                is_device_active = (cam_id in camera_streams) and (current_time - last_seen.get(cam_id, 0) < 1.0)

                if is_device_active:
                    if not is_logged:
                        print(f"✅ [연결 확정] {cam_id}")
                        send_to_gateway(cam_id, "CONNECTED")
                        
                        # ✨ [핵심] 연결 로그를 보낸 시점에 '인증된 시청자'로 등록
                        verified_viewers.add(cam_id) 
                        is_logged = True
                    
                    frame = camera_streams[cam_id]
                    ret, buffer = cv2.imencode('.jpg', frame)
                    if ret:
                        yield (b'--frame\r\n' b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                else:
                    if is_logged:
                        print(f"⏳ [타임아웃] {cam_id}")
                        send_to_gateway(cam_id, "DISCONNECTED")
                        
                        # 연결 끊김 시 인증 해제
                        if cam_id in verified_viewers: verified_viewers.remove(cam_id)
                        is_logged = False
                        
                    time.sleep(0.5)
                time.sleep(0.04) 

        except (GeneratorExit, OSError):
            print(f"👋 [사용자 이탈] {cam_id}")
        finally:
            # 종료 시 모든 목록에서 제거
            if cam_id in active_viewers: active_viewers.remove(cam_id)
            if cam_id in verified_viewers: verified_viewers.remove(cam_id)
            
            current_device_status[cam_id] = "SAFE"
            
            if is_logged:
                print(f"❌ [연결 해제] {cam_id}")
                send_to_gateway(cam_id, "DISCONNECTED")

    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

if __name__ == "__main__":
    if sys.platform == 'win32':
        from asyncio.proactor_events import _ProactorBasePipeTransport
        def silence_event_loop_error(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                try: return func(*args, **kwargs)
                except (ConnectionResetError, OSError): pass
            return wrapper
        _ProactorBasePipeTransport._call_connection_lost = silence_event_loop_error(
            _ProactorBasePipeTransport._call_connection_lost
        )

    config = uvicorn.Config(app, host="0.0.0.0", port=PORT_ALGO, log_level="critical", access_log=False)
    server = uvicorn.Server(config)

    try:
        server.run()
    except (KeyboardInterrupt, asyncio.exceptions.CancelledError): pass
    finally: os._exit(0)