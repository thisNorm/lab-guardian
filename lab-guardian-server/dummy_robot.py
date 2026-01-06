import cv2
import requests
import time
import random

# --- [설정] ---
SERVER_IP = "http://localhost:8000"

# --- [핵심 기능] 사용 가능한 카메라 자동 탐색 함수 ---
def auto_connect_camera():
    print("🔍 사용 가능한 카메라를 검색 중입니다...")
    
    # 0번부터 3번 포트까지 순서대로 스캔
    for index in range(4):
        print(f"   👉 카메라 #{index} 연결 시도...", end=" ")
        
        # DSHOW 옵션: 윈도우에서 딜레이 없이 즉시 확인
        cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
        
        if cap.isOpened():
            # 연결은 됐어도, 실제 화면이 읽히는지 테스트 (중요!)
            ret, frame = cap.read()
            if ret:
                print("✅ 성공! (이 카메라를 사용합니다)")
                return cap, index
            else:
                print("⚠️ 실패 (사용 중이거나 신호 없음)")
                cap.release() # 놔주고 다음으로
        else:
            print("❌ 장치 없음")
            
    print("\n🚨 사용 가능한 카메라를 찾지 못했습니다!")
    return None, -1

# 1. 카메라 자동 연결
cap, CAM_INDEX = auto_connect_camera()

if cap is None:
    print("프로그램을 종료합니다. 카메라 연결 상태를 확인해주세요.")
    exit()

# 2. 로봇 ID 랜덤 생성 (서버 등록용)
MY_ROBOT_ID = random.randint(10, 99)
SERVER_URL = f"{SERVER_IP}/upload_frame/{MY_ROBOT_ID}"

print(f"\n🚀 로봇 시스템 가동!")
print(f"🆔 ID: {MY_ROBOT_ID}")
print(f"📷 연결된 카메라: {CAM_INDEX}번")
print(f"📡 서버 주소: {SERVER_URL}")

# 세션 설정 (속도 향상)
session = requests.Session()

while True:
    ret, frame = cap.read()
    if not ret:
        print("❌ 프레임 읽기 실패")
        break
    
    # 해상도 640x480 (속도/화질 타협)
    frame = cv2.resize(frame, (640, 480))
    
    # 화질 90%
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 90]
    _, img_encoded = cv2.imencode('.jpg', frame, encode_param)
    
    files = {'file': ('image.jpg', img_encoded.tobytes(), 'image/jpeg')}
    
    try:
        # 타임아웃 0.5초
        res = session.post(SERVER_URL, files=files, timeout=0.5)
        print(".", end="", flush=True)
    except:
        # 연결 실패 시 세션 재설정
        session = requests.Session()
        # print("x", end="", flush=True) 

cap.release()