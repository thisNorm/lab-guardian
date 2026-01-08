import cv2
import time

print("🔍 인텔 리얼센스(또는 호환성 낮은 카메라) 정밀 진단 중...")
print("-" * 60)

# 0번부터 4번까지 테스트
for index in range(5):
    print(f"\n[Index {index}] 연결 시도 중...", end=" ")
    
    # 1. RealSense는 DSHOW 모드가 훨씬 안정적입니다.
    cap = cv2.VideoCapture(index, cv2.CAP_DSHOW)
    
    if cap.isOpened():
        # [핵심 해결책] 연결되자마자 해상도를 강제로 640x480으로 고정합니다.
        # 리얼센스는 이 설정이 없으면 에러를 뿜는 경우가 많습니다.
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
        cap.set(cv2.CAP_PROP_FPS, 30)
        
        # 설정 적용을 위해 아주 잠깐 대기
        time.sleep(0.5)
        
        # 읽기 시도
        ret, frame = cap.read()
        
        if ret:
            print(f"✅ 성공! (해상도: {int(cap.get(3))}x{int(cap.get(4))})")
            print("   👉 이 번호를 dummy_robot.py에 입력하세요!")
            cap.release()
            continue # 성공했으면 다음 번호 검색
        else:
            print("⚠️ 장치는 열렸으나 화면을 못 가져옵니다.")
            print("   (원인: USB 3.0 포트가 아니거나, 다른 앱이 점유 중)")
        
        cap.release()
    else:
        print("❌ 장치 없음")

print("-" * 60)
print("진단 종료.")