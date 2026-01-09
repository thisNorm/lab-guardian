# main.py
import logging
import sys
import time
import threading
import requests
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# ✅ 커스텀 모듈 임포트
from ai_detector import AIDetector
from centroidtracker import CentroidTracker 
import config 

# 1. FastAPI 앱 생성
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = AIDetector()

# 상태 관리 변수들
camera_streams = {} # 영상 데이터
last_seen = {}      # 오프라인 감지용 시간
trackers = {}       # ✅ 카메라별 추적기 관리 { "cam_1": CentroidTracker(), ... }

# --- [강력한 로그 차단 설정] ---
logging.getLogger("uvicorn").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
logging.getLogger("uvicorn.error").setLevel(logging.WARNING)

def report_to_nestjs(cam_id, label):
    """
    NestJS로 알람을 보냅니다. (이 함수가 호출될 때는 이미 '새로운 사람'임이 검증된 상태입니다)
    """
    try:
        payload = {
            "cam_id": cam_id,
            "status": "DANGER",
            "message": f"{label} 감지! 상황을 확인하세요."
        }
        print(f"🚨 [EVENT] {cam_id}: {label} 데이터 전송 (DB 저장 요청)") 
        # timeout을 짧게 주어 영상 처리에 방해되지 않게 함
        requests.post(f"{config.NEST_API_URL}/api/cctv/detect", json=payload, timeout=0.2)
    except:
        pass

@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: str, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None:
            return {"status": "fail"}

        # ✅ 1. 장치 연결 상태 업데이트
        if robot_id not in last_seen:
            print(f"✅ [STATUS] 장치 연결됨 (ON): {robot_id}")
            # 새로운 장치면 트래커도 새로 생성
            trackers[robot_id] = CentroidTracker(maxDisappeared=40)
        
        last_seen[robot_id] = time.time()
        
        # ✅ 2. AI 탐지 (좌표 받아오기)
        annotated_frame, person_rects = detector.detect_and_draw(frame)

        # ✅ 3. 추적기 업데이트 (해당 로봇의 트래커 사용)
        if robot_id not in trackers:
            trackers[robot_id] = CentroidTracker(maxDisappeared=40)
            
        objects = trackers[robot_id].update(person_rects)

        # ✅ 4. 신규 침입자 확인 및 로그 전송
        # 이번 프레임에 '새로' 할당된 ID가 있는가?
        if trackers[robot_id].new_detected_ids:
            for new_id in trackers[robot_id].new_detected_ids:
                msg = f"침입자 (ID: {new_id})"
                report_to_nestjs(robot_id, msg) # ★ 여기서만 로그가 전송됨!

        # ✅ 5. 화면에 ID 그리기 (시각적 확인용)
        for (objectID, centroid) in objects.items():
            text = f"ID {objectID}"
            cv2.putText(annotated_frame, text, (centroid[0] - 10, centroid[1] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            cv2.circle(annotated_frame, (centroid[0], centroid[1]), 4, (0, 255, 0), -1)

        # 스트림 업데이트
        camera_streams[robot_id] = annotated_frame

        return {"status": "ok"}
    except Exception as e:
        # 에러 발생 시에도 서버가 죽지 않도록 처리
        # print(f"Error: {e}") 
        return {"status": "error"}

@app.get("/video_feed/{cam_id}")
def video_feed(cam_id: str):
    def generate():
        try:
            print(f"📺 [STREAM] 웹 대시보드 송출 시작: {cam_id}")
            while True:
                if cam_id in camera_streams:
                    # JPEG 인코딩
                    ret, buffer = cv2.imencode('.jpg', camera_streams[cam_id])
                    if ret:
                        yield (b'--frame\r\n'
                               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                time.sleep(0.04) # 25 FPS 제한
        except Exception:
            print(f"🔌 [STREAM] 웹 대시보드 송출 종료: {cam_id}")
            pass
            
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

# ✅ 오프라인 감지 스레드
def check_offline_devices():
    while True:
        current_time = time.time()
        for robot_id in list(last_seen.keys()):
            # 5초 이상 통신 없으면 오프라인 처리
            if current_time - last_seen[robot_id] > 5.0:
                print(f"❌ [STATUS] 장치 연결 끊김 (OFF): {robot_id}")
                del last_seen[robot_id]
                if robot_id in camera_streams:
                    del camera_streams[robot_id]
                # 연결 끊기면 트래커도 삭제할지, 유지할지 결정 (보통 삭제 추천)
                if robot_id in trackers:
                    del trackers[robot_id]
        time.sleep(2)

threading.Thread(target=check_offline_devices, daemon=True).start()

if __name__ == "__main__":
    import uvicorn
    
    print(f"🚀 알고리즘 서버 시작 중... (Port: {config.PORT_ALGO})")
    
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=config.PORT_ALGO, 
        loop="asyncio",
        access_log=False,
        log_level="warning"
    )