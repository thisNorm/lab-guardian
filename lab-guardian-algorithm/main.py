# main.py
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import uvicorn
from typing import Dict
import time

# [핵심] 우리가 만든 AI 모듈 불러오기
from ai_detector import AIDetector

app = FastAPI()

# CORS 설정
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 초기화 ---
robot_states: Dict[int, dict] = {}

# 서버 켜질 때 AI 모델도 같이 준비
# (이렇게 하면 요청 올 때마다 모델을 다시 로딩하지 않아 빨라짐)
detector = AIDetector() 

# --- [기능 1] 로봇 -> 서버 : 이미지 업로드 & AI 분석 ---
@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: int, file: UploadFile = File(...)):
    # 1. 이미지 디코딩 (파일 -> opencv 이미지)
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # 로봇 상태 초기화
    if robot_id not in robot_states:
        robot_states[robot_id] = {
            "frame": None, "status": "IDLE", 
            "last_seen": time.time(), "detected_objects": []
        }

    # ---------------------------------------------------------
    # 🧠 [모듈 사용] 복잡한 코드는 가라! 딱 한 줄로 해결
    # ---------------------------------------------------------
    annotated_frame, detected_classes = detector.detect_and_draw(frame)
    # ---------------------------------------------------------

    # 3. 비즈니스 로직 (사람 발견 시 경보)
    current_status = robot_states[robot_id]["status"]
    
    if "person" in detected_classes:
        if current_status != "DANGER":
            print(f"🚨 [경보] 로봇 {robot_id}번: 사람 감지됨!")
            robot_states[robot_id]["status"] = "DANGER"
    else:
        # 사람이 사라지면 복귀
        if current_status == "DANGER":
            robot_states[robot_id]["status"] = "IDLE"

    # 4. 결과 저장
    robot_states[robot_id]["frame"] = annotated_frame
    robot_states[robot_id]["last_seen"] = time.time()
    robot_states[robot_id]["detected_objects"] = detected_classes
    
    return {"status": "received"}

# --- [기능 2] 영상 스트리밍 ---
def generate_frames(robot_id: int):
    while True:
        current_frame = None
        if robot_id in robot_states:
            current_frame = robot_states[robot_id]["frame"]

        if current_frame is None:
            blank = np.zeros((240, 320, 3), np.uint8)
            cv2.putText(blank, "NO SIGNAL", (80, 120), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (255, 255, 255), 2)
            ret, buffer = cv2.imencode('.jpg', blank)
        else:
            ret, buffer = cv2.imencode('.jpg', current_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])

        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.03)

@app.get("/video_feed/{robot_id}")
def video_feed(robot_id: int):
    return StreamingResponse(generate_frames(robot_id), media_type="multipart/x-mixed-replace; boundary=frame")

# --- [기능 3] 로봇 상태 조회 ---
@app.get("/robots")
def get_active_robots():
    active_list = []
    current_time = time.time()
    
    for robot_id, data in list(robot_states.items()):
        if current_time - data["last_seen"] > 5:
            del robot_states[robot_id]
            continue

        active_list.append({
            "id": robot_id,
            "name": f"Rasbot #{robot_id}",
            "status": data["status"],
            "objects": data.get("detected_objects", [])
        })
    return sorted(active_list, key=lambda x: x["id"])

# --- [기능 4] 명령 제어 ---
@app.post("/command/{robot_id}/{action}")
def send_command(robot_id: int, action: str):
    print(f"📡 명령: {robot_id} -> {action}")
    if robot_id in robot_states:
        if action == "stop": robot_states[robot_id]["status"] = "IDLE"
        elif action == "start": robot_states[robot_id]["status"] = "PATROL"
    return {"result": "success"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)