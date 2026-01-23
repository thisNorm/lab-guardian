# config.py
MY_IP = "192.168.0.100"      # 라즈베리파이 IP
PC_IP = "192.168.0.149"      # 데스크탑 IP (NestJS, React, Algo 실행처)

PORT_ALGO = 3000
PORT_NEST = 8000
PORT_ROBOT = 9999

# NestJS 서버 주소 (알람 전송용)
NEST_API_URL = f"http://{PC_IP}:{PORT_NEST}"

# 장치 옵션
USE_REALSENSE = True  # RealSense 카메라를 사용할 경우 True로 변경
