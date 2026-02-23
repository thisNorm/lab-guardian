import cv2
import requests
import threading


class TelegramNotifier:
    def __init__(self, token, chat_id):
        self.token = (token or "").strip()
        self.chat_id = (chat_id or "").strip()
        self.enabled = bool(self.token and self.chat_id)
        self.base_url = f"https://api.telegram.org/bot{self.token}/sendPhoto" if self.token else ""

        if not self.enabled:
            print("⚠️ [텔레그램 비활성] TELEGRAM_TOKEN 또는 TELEGRAM_CHAT_ID가 비어 있습니다.")

    def send_photo(self, cam_id, frame):
        # 메인 추론 루프를 막지 않기 위해 비동기 스레드에서 전송
        if not self.enabled:
            return
        threading.Thread(target=self._send_thread, args=(cam_id, frame), daemon=True).start()

    def _send_thread(self, cam_id, frame):
        try:
            ok, buffer = cv2.imencode(".jpg", frame)
            if not ok:
                print(f"❌ [텔레그램 전송 실패] JPEG 인코딩 실패: {cam_id}")
                return

            files = {"photo": buffer.tobytes()}
            data = {
                "chat_id": self.chat_id,
                "caption": f"🚨 [침입 감지] {cam_id}\\n위험 상황이 감지되었습니다.",
            }

            # 폐쇄망/프록시 환경 호환을 위해 verify=False 유지
            resp = requests.post(self.base_url, files=files, data=data, verify=False, timeout=5)
            if resp.status_code == 200:
                print(f"📨 [텔레그램 전송 완료] {cam_id}")
            else:
                print(f"❌ [텔레그램 전송 실패] {cam_id} status={resp.status_code} body={resp.text}")

        except requests.exceptions.ConnectionError:
            print("🔒 [보안 정책 알림] 방화벽/네트워크로 텔레그램 전송이 차단되었습니다. (Skip)")
        except Exception as e:
            print(f"⚠️ [알림 전송 오류] {e}")