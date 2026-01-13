# /home/etri/project/config.py

# 라즈베리파이 정보
MY_IP = "192.168.0.100" 

# 내 컴퓨터(로컬 PC) 정보 (알고리즘, NestJS, React가 떠 있는 곳)
PC_IP = "192.168.0.149"  # <-- 여기서 확인한 본인 PC IP로 수정하세요!

# 포트 정의
PORT_ALGO = 3000
PORT_NEST = 8000
PORT_WEB = 5000
PORT_ROBOT = 9999

# 라즈베리파이가 PC로 이벤트를 보낼 주소
NEST_API_URL = f"http://{PC_IP}:{PORT_ALGO}"