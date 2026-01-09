import requests
import socket
import time

# 설정된 IP와 포트
IP = "192.168.0.131"
NEST_PORT = 8000
ALGO_PORT = 3000

def check_port(ip, port, name):
    """포트가 열려 있는지 확인"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(2)
        result = s.connect_ex((ip, port))
        if result == 0:
            print(f"✅ [포트 체크] {name} ({port}): 열림 (ONLINE)")
            return True
        else:
            print(f"❌ [포트 체크] {name} ({port}): 닫힘 (OFFLINE)")
            return False

def check_api_status():
    """실제 API 응답 확인"""
    print(f"\n--- API 응답 테스트 (목적지: {IP}) ---")
    
    # 1. NestJS 백엔드 체크
    try:
        resp = requests.get(f"http://{IP}:{NEST_PORT}/api/robot", timeout=3)
        if resp.status_code == 200:
            print(f"✅ [NestJS] 연결 성공! 장치 개수: {len(resp.json())}대 감지")
        else:
            print(f"⚠️ [NestJS] 서버는 켜져 있으나 에러 발생 (Status: {resp.status_code})")
    except Exception as e:
        print(f"❌ [NestJS] API 요청 실패: {e}")

    # 2. FastAPI 알고리즘 서버 체크
    try:
        # /video_feed는 스트리밍이므로 헬스체크용 엔드포인트가 따로 없다면 접속 시도만 확인
        resp = requests.get(f"http://{IP}:{ALGO_PORT}/docs", timeout=3)
        if resp.status_code == 200:
            print(f"✅ [FastAPI] 연결 성공! AI 분석 서버 정상 작동 중")
        else:
            print(f"⚠️ [FastAPI] 서버는 켜져 있으나 에러 발생 (Status: {resp.status_code})")
    except Exception as e:
        print(f"❌ [FastAPI] API 요청 실패: {e}")

if __name__ == "__main__":
    print("🔍 LAB GUARDIAN 시스템 통합 점검 시작...")
    print("=" * 50)
    
    # 포트 확인
    nest_ok = check_port(IP, NEST_PORT, "NestJS Backend")
    algo_ok = check_port(IP, ALGO_PORT, "FastAPI Algo Server")
    
    # API 확인
    if nest_ok or algo_ok:
        check_api_status()
    
    print("=" * 50)
    print("💡 점검 완료. 모든 서버가 ONLINE이면 웹 대시보드(React)를 확인하세요.")