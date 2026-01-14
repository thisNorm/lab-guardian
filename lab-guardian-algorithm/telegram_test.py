import requests

# main.py에 넣었던 정보 그대로 넣으세요
TOKEN = "8515271659:AAFP9JWN95GIjNJqOmo74hGmdLxnPWOb3XU"
CHAT_ID = "8373321099"

def test_msg():
    url = f"https://api.telegram.org/bot{TOKEN}/sendMessage"
    data = {'chat_id': CHAT_ID, 'text': "🔥 테스트 메시지 도착! 설정은 완벽합니다."}
    
    try:
        response = requests.post(url, data=data)
        print(f"응답 코드: {response.status_code}")
        print(f"응답 내용: {response.json()}")
        
        if response.status_code == 200:
            print("\n✅ 성공! 텔레그램 설정은 맞습니다. 코드를 다시 확인해볼게요.")
        else:
            print("\n❌ 실패! 토큰이나 ID가 틀렸습니다.")
    except Exception as e:
        print(f"\n❌ 에러 발생: {e}")

if __name__ == "__main__":
    test_msg()