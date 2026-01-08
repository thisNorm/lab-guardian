# algorithm/main.py
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import requests
import time
import threading
from ai_detector import AIDetector
import config  # 설정 파일 (PC_IP, NEST_API_URL 등 포함)

app = FastAPI()

# CORS 설정: 웹 브라우저에서 분석 영상에 접근할 수 있도록 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = AIDetector()
# 로봇 및 IP 카메라의 분석된 프레임을 통합 관리
camera_streams = {}

# 공통: NestJS 백엔드(8000)로 감지 이벤트 보고 함수
def report_to_nestjs(cam_id, label):
    try:
        payload = {
            "cam_id": cam_id,
            "status": "DANGER",
            "message": f"{label} 감지! 상황을 확인하세요."
        }
        # 아까 만든 NestJS의 CctvController 주소로 전송
        requests.post(f"{config.NEST_API_URL}/api/cctv/detect", json=payload, timeout=0.2)
    except Exception as e:
        # 테스트 중 서버가 꺼져 있어도 알고리즘이 멈추지 않게 예외처리
        pass

# --- [기능 1] 로봇(USB 카메라)이 이미지를 업로드할 때 ---
@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: str, file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    if frame is None:
        return {"status": "fail", "reason": "image decode error"}

    # AI 분석 수행 (박스 그리기 등)
    annotated_frame, detected_classes = detector.detect_and_draw(frame)
    camera_streams[robot_id] = annotated_frame

    # 사람 감지 시 보고
    if "person" in detected_classes:
        report_to_nestjs(f"Robot_{robot_id}", "사람")

    return {"status": "ok"}

# --- [기능 2] IP 카메라 직접 연동 (RTSP/HTTP) ---
def ip_cam_worker(cam_id, url):
    print(f"📡 IP 카메라 시작: {cam_id}")
    cap = cv2.VideoCapture(url)
    while True:
        ret, frame = cap.read()
        if not ret:
            time.sleep(2)
            cap.open(url)
            continue

        # AI 분석
        annotated_frame, detected_classes = detector.detect_and_draw(frame)
        camera_streams[cam_id] = annotated_frame

        if "person" in detected_classes:
            report_to_nestjs(cam_id, "침입자")
        
        # 성능을 위해 약간의 지연 (30fps 타겟)
        time.sleep(0.01)

# --- [기능 3] 웹으로 영상 송출 (MJPEG) ---
@app.get("/video_feed/{cam_id}")
def video_feed(cam_id: str):
    def generate():
        while True:
            if cam_id in camera_streams:
                ret, buffer = cv2.imencode('.jpg', camera_streams[cam_id])
                if ret:
                    frame_bytes = buffer.tobytes()
                    yield (b'--frame\r\n'
                           b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
            time.sleep(0.04) # 약 25 FPS
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

# 서버 시작 시 IP 카메라가 있다면 여기서 스레드 가동
@app.on_event("startup")
async def startup_event():
    # 예시: IP 카메라 추가 시 아래 주석 해제
    # threading.Thread(target=ip_cam_worker, args=("CCTV_01", "rtsp://주소"), daemon=True).start()
    pass

if __name__ == "__main__":
    import uvicorn
    # uvicorn 실행 시 포트는 config에서 정의한 3000번 사용
    uvicorn.run(app, host="0.0.0.0", port=config.PORT_ALGO)