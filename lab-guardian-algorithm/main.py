import time, socket, cv2, numpy as np
import logging
import torch
import psutil
import uvicorn, os, asyncio, sys
from functools import wraps
from contextlib import asynccontextmanager
from fastapi import FastAPI, UploadFile, File, HTTPException, Request
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

logging.getLogger("uvicorn").setLevel(logging.CRITICAL)
logging.getLogger("uvicorn.error").setLevel(logging.CRITICAL)
logging.getLogger("uvicorn.access").setLevel(logging.CRITICAL)
logging.getLogger("uvicorn.protocols.http.h11_impl").setLevel(logging.CRITICAL)
logging.getLogger("uvicorn.protocols.http").setLevel(logging.CRITICAL)
logging.getLogger("asyncio").setLevel(logging.CRITICAL)

cv2.setNumThreads(1)
cv2.ocl.setUseOpenCL(False)

TELEGRAM_TOKEN = os.getenv("TELEGRAM_TOKEN")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID")
PC_IP = os.getenv("PC_IP")
PORT_GATEWAY = 8888
PORT_ALGO = 3000

STREAM_FPS = float(os.getenv("STREAM_FPS", "12"))
DETECT_FPS = float(os.getenv("DETECT_FPS", "3"))
STREAM_WIDTH = int(os.getenv("STREAM_WIDTH", "1280"))
STREAM_HEIGHT = int(os.getenv("STREAM_HEIGHT", "720"))
STREAM_SIZE = (STREAM_WIDTH, STREAM_HEIGHT)

JPEG_QUALITY = int(os.getenv("JPEG_QUALITY", "85"))

# RTSP 지연 최소화 옵션 (FFmpeg)
OPENCV_FFMPEG_CAPTURE_OPTIONS = os.getenv(
    "OPENCV_FFMPEG_CAPTURE_OPTIONS",
    "rtsp_transport;tcp|fflags;nobuffer|flags;low_delay|max_delay;0|reorder_queue_size;0|stimeout;2000000"
)
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = OPENCV_FFMPEG_CAPTURE_OPTIONS

if not TELEGRAM_TOKEN or not PC_IP:
    print("❌ [오류] .env 파일 설정이 누락되었습니다.")
    sys.exit(1)
# ======================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_running_loop()
    def _handler(loop, context):
        msg = context.get("message", "")
        if "socket.send() raised exception" in msg:
            return
        loop.default_exception_handler(context)
    loop.set_exception_handler(_handler)
    yield

app = FastAPI(lifespan=lifespan)
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
camera_sources = {}
last_seen = {}
last_heartbeat = {}
device_status = {}
active_viewers = set()
verified_viewers = set()
monitoring_enabled = set()
last_alert_times = {}
ALERT_COOLDOWN = 30
error_last_log = {}
ERROR_LOG_COOLDOWN = 5.0
last_stream_sent = {}
last_detect_time = {}
last_annotated_frames = {}
stream_tasks = {}
stream_stop_events = {}
stream_jpeg_cache = {}
viewer_counts = {}

def _encode_jpeg(frame):
    params = [int(cv2.IMWRITE_JPEG_QUALITY), JPEG_QUALITY]
    ret, buf = cv2.imencode('.jpg', frame, params)
    return buf if ret else None

