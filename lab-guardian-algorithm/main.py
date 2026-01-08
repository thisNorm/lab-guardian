# algorithm/main.py
from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import requests
import time
from ai_detector import AIDetector
import config  # 설정 파일 불러오기

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"])

detector = AIDetector()
robot_frames = {} # 스트리밍용 임시 저장소

@app.post("/upload_frame/{robot_id}")
async def upload_frame(robot_id: int, file: UploadFile = File(...)):
    contents = await file.read()
    nparr = np.frombuffer(contents, np.uint8)
    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)

    # 1. AI 분석
    annotated_frame, detected_classes = detector.detect_and_draw(frame)
    robot_frames[robot_id] = annotated_frame

    # 2. 사람이 감지되면 NestJS 백엔드(8000)로 즉시 보고
    if "person" in detected_classes:
        try:
            payload = {
                "cam_id": f"Robot_{robot_id}",
                "status": "DANGER",
                "message": "사람이 감지되었습니다!"
            }
            requests.post(f"{config.NEST_API_URL}/api/detect", json=payload)
        except Exception as e:
            print(f"NestJS 보고 실패: {e}")

    return {"status": "ok"}

@app.get("/video_feed/{robot_id}")
def video_feed(robot_id: int):
    def generate():
        while True:
            if robot_id in robot_frames:
                _, buffer = cv2.imencode('.jpg', robot_frames[robot_id])
                yield (b'--frame\r\nContent-Type: image/jpeg\r\n\r\n' + buffer.tobytes() + b'\r\n')
            time.sleep(0.04)
    return StreamingResponse(generate(), media_type="multipart/x-mixed-replace; boundary=frame")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=config.PORT_ALGO)