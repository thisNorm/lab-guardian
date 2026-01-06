from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import uvicorn
from typing import Dict, List
import time

app = FastAPI()

# 1. CORS 설정 (React 접속 허용)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. 로봇 상태 저장소
robot_states: Dict[int, dict] = {}

# --- [기능 1] 로봇 -> 서버 : 이미지 업로드 & 생존신고 ---
@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: int, file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # 새로운 로봇이면 등록
    if robot_id not in robot_states:
        print(f"✨ 새로운 로봇 발견: ID {robot_id}")
        robot_states[robot_id] = {
            "frame": None, 
            "status": "IDLE",
            "last_seen": time.time()
        }
    
    # 프레임 갱신 및 마지막 통신 시간(last_seen) 업데이트
    robot_states[robot_id]["frame"] = frame
    robot_states[robot_id]["last_seen"] = time.time()
    
    return {"status": "received"}

# --- [기능 2] 서버 -> React : 영상 스트리밍 ---
def generate_frames(robot_id: int):
    while True:
        current_frame = None
        if robot_id in robot_states:
            current_frame = robot_states[robot_id]["frame"]

        if current_frame is None:
            # 신호 없을 때 검은 화면
            blank = np.zeros((480, 640, 3), np.uint8)
            cv2.putText(blank, "NO SIGNAL", (200, 240), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            ret, buffer = cv2.imencode('.jpg', blank)
        else:
            # 화질 90%로 송출
            ret, buffer = cv2.imencode('.jpg', current_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])

        frame_bytes = buffer.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        time.sleep(0.005)

@app.get("/video_feed/{robot_id}")
def video_feed(robot_id: int):
    return StreamingResponse(generate_frames(robot_id), media_type="multipart/x-mixed-replace; boundary=frame")

# --- [기능 3] 웹 -> 서버 : 로봇 명단 조회 (자동 삭제 로직 포함) ---
@app.get("/robots")
def get_active_robots():
    active_list = []
    current_time = time.time()
    
    # 딕셔너리 복사본으로 순회 (삭제 시 에러 방지)
    for robot_id, data in list(robot_states.items()):
        
        # [핵심] 5초 이상 연락 없으면 명단에서 삭제 (청소)
        if current_time - data["last_seen"] > 5:
            print(f"💀 로봇 {robot_id}호기 응답 없음 -> 삭제됨")
            del robot_states[robot_id]
            continue

        active_list.append({
            "id": robot_id,
            "name": f"Rasbot #{robot_id:02d}",
            "status": data["status"]
        })
    
    return sorted(active_list, key=lambda x: x["id"])

# --- [기능 4] 명령 제어 ---
@app.post("/command/{robot_id}/{action}")
def send_command(robot_id: int, action: str):
    if robot_id in robot_states:
        if action == "start":
            robot_states[robot_id]["status"] = "PATROL"
        elif action == "stop":
            robot_states[robot_id]["status"] = "IDLE"
    return {"result": "success"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)