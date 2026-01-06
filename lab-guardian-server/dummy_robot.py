# dummy_robot.py
import cv2
import requests
import time

# [중요] 주소 끝에 숫자 '1'이 있어야 합니다! (1번 로봇)
SERVER_URL = "http://localhost:8000/upload_frame/1"

print(f"📡 가짜 로봇 시작! 목표 서버: {SERVER_URL}")
print("📷 카메라 켜는 중...")

# 0번이 안 되면 1번으로 바꿔보세요 (노트북마다 다름)
cap = cv2.VideoCapture(0)

if not cap.isOpened():
    print("❌ 카메라(0번)를 열 수 없습니다! 코드를 1로 바꿔보세요.")
    exit()

# 세션 유지 (속도 향상)
session = requests.Session()

while True:
    ret, frame = cap.read()
    if not ret:
        print("❌ 카메라에서 영상을 못 읽어왔습니다.")
        break
    
    # 해상도 줄이기 (320x240)
    frame = cv2.resize(frame, (320, 240))
    
    # 이미지 압축 (화질 50%)
    encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), 50]
    _, img_encoded = cv2.imencode('.jpg', frame, encode_param)
    
    files = {'file': ('image.jpg', img_encoded.tobytes(), 'image/jpeg')}
    
    try:
        # 타임아웃 1초 설정
        res = session.post(SERVER_URL, files=files, timeout=1)
            
    except Exception as e:
        print(f"\n❌ 전송 실패: 서버가 켜져 있나요?")
        time.sleep(1) # 실패 시 1초 대기
        session = requests.Session() # 세션 초기화

cap.release()