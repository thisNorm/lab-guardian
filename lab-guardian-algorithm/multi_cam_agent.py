import cv2
import requests
import time
import pyrealsense2 as rs
import numpy as np

# --- [서버 설정] ---
SERVER_IP = "http://localhost:8000"

# --- [설정] 일반 웹캠 해상도 (낮을수록 빠름) ---
WIDTH, HEIGHT = 320, 240 

class RealSenseCamera:
    """인텔 리얼센스 전용 클래스 (가장 먼저 실행됨)"""
    def __init__(self):
        self.id = 999 # 리얼센스 고정 ID
        self.active = False
        self.pipeline = None
        
        print("🔹 [1단계] Intel RealSense 연결 시도 중...")
        try:
            self.pipeline = rs.pipeline()
            config = rs.config()
            
            # [중요] USB 3.0 연결 시도 (고화질)
            try:
                config.enable_stream(rs.stream.color, 640, 480, rs.format.bgr8, 30)
                self.pipeline.start(config)
                print("   ✅ RealSense 연결 성공! (USB 3.0 모드)")
                self.active = True
            except:
                print("   ⚠️ USB 3.0 실패 -> USB 2.0 호환 모드로 재시도...")
                # USB 2.0 호환 모드 (해상도 낮춤)
                config.enable_stream(rs.stream.color, 424, 240, rs.format.bgr8, 15)
                self.pipeline.start(config)
                print("   ✅ RealSense 연결 성공! (USB 2.0 안전 모드)")
                self.active = True
                
        except Exception as e:
            print(f"   ❌ RealSense 연결 실패: {e}")
            self.active = False

    def get_frame(self):
        if self.active:
            try:
                frames = self.pipeline.wait_for_frames(timeout_ms=1000)
                color_frame = frames.get_color_frame()
                if color_frame:
                    frame = np.asanyarray(color_frame.get_data())
                    # 서버 전송용 크기로 리사이즈
                    return self.id, cv2.resize(frame, (WIDTH, HEIGHT))
            except:
                pass
        return self.id, None

class GenericCamera:
    """일반 USB 웹캠용 클래스"""
    def __init__(self, index):
        self.index = index
        self.id = 100 + index
        
        # DSHOW 옵션 제거 (호환성 높임) 또는 유지
        # 리얼센스랑 충돌 안 나게 하려면 여기서 예외 처리를 잘해야 함
        self.cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        
        # 해상도 강제 설정
        self.cap.set(cv2.CAP_PROP_FRAME_WIDTH, WIDTH)
        self.cap.set(cv2.CAP_PROP_FRAME_HEIGHT, HEIGHT)
        
        if self.cap.isOpened():
            # 실제로 프레임이 읽히는지 테스트
            ret, _ = self.cap.read()
            self.active = ret
            if not ret:
                self.cap.release()
        else:
            self.active = False
        
    def get_frame(self):
        if self.active:
            ret, frame = self.cap.read()
            if ret:
                return self.id, frame
        return self.id, None

def main():
    print("\n🎥 [하이브리드 통합 클라이언트 V2] 시작")
    print("="*50)
    
    cameras = []
    session = requests.Session()

    # [순서 변경] 1. 리얼센스 먼저 연결 (OpenCV가 건드리기 전에 선점)
    rs_cam = RealSenseCamera()
    if rs_cam.active:
        cameras.append(rs_cam)
    
    # [순서 변경] 2. 그 다음 일반 웹캠 검색
    print("\n🔹 [2단계] 일반 웹캠(Logitech 등) 검색 중...")
    for i in range(5): # 0~4번 포트 스캔
        # 리얼센스가 이미 잡은 장치일 수도 있으니 조심스럽게 접근
        try:
            cam = GenericCamera(i)
            if cam.active:
                print(f"   ✅ 카메라 #{i} 발견 -> Robot #{cam.id}")
                cameras.append(cam)
            else:
                # 연결 실패 시 조용히 넘어가거나 로그 출력
                # print(f"   (카메라 #{i}는 사용 불가)")
                pass
        except:
            pass
    
    if not cameras:
        print("\n❌ 연결된 카메라가 하나도 없습니다. 케이블을 확인하세요.")
        return

    print("="*50)
    print(f"🚀 총 {len(cameras)}대의 카메라가 서버로 영상을 송출합니다!")
    
    # --- 메인 루프 ---
    try:
        while True:
            for cam in cameras:
                robot_id, frame = cam.get_frame()
                
                if frame is not None:
                    # JPEG 압축
                    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 90]
                    _, img_encoded = cv2.imencode('.jpg', frame, encode_param)
                    
                    files = {'file': ('image.jpg', img_encoded.tobytes(), 'image/jpeg')}
                    url = f"{SERVER_IP}/upload_frame/{robot_id}"
                    
                    try:
                        session.post(url, files=files, timeout=0.1)
                    except:
                        pass
            
            time.sleep(0.01) # CPU 보호
            print(".", end="", flush=True)

    except KeyboardInterrupt:
        print("\n종료합니다.")

if __name__ == "__main__":
    main()