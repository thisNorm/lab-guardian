import cv2
import requests
import time
import pyrealsense2 as rs
import numpy as np
import config 
import sys

SERVER_IP = f"http://192.168.0.131:{config.PORT_ALGO}" 
WIDTH, HEIGHT = 320, 240 

class RealSenseCamera:
    def __init__(self):
        self.id = "CCTV_RealSense_999" # 웹에서 왼쪽 분류를 위해 CCTV_ 접두사 사용
        self.active = False
        self.pipeline = None
        try:
            self.pipeline = rs.pipeline()
            rs_config = rs.config()
            rs_config.enable_stream(rs.stream.color, 640, 480, rs.format.bgr8, 30)
            self.pipeline.start(rs_config)
            self.active = True
            print(f"✅ RealSense 연결 성공: {self.id}")
        except Exception as e:
            print(f"❌ RealSense 연결 실패: {e}")

    def get_frame(self):
        if self.active:
            try:
                frames = self.pipeline.wait_for_frames(timeout_ms=1000)
                color_frame = frames.get_color_frame()
                if color_frame:
                    frame = np.asanyarray(color_frame.get_data())
                    return self.id, cv2.resize(frame, (WIDTH, HEIGHT))
            except: pass
        return self.id, None

    def stop(self):
        if self.active and self.pipeline:
            self.pipeline.stop()

class GenericCamera:
    def __init__(self, index):
        self.index = index
        self.id = f"CCTV_Webcam_{100 + index}"
        self.cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
        self.active = self.cap.isOpened()
        if self.active: print(f"✅ 웹캠 발견: {self.id}")

    def get_frame(self):
        if self.active:
            ret, frame = self.cap.read()
            if ret: return self.id, frame
        return self.id, None

    def stop(self):
        if self.active: self.cap.release()

def main():
    print(f"🎥 클라이언트 시작 -> 목적지: {SERVER_IP}")
    cameras = []
    session = requests.Session()

    # 카메라 초기화
    rs_cam = RealSenseCamera()
    if rs_cam.active: cameras.append(rs_cam)
    for i in range(2):
        cam = GenericCamera(i)
        if cam.active: cameras.append(cam)

    if not cameras:
        print("❌ 카메라가 없습니다."); return

    try:
        while True:
            for cam in cameras:
                cam_id, frame = cam.get_frame()
                if frame is not None:
                    _, img_encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
                    files = {'file': ('image.jpg', img_encoded.tobytes(), 'image/jpeg')}
                    try:
                        session.post(f"{SERVER_IP}/upload_frame/{cam_id}", files=files, timeout=0.05)
                    except: pass
            time.sleep(0.01)
    except KeyboardInterrupt:
        print("\n👋 종료 중...")
    finally:
        # 💡 리소스 강제 해제 (터미널 먹통 방지 핵심)
        for cam in cameras: cam.stop()
        print("✅ 모든 카메라가 해제되었습니다.")
        sys.exit(0)

if __name__ == "__main__":
    main()