async def _stream_worker(cam_id):
    source = camera_sources.get(cam_id)
    is_rtsp = source and source.get("type") == "rtsp"
    cap = None
    try:
        while not stream_stop_events[cam_id].is_set():
            await asyncio.sleep(0.01)
            now = time.time()
            if now - last_stream_sent.get(cam_id, 0) < (1.0 / STREAM_FPS):
                continue

            if is_rtsp:
                if cap is None or not cap.isOpened():
                    cap = cv2.VideoCapture(source.get("url"), cv2.CAP_FFMPEG)
                    try:
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    except Exception:
                        pass
                    if not cap.isOpened():
                        buf = _encode_jpeg(offline_frame)
                        if buf is not None:
                            stream_jpeg_cache[cam_id] = buf.tobytes()
                            last_stream_sent[cam_id] = now
                        await asyncio.sleep(0.5)
                        continue
                ok, frame = cap.read()
                if not ok or frame is None:
                    if cap is not None:
                        cap.release()
                    cap = None
                    buf = _encode_jpeg(offline_frame)
                    if buf is not None:
                        stream_jpeg_cache[cam_id] = buf.tobytes()
                        last_stream_sent[cam_id] = now
                    await asyncio.sleep(0.5)
                    continue

                display_frame = frame
                if cam_id in monitoring_enabled:
                    if now - last_detect_time.get(cam_id, 0) >= (1.0 / DETECT_FPS):
                        display_frame, _ = process_detection(
                            cam_id,
                            frame,
                            now,
                            require_verified_viewer=False,
                        )
                        last_detect_time[cam_id] = now
                        last_annotated_frames[cam_id] = display_frame
                    else:
                        display_frame = last_annotated_frames.get(cam_id, frame)
                if STREAM_SIZE and (display_frame.shape[1], display_frame.shape[0]) != STREAM_SIZE:
                    display_frame = cv2.resize(display_frame, STREAM_SIZE)

                buf = _encode_jpeg(display_frame)
                if buf is not None:
                    stream_jpeg_cache[cam_id] = buf.tobytes()
                    last_stream_sent[cam_id] = now
                continue

            # robot/usb: use latest frame if available
            frame = camera_streams.get(cam_id)
            if frame is None:
                buf = _encode_jpeg(offline_frame)
                if buf is not None:
                    stream_jpeg_cache[cam_id] = buf.tobytes()
                    last_stream_sent[cam_id] = now
                await asyncio.sleep(0.5)
                continue

            display_frame = frame
            if STREAM_SIZE and (display_frame.shape[1], display_frame.shape[0]) != STREAM_SIZE:
                display_frame = cv2.resize(display_frame, STREAM_SIZE)

            buf = _encode_jpeg(display_frame)
            if buf is not None:
                stream_jpeg_cache[cam_id] = buf.tobytes()
                last_stream_sent[cam_id] = now
    finally:
        if cap is not None:
            cap.release()

async def ensure_stream_task(cam_id):
    if cam_id in stream_tasks and not stream_tasks[cam_id].done():
        return
    stream_stop_events[cam_id] = asyncio.Event()
    stream_tasks[cam_id] = asyncio.create_task(_stream_worker(cam_id))

def create_offline_frame():
    img = np.zeros((480, 640, 3), dtype=np.uint8)
    cv2.putText(img, "DISCONNECTED", (180, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
    return img
offline_frame = create_offline_frame()

def build_rtsp_url(ip, username, password, stream="sub", port=554, path=None):
    stream_path = path.lstrip("/") if path else ("stream1" if stream == "main" else "stream2")
    if username or password:
        return f"rtsp://{username}:{password}@{ip}:{port}/{stream_path}"
    return f"rtsp://{ip}:{port}/{stream_path}"

def mask_rtsp_url(ip, stream="sub", port=554, path=None):
    stream_path = path.lstrip("/") if path else ("stream1" if stream == "main" else "stream2")
    return f"{ip}:{port}/{stream_path}"

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
        now = time.time()
        key = f"gateway:{cam_id}"
        if now - error_last_log.get(key, 0) > ERROR_LOG_COOLDOWN:
            error_last_log[key] = now
            print(f"❌ [전송 실패] {e}")

def process_detection(cam_id, frame, current_time, require_verified_viewer):
    annotated_frame, new_ids, _ = detector.detect_and_track(cam_id, frame)

    if new_ids and (not require_verified_viewer or cam_id in verified_viewers):
        status_changed = False
        if device_status.get(cam_id) != "DANGER":
            device_status[cam_id] = "DANGER"
            status_changed = True

        if current_time - last_alert_times.get(cam_id, 0) > ALERT_COOLDOWN:
            img_path = recorder.save_snapshot(cam_id, frame)
            notifier.send_photo(cam_id, frame)
            recorder.start_recording(cam_id, duration=10.0, current_time=current_time)
            send_to_gateway(cam_id, "침입자 감지(스냅샷)", image_path=img_path)
            last_alert_times[cam_id] = current_time
        elif status_changed:
            send_to_gateway(cam_id, "DANGER")

        last_heartbeat[cam_id] = current_time

    elif not new_ids and device_status.get(cam_id) == "DANGER":
        device_status[cam_id] = "SAFE"
        last_heartbeat[cam_id] = current_time
        send_to_gateway(cam_id, "SAFE")

    return annotated_frame, new_ids

@app.get("/system/runtime")
def system_runtime():
    # 관측용: 추론 디바이스 및 CPU 사용률 노출
    is_cuda = torch.cuda.is_available()
    device = "cuda" if is_cuda else "cpu"
    gpu_name = torch.cuda.get_device_name(0) if is_cuda else None
    cpu_usage = psutil.cpu_percent(interval=0.1)
    return {
        "device": device,
        "gpu_name": gpu_name,
        "cpu_usage_percent": cpu_usage,
    }

@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: str, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if frame is None: return {"status": "fail"}

        current_time = time.time()
        last_seen[robot_id] = current_time

        # 스트리밍용 프레임은 항상 최신으로 유지
        camera_streams[robot_id] = frame
        # 감시 활성 상태가 아니라면 탐지/알림은 생략 (스트림 연결과 분리)
        if robot_id not in monitoring_enabled:
            return {"status": "ignored"}

        annotated_frame, new_ids = process_detection(
            robot_id,
            frame,
            current_time,
            require_verified_viewer=True,
        )

        recorder.process_frame(robot_id, frame, current_time)

        if current_time - last_heartbeat.get(robot_id, 0) >= 600:
            if robot_id in verified_viewers and device_status.get(robot_id) != "DANGER":
                send_to_gateway(robot_id, "SAFE")
                last_heartbeat[robot_id] = current_time

        camera_streams[robot_id] = annotated_frame
        return {"status": "ok"}
    except Exception as e:
        print(f"❌ [upload_frame 오류] {robot_id}: {e}")
        return {"status": "error"}

@app.post("/cameras/register")
async def register_camera(payload: dict):
    cam_id = str(payload.get("cam_id", "")).strip()
    ip = str(payload.get("ip", "")).strip()
    username = str(payload.get("username", "")).strip()
    password = str(payload.get("password", "")).strip()
    stream = str(payload.get("stream", "sub")).strip().lower() or "sub"
    path = str(payload.get("path", "")).strip() or None
    port_raw = payload.get("port", 554)
    try:
        port = int(port_raw)
    except Exception:
        port = 554
    if stream not in ("sub", "main"):
        stream = "sub"

    if not cam_id or not ip:
        raise HTTPException(status_code=400, detail="cam_id and ip are required")

    rtsp_url = build_rtsp_url(ip, username, password, stream, port=port, path=path)
    masked = mask_rtsp_url(ip, stream, port=port, path=path)

    try:
        cap = cv2.VideoCapture(rtsp_url, cv2.CAP_FFMPEG)
        if not cap.isOpened():
            cap.release()
            raise HTTPException(status_code=400, detail="RTSP connection failed")
        cap.read()
        cap.release()
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="RTSP connection error")

    camera_sources[cam_id] = {"type": "rtsp", "url": rtsp_url}
    print(f"[rtsp] registered {cam_id} -> {masked}")
    return {"status": "connected", "cam_id": cam_id, "stream": stream}

@app.get("/video_feed/{cam_id}")
async def video_feed(cam_id: str, request: Request):
    async def generate():
        active_viewers.add(cam_id)
        viewer_counts[cam_id] = viewer_counts.get(cam_id, 0) + 1
        if viewer_counts[cam_id] == 1:
            send_to_gateway(cam_id, "CONNECTED")
            verified_viewers.add(cam_id)
        await ensure_stream_task(cam_id)
        def make_payload(buf_bytes):
            return b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buf_bytes + b'\r\n'
        try:
            while True:
                if await request.is_disconnected():
                    break
                await asyncio.sleep(0.03)
                buf_bytes = stream_jpeg_cache.get(cam_id)
                if buf_bytes is None:
                    offline_buf = _encode_jpeg(offline_frame)
                    if offline_buf is not None:
                        buf_bytes = offline_buf.tobytes()
                if buf_bytes is None:
                    continue
                try:
                    yield make_payload(buf_bytes)
                except Exception:
                    break
        finally:
            active_viewers.discard(cam_id)
            viewer_counts[cam_id] = max(0, viewer_counts.get(cam_id, 1) - 1)
            if viewer_counts.get(cam_id, 0) == 0:
                send_to_gateway(cam_id, "DISCONNECTED")
                verified_viewers.discard(cam_id)
                if cam_id in stream_stop_events:
                    stream_stop_events[cam_id].set()
            last_stream_sent.pop(cam_id, None)
            last_detect_time.pop(cam_id, None)
            last_annotated_frames.pop(cam_id, None)
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/update_mode/{robot_id}")
async def update_mode(robot_id: str, mode_data: dict):
    mode = mode_data.get("mode", "UNKNOWN")
    send_to_gateway(robot_id, "CONTROL" if mode == "CONTROL" else "MONITOR")
    return {"status": "success"}

@app.post("/stop_monitoring/{cam_id}")
def stop_monitoring(cam_id: str):
    return stop_monitoring_explicit(cam_id)

@app.post("/monitoring/start/{cam_id}")
def start_monitoring(cam_id: str):
    monitoring_enabled.add(cam_id)
    device_status[cam_id] = device_status.get(cam_id, "SAFE")
    return {"status": "monitoring_enabled"}

@app.post("/monitoring/stop/{cam_id}")
def stop_monitoring_explicit(cam_id: str):
    # 감시 비활성화: 탐지/알림 중단(스트리밍과 무관)
    monitoring_enabled.discard(cam_id)
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
