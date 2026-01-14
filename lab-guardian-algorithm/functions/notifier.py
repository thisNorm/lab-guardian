import requests
import cv2
import threading

class TelegramNotifier:
    def __init__(self, token, chat_id):
        self.token = token
        self.chat_id = chat_id
        self.base_url = f"https://api.telegram.org/bot{token}/sendPhoto"

    def send_photo(self, cam_id, frame):
        # 메인 서버가 멈추지 않도록 별도 스레드에서 전송
        threading.Thread(target=self._send_thread, args=(cam_id, frame)).start()

    def _send_thread(self, cam_id, frame):
        try:
            ret, buffer = cv2.imencode('.jpg', frame)
            if not ret: return

            files = {'photo': buffer.tobytes()}
            data = {
                'chat_id': self.chat_id, 
                'caption': f"🚨 [침입 감지] {cam_id}\n위험 상황이 포착되었습니다!"
            }
            
            # 타임아웃 3초, 인증서 무시(verify=False)
            requests.post(self.base_url, files=files, data=data, verify=False, timeout=3)
            print(f"📨 [텔레그램 전송 완료] {cam_id}")
            
        except requests.exceptions.ConnectionError:
            print(f"🔒 [보안 정책 알림] 방화벽에 의해 텔레그램이 차단됨. (Skip)")
        except Exception as e:
            print(f"⚠️ [알림 전송 오류] {e}")