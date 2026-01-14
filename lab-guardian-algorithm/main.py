import time, socket, cv2, numpy as np
import uvicorn, os, asyncio, sys
from functools import wraps
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware 
from fastapi.staticfiles import StaticFiles 
from dotenv import load_dotenv # 환경변수 로드

# ✅ functions 폴더에서 모듈 불러오기
from functions.ai_detector import AIDetector
from functions.notifier import TelegramNotifier
from functions.recorder import VideoRecorder

# ================= 설정 (환경변수 적용) =================
load_dotenv() # .env 파일 로딩

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
PC_IP = os.getenv("PC_IP")
PORT_GATEWAY = 8888
PORT_ALGO = 3000

if not TELEGRAM_TOKEN or not PC_IP:
    print("❌ [오류] .env 파일 설정이 누락되었습니다.")
    sys.exit(1)
# ======================================================

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# recordings 폴더 개방
os.makedirs("recordings", exist_ok=True)
app.mount("/recordings", StaticFiles(directory="recordings"), name="recordings")

# ✅ 모듈 초기화
detector = AIDetector()
notifier = TelegramNotifier(TELEGRAM_TOKEN, TELEGRAM_CHAT_ID)
recorder = VideoRecorder(save_dir="recordings")

# 상태 변수들
camera_streams = {}
last_seen = {}
last_heartbeat = {}
device_status = {}
active_viewers = set()
verified_viewers = set()
last_alert_times = {}
ALERT_COOLDOWN = 30

def create_offline_frame():
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "DISCONNECTED", (180, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
    return img
offline_frame = create_offline_frame()

def send_to_gateway(cam_id, status_msg, image_path=None):
    try:
        full_msg = f"{cam_id}:{status_msg}"
        if image_path:
            full_msg += f":{image_path}"
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            s.connect((PC_IP, PORT_GATEWAY))
            s.sendall(full_msg.encode('utf-8'))
            print(f"📡 [전송] {full_msg}") 
    except Exception as e:
        print(f"❌ [전송 실패] {e}")

@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: str, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None: return {"status": "fail"}

        current_time = time.time()
        last_seen[robot_id] = current_time

        if robot_id not in active_viewers:
            camera_streams[robot_id] = frame
            return {"status": "ignored"}

        annotated_frame, new_ids, _ = detector.detect_and_track(robot_id, frame)

        if new_ids and robot_id in verified_viewers:
            status_changed = False
            if device_status.get(robot_id) != "DANGER":
                device_status[robot_id] = "DANGER"
                status_changed = True

            if current_time - last_alert_times.get(robot_id, 0) > ALERT_COOLDOWN:
                img_path = recorder.save_snapshot(robot_id, frame)
                notifier.send_photo(robot_id, frame)
                recorder.start_recording(robot_id, duration=10.0, current_time=current_time)
                send_to_gateway(robot_id, "침입자 감지(스냅샷)", image_path=img_path)
                last_alert_times[robot_id] = current_time
            
            elif status_changed:
                send_to_gateway(robot_id, "DANGER")
            
            last_heartbeat[robot_id] = current_time
        
        elif not new_ids and device_status.get(robot_id) == "DANGER":
            device_status[robot_id] = "SAFE"
            last_heartbeat[robot_id] = current_time

        recorder.process_frame(robot_id, frame, current_time)

        if current_time - last_heartbeat.get(robot_id, 0) >= 600:
            if robot_id in verified_viewers and device_status.get(robot_id) != "DANGER":
                send_to_gateway(robot_id, "SAFE")
                last_heartbeat[robot_id] = current_time

        camera_streams[robot_id] = annotated_frame
        return {"status": "ok"}
    except: return {"status": "error"}

@app.get("/video_feed/{cam_id}")
def video_feed(cam_id: str):
    def generate():
        active_viewers.add(cam_id)
        is_logged = False
        try:
            while True:
                time.sleep(0.04)
                if cam_id not in camera_streams:
                     ret, buf = cv2.imencode('.jpg', offline_frame)
                     if ret: yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
                     time.sleep(0.5)
                     continue
                if time.time() - last_seen.get(cam_id, 0) < 1.0:
                    if not is_logged:
                        send_to_gateway(cam_id, "CONNECTED")
                        verified_viewers.add(cam_id)
                        is_logged = True
                    try:
                        ret, buf = cv2.imencode('.jpg', camera_streams[cam_id])
                        if ret: yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
                    except: pass
                else:
                    if is_logged:
                        send_to_gateway(cam_id, "DISCONNECTED")
                        if cam_id in verified_viewers: verified_viewers.remove(cam_id)
                        is_logged = False
                    ret, buf = cv2.imencode('.jpg', offline_frame)
                    if ret: yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf.tobytes() + b'\r\n')
                    time.sleep(0.5)
        except: pass
        finally:
            active_viewers.discard(cam_id)
            verified_viewers.discard(cam_id)
            if is_logged: send_to_gateway(cam_id, "DISCONNECTED")
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/update_mode/{robot_id}")
async def update_mode(robot_id: str, mode_data: dict):
    mode = mode_data.get("mode", "UNKNOWN")
    send_to_gateway(robot_id, "CONTROL" if mode == "CONTROL" else "MONITOR")
    return {"status": "success"}

@app.post("/stop_monitoring/{cam_id}")
def stop_monitoring(cam_id: str):
    active_viewers.discard(cam_id)
    verified_viewers.discard(cam_id)
    device_status[cam_id] = "SAFE"
    send_to_gateway(cam_id, "DISCONNECTED")
    return {"status": "disconnected"}

if __name__ == "__main__":
    if sys.platform == 'win32':
        from asyncio.proactor_events import _ProactorBasePipeTransport
        _ProactorBasePipeTransport._call_connection_lost = lambda *args, **kwargs: None
    config = uvicorn.Config(app, host="0.0.0.0", port=PORT_ALGO, log_level="critical", access_log=False)
    uvicorn.Server(config).run()