# main.py
import time, socket, threading, cv2, numpy as np
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from ai_detector import AIDetector 
import struct

PC_IP = "192.168.0.149"
PORT_GATEWAY = 8888
PORT_ALGO = 3000

app = FastAPI()
detector = AIDetector()
camera_streams = {}
last_seen = {}
last_idle_sent_time = 0

def send_to_gateway(cam_id, status_msg):
    try:
        full_msg = f"{cam_id}:{status_msg}"
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(1.0) # 타임아웃을 0.1보다 조금 늘려 안정성 확보
            # 소켓 종료 시 잔여 데이터를 기다리는 옵션 (Linger)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_LINGER, struct.pack('ii', 1, 0))
            s.connect((PC_IP, PORT_GATEWAY))
            s.sendall(full_msg.encode('utf-8'))
    except (ConnectionResetError, socket.timeout):
        # 연결이 끊겼거나 타임아웃 시 로그만 남기고 무시 (자동 복구 유도)
        pass
    except Exception as e:
        print(f"📡 Gateway Send Error: {e}")

@app.post("/update_mode/{robot_id}")
async def update_mode(robot_id: str, mode_data: dict):
    """ ✅ 웹 대시보드 모드 전환 시 상태 전송 """
    mode = mode_data.get("mode", "UNKNOWN")
    status_code = "CONTROL" if mode == "CONTROL" else "MONITOR"
    send_to_gateway(robot_id, status_code)
    return {"status": "success"}

@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: str, file: UploadFile = File(...)):
    global last_idle_sent_time
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None: return {"status": "fail"}

        # ✅ 새로운 장치 연결 시 접속 로그 전송
        if robot_id not in last_seen:
            send_to_gateway(robot_id, "CONNECTED")

        last_seen[robot_id] = time.time()
        annotated_frame, new_ids, all_objects = detector.detect_and_track(robot_id, frame)

        current_time = time.time()
        
        # 🚨 위험 상황 발생 시 즉시 보고
        if new_ids:
            send_to_gateway(robot_id, "DANGER")
        # ✅ 안전 상황은 10분(600초) 주기로 SAFE 보고
        elif current_time - last_idle_sent_time >= 600:
            send_to_gateway(robot_id, "SAFE")
            last_idle_sent_time = current_time

        camera_streams[robot_id] = annotated_frame
        return {"status": "ok"}
    except: return {"status": "error"}

@app.get("/video_feed/{cam_id}")
def video_feed(cam_id: str):
    def generate():
        while True:
            if cam_id in camera_streams:
                ret, buffer = cv2.imencode('.jpg', camera_streams[cam_id])
                if ret:
                    yield (b'--frame\r\n' b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            time.sleep(0.04)
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

stop_event = threading.Event()

def check_offline_devices_safe():
    while not stop_event.is_set():
        current_time = time.time()
        for rid in list(last_seen.keys()):
            if stop_event.is_set(): break
            if current_time - last_seen[rid] > 5.0:
                if not stop_event.is_set():
                    # ✅ 연결 종료 시 로그 전송
                    send_to_gateway(rid, "DISCONNECTED")
                last_seen.pop(rid, None)
                camera_streams.pop(rid, None)
                detector.remove_tracker(rid)
        for _ in range(10):
            if stop_event.is_set(): break
            time.sleep(0.2)

monitor_thread = threading.Thread(target=check_offline_devices_safe, daemon=True)
monitor_thread.start()

if __name__ == "__main__":
    import uvicorn
    import os
    import asyncio
    import sys
    from functools import wraps

    # ---------------------------------------------------------
    # ✨ [추가] Windows asyncio ProactorEventLoop 10054 패치
    # ---------------------------------------------------------
    if sys.platform == 'win32':
        from asyncio.proactor_events import _ProactorBasePipeTransport

        def silence_event_loop_error(func):
            @wraps(func)
            def wrapper(*args, **kwargs):
                try:
                    return func(*args, **kwargs)
                except (ConnectionResetError, OSError):
                    # 연결이 이미 끊긴 소켓을 닫으려 할 때 발생하는 에러 무시
                    pass
            return wrapper

        # asyncio 내부의 연결 종료 콜백 함수를 에러 무시 버전으로 교체
        _ProactorBasePipeTransport._call_connection_lost = silence_event_loop_error(
            _ProactorBasePipeTransport._call_connection_lost
        )
    # ---------------------------------------------------------

    stop_event = threading.Event()

    # 오프라인 체크 스레드 시작 (기존 로직)
    monitor_thread = threading.Thread(target=check_offline_devices_safe, daemon=True)
    monitor_thread.start()

    config = uvicorn.Config(
        app, 
        host="0.0.0.0", 
        port=PORT_ALGO, 
        log_level="critical", 
        access_log=False
    )
    server = uvicorn.Server(config)

    try:
        server.run()
    except (KeyboardInterrupt, asyncio.exceptions.CancelledError):
        stop_event.set()
        print("\n👋 서버를 종료합니다...")
    finally:
        stop_event.set()
        print("✅ 터미널 제어권을 반환합니다.")
        # os._exit(0)는 모든 스레드를 강제 종료하고 터미널로 즉시 복귀시킵니다.
        os._exit(0)