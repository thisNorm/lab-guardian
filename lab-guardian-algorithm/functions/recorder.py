import cv2
import os
import threading
from datetime import datetime

class VideoRecorder:
    def __init__(self, save_dir="recordings"):
        self.save_dir = save_dir
        os.makedirs(self.save_dir, exist_ok=True)
        # 녹화 상태 관리 { "cam_id": { "end_time": time, "frames": [] } }
        self.recording_state = {} 

    def save_snapshot(self, cam_id, frame):
        """스냅샷 저장 후 '웹 경로' 반환"""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"{cam_id}_{timestamp}.jpg"
        
        # 1. 로컬 폴더에 파일 저장
        file_path = os.path.join(self.save_dir, filename)
        cv2.imwrite(file_path, frame)
        
        # 2. 🚀 [핵심 수정] 날짜가 아니라 '웹 경로'를 리턴해야 함!
        # (수정 전: return timestamp)
        return f"/recordings/{filename}"

    def start_recording(self, cam_id, duration=10.0, current_time=0):
        """녹화 시작 예약"""
        if cam_id not in self.recording_state:
            print(f"🎥 [녹화 시작] {cam_id} (10초)")
            self.recording_state[cam_id] = {
                "end_time": current_time + duration,
                "frames": [],
                "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S")
            }

    def process_frame(self, cam_id, frame, current_time):
        """프레임 수집 및 저장 처리"""
        if cam_id in self.recording_state:
            rec_info = self.recording_state[cam_id]
            
            # 녹화 중: 프레임 추가
            if current_time < rec_info["end_time"]:
                rec_info["frames"].append(frame.copy())
            
            # 녹화 종료: 파일 저장 (스레드)
            else:
                print(f"⏹ [녹화 종료] {cam_id} -> 파일 저장 중...")
                threading.Thread(
                    target=self._save_file_thread, 
                    args=(cam_id, rec_info["frames"], rec_info["timestamp"])
                ).start()
                del self.recording_state[cam_id]

    def _save_file_thread(self, cam_id, frames, timestamp):
        if not frames: return
        try:
            filename = f"{self.save_dir}/{cam_id}_{timestamp}.mp4"
            height, width, _ = frames[0].shape
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            out = cv2.VideoWriter(filename, fourcc, 20.0, (width, height))
            
            for frame in frames:
                out.write(frame)
            out.release()
            print(f"💾 [저장 완료] {filename}")
        except Exception as e:
            print(f"❌ [저장 실패] {e}")