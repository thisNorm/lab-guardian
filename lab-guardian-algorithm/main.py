# main.py
import logging
import sys
import time
import threading
import socket
import cv2
import numpy as np
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware

# 커스텀 모듈
from ai_detector import AIDetector
from centroidtracker import CentroidTracker 

# 1. 설정 (보내주신 Config 내용 반영)
PC_IP = "192.168.0.149"      # C# 게이트웨이가 있는 PC IP
PORT_GATEWAY = 8888          # C# TCP 포트
PORT_ALGO = 3000             # 이 파이썬 서버의 포트

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

detector = AIDetector()
camera_streams = {} 
last_seen = {}      
trackers = {}       

logging.getLogger("uvicorn").setLevel(logging.WARNING)

# ------------------------------------------------------------------
# ✅ [핵심] C# 게이트웨이(192.168.0.149:8888)로 데이터 전송
# ------------------------------------------------------------------
def send_to_gateway(status_msg):
    try:
        # 설정된 IP와 포트로 접속
        TARGET_IP = PC_IP 
        TARGET_PORT = PORT_GATEWAY

        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.settimeout(0.1) 
            s.connect((TARGET_IP, TARGET_PORT))
            s.sendall(status_msg.encode('utf-8'))
            
    except Exception as e:
        pass

@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: str, file: UploadFile = File(...)):
    try:
        contents = await file.read()
        nparr = np.frombuffer(contents, np.uint8)
        frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

        if frame is None: return {"status": "fail"}

        if robot_id not in last_seen:
            print(f"✅ [STATUS] 장치 연결됨 (ON): {robot_id}")
            trackers[robot_id] = CentroidTracker(maxDisappeared=40)
        
        last_seen[robot_id] = time.time()
        
        annotated_frame, person_rects = detector.detect_and_draw(frame)

        if robot_id not in trackers:
            trackers[robot_id] = CentroidTracker(maxDisappeared=40)
            
        objects = trackers[robot_id].update(person_rects)

        # ---------------------------------------------------------
        # 상태 판별 및 전송
        # ---------------------------------------------------------
        current_status = "IDLE"
        if len(objects) > 0:
            current_status = "DANGER"
            print(f"🚨 [ALGO] 침입자 {len(objects)}명 감지 -> C# ({PC_IP}) 전송")
        
        send_to_gateway(current_status)
        # ---------------------------------------------------------

        for (objectID, centroid) in objects.items():
            text = f"ID {objectID}"
            cv2.putText(annotated_frame, text, (centroid[0] - 10, centroid[1] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            cv2.circle(annotated_frame, (centroid[0], centroid[1]), 4, (0, 255, 0), -1)

        camera_streams[robot_id] = annotated_frame
        return {"status": "ok"}
    except Exception:
        return {"status": "error"}

@app.get("/video_feed/{cam_id}")
def video_feed(cam_id: str):
    def generate():
        try:
            print(f"📺 [STREAM] 송출 시작: {cam_id}")
            while True:
                if cam_id in camera_streams:
                    ret, buffer = cv2.imencode('.jpg', camera_streams[cam_id])
                    if ret:
                        yield (b'--frame\r\n'
                               b'Content-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
                time.sleep(0.04) 
        except Exception:
            pass
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

def check_offline_devices():
    while True:
        current_time = time.time()
        for robot_id in list(last_seen.keys()):
            if current_time - last_seen[robot_id] > 5.0:
                print(f"❌ [STATUS] 장치 연결 끊김: {robot_id}")
                del last_seen[robot_id]
                if robot_id in camera_streams: del camera_streams[robot_id]
                if robot_id in trackers: del trackers[robot_id]
        time.sleep(2)

threading.Thread(target=check_offline_devices, daemon=True).start()

if __name__ == "__main__":
    import uvicorn
    print(f"🚀 알고리즘 서버 시작 (http://{PC_IP}:{PORT_ALGO})")
    # 외부(웹)에서 접근 가능하도록 0.0.0.0으로 엽니다.
    uvicorn.run(app, host="0.0.0.0", port=PORT_ALGO, log_level="warning")