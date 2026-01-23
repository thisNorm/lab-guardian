import cv2
import os
import threading
from datetime import datetime

class VideoRecorder:
    def __init__(self, save_dir="recordings", on_video_saved=None):
        self.save_dir = save_dir
        os.makedirs(self.save_dir, exist_ok=True)
        # 녹화 상태 관리 { "cam_id": { ... } }
        self.recording_state = {} 
        self.on_video_saved = on_video_saved

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
                "timestamp": datetime.now().strftime("%Y%m%d_%H%M%S"),
                "start_time": current_time,
                "last_time": current_time,
            }

    def process_frame(self, cam_id, frame, current_time):
        """프레임 수집 및 저장 처리"""
        if cam_id in self.recording_state:
            rec_info = self.recording_state[cam_id]
            
            # 녹화 중: 프레임 추가
            if current_time < rec_info["end_time"]:
                rec_info["frames"].append(frame.copy())
                rec_info["last_time"] = current_time
            
            # 녹화 종료: 파일 저장 (스레드)
            else:
                print(f"⏹ [녹화 종료] {cam_id} -> 파일 저장 중...")
                threading.Thread(
                    target=self._save_file_thread, 
                    args=(
                        cam_id,
                        rec_info["frames"],
                        rec_info["timestamp"],
                        rec_info["start_time"],
                        rec_info["last_time"],
                    ),
                    daemon=True,
                ).start()
                del self.recording_state[cam_id]

    def _save_file_thread(self, cam_id, frames, timestamp, start_time, last_time):
        if not frames: return
        try:
            filename = os.path.join(self.save_dir, f"{cam_id}_{timestamp}.mp4")
            height, width, _ = frames[0].shape
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            duration = max(0.1, last_time - start_time)
            fps = max(1.0, min(20.0, len(frames) / duration))
            out = cv2.VideoWriter(filename, fourcc, fps, (width, height))
            
            for frame in frames:
                out.write(frame)
            out.release()
            print(f"💾 [저장 완료] {filename} ({len(frames)} frames @ {fps:.1f}fps)")
            if self.on_video_saved:
                self.on_video_saved(cam_id, filename)
        except Exception as e:
            print(f"❌ [저장 실패] {e}")
