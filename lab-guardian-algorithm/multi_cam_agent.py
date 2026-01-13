import cv2
import requests
import time
import pyrealsense2 as rs
import numpy as np
import config 
import sys

SERVER_IP = f"http://192.168.0.149:{config.PORT_ALGO}" 
WIDTH, HEIGHT = 320, 240 

class RealSenseCamera:
    def __init__(self):
        self.id = "CCTV_RealSense_999"
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
            try:
                self.pipeline.stop()
                print(f"✅ {self.id} 중지됨")
            except: pass

class GenericCamera:
    def __init__(self, index):
        self.index = index
        self.id = f"CCTV_Webcam_{200 + index}"
        self.cap = cv2.VideoCapture(index, cv2.CAP_DSHOW) # 속도 향상을 위해 DSHOW 권장
        
        if self.cap.isOpened():
            # 1. 버퍼 사이즈 최소화 (지연 시간 해결 핵심)
            self.cap.set(cv2.CAP_PROP_BUFFERSIZE, 1) 
            # 2. MJPG 코덱 강제 (대역폭 사용량 감소)
            self.cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*'MJPG'))
            # 3. 전송 해상도 다이어트
            self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, 320)
            self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 240)
            self.cap.set(cv2.CAP_PROP_FPS, 30)
            print(f"✅ 최적화 모드로 카메라 연결: {self.id}")
        
        self.active = self.cap.isOpened()

    def get_frame(self):
        if self.active:
            # 버퍼에 쌓인 예전 프레임은 버리고 최신 프레임만 읽기 위해 두 번 읽거나 grab/retrieve 사용
            self.cap.grab() # 최신 프레임 위치로 이동
            ret, frame = self.cap.retrieve() # 프레임 가져오기
            if ret: return self.id, frame
        return self.id, None

    # 💡 누락되었던 stop 메서드 추가
    def stop(self):
        if self.active:
            self.cap.release()
            print(f"✅ {self.id} 자원 해제 완료")

def main():
    print(f"🎥 클라이언트 시작 -> 목적지: {SERVER_IP}")
    cameras = []
    registered_ids = set()
    session = requests.Session()

    # 1. RealSense 초기화
    rs_cam = RealSenseCamera()
    if rs_cam.active: 
        cameras.append(rs_cam)
        registered_ids.add(rs_cam.id)

    # 2. 일반 웹캠 탐색 (0~2번까지만 확인)
    for i in range(3):
        temp_cam = GenericCamera(i)
        if temp_cam.active:
            # 프레임 읽기 테스트
            ret, frame = temp_cam.cap.read()
            if ret and temp_cam.id not in registered_ids:
                cameras.append(temp_cam)
                registered_ids.add(temp_cam.id)
                print(f"✅ 스트리밍 목록 등록: {temp_cam.id}")
            else:
                print(f"⚠️ {temp_cam.id} 프레임 읽기 실패 또는 중복되어 건너뜁니다.")
                temp_cam.stop() # 이제 에러 없이 작동합니다

    if not cameras:
        print("❌ 사용 가능한 카메라가 없습니다."); return

    try:
        while True:
            for cam in cameras:
                cam_id, frame = cam.get_frame()
                if frame is not None:
                    _, img_encoded = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
                    files = {'file': ('image.jpg', img_encoded.tobytes(), 'image/jpeg')}
                    try:
                        session.post(f"{SERVER_IP}/upload_frame/{cam_id}", files=files, timeout=0.1)
                    except: pass
            time.sleep(0.01)
    except KeyboardInterrupt:
        print("\n👋 종료 요청됨...")
    finally:
        for cam in cameras: 
            cam.stop()
        print("✅ 모든 프로세스가 종료되었습니다.")
        sys.exit(0)

if __name__ == "__main__":
    main()