# main.py
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import uvicorn
from typing import Dict
import asyncio

app = FastAPI()

# 1. CORS 설정: React(웹)에서 서버로 접속할 수 있게 허용
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. 로봇 상태 저장소 (메모리 DB 역할)
# robot_states[1] = 1번 로봇 상태, robot_states[2] = 2번 로봇 상태
robot_states: Dict[int, dict] = {
    1: {"frame": None, "status": "IDLE"},
    2: {"frame": None, "status": "OFFLINE"}
}

# --- [기능 1] 로봇 -> 서버 : 이미지 업로드 ---
@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: int, file: UploadFile = File(...)):
    # 받은 이미지를 읽어서 처리
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    
    # 상태 업데이트
    if robot_id not in robot_states:
        robot_states[robot_id] = {"frame": None, "status": "IDLE"}
    
    robot_states[robot_id]["frame"] = frame
    
    # (나중에 여기에 AI 분석 코드가 들어갑니다)
    
    return {"status": "received"}

# --- [기능 2] 서버 -> React : 실시간 영상 스트리밍 ---
def generate_frames(robot_id: int):
    while True:
        # 1. 로봇의 최신 프레임 가져오기
        current_frame = None
        if robot_id in robot_states:
            current_frame = robot_states[robot_id]["frame"]

        if current_frame is None:
            blank_image = np.zeros((240, 320, 3), np.uint8)
            cv2.putText(blank_image, "NO SIGNAL", (80, 120), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            ret, buffer = cv2.imencode('.jpg', blank_image)
        else:
            # 2. 이미 로봇이 압축해서 보냈지만, 화면 표시용으로 다시 인코딩
            # (속도를 위해 품질 70 정도로 설정)
            ret, buffer = cv2.imencode('.jpg', current_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])

        frame_bytes = buffer.tobytes()
        
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')
        
        # [수정됨] time.sleep을 0.01로 줄이거나 아예 삭제하세요.
        # 로봇이 30fps로 보내면 여기서 굳이 쉴 필요가 없습니다.
        import time
        time.sleep(0.005)

@app.get("/video_feed/{robot_id}")
def video_feed(robot_id: int):
    return StreamingResponse(generate_frames(robot_id), media_type="multipart/x-mixed-replace; boundary=frame")

# --- [기능 3] React -> 서버 -> 로봇 : 명령 내리기 ---
@app.post("/command/{robot_id}/{action}")
def send_command(robot_id: int, action: str):
    print(f"🤖 [명령 수신] 로봇 {robot_id}호기 : {action}")
    
    # 웹 화면 상태 업데이트
    if robot_id in robot_states:
        if action == "start":
            robot_states[robot_id]["status"] = "PATROL"
        elif action == "stop":
            robot_states[robot_id]["status"] = "IDLE"
            
    return {"result": "success"}

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)