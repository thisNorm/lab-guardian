# ai_detector.py
from ultralytics import YOLO
import cv2
from centroidtracker import CentroidTracker # 추적기 임포트

class AIDetector:
    def __init__(self, model_name='yolov8n.pt'):
        print(f"🧠 [AI] 모델({model_name}) 로딩 중...")
        self.model = YOLO(model_name)
        # 카메라별 트래커를 관리할 딕셔너리 { "cam_id": CentroidTracker() }
        self.trackers = {}
        print("✅ [AI] 모델 및 트래커 준비 완료!")

    def detect_and_track(self, cam_id, frame):
        """
        프레임을 분석하고, '새로 발견된' 객체의 ID 리스트를 반환합니다.
        """
        results = self.model(frame, verbose=False)
        annotated_frame = results[0].plot()
        
        person_rects = []
        for box in results[0].boxes:
            class_id = int(box.cls[0])
            if self.model.names[class_id] == 'person':
                person_rects.append(map(int, box.xyxy[0]))
        
        # 해당 카메라용 트래커가 없으면 생성
        if cam_id not in self.trackers:
            self.trackers[cam_id] = CentroidTracker(maxDisappeared=40)
        
        # 추적 업데이트
        objects = self.trackers[cam_id].update(person_rects)
        
        # 💡 [핵심] 이번 프레임에서 '처음' 등장한 ID들만 추출
        new_ids = getattr(self.trackers[cam_id], 'new_detected_ids', [])
        
        # 화면에 ID 표시 (시각화)
        for (objectID, centroid) in objects.items():
            text = f"ID {objectID}"
            cv2.putText(annotated_frame, text, (centroid[0] - 10, centroid[1] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 0), 2)
            cv2.circle(annotated_frame, (centroid[0], centroid[1]), 4, (0, 255, 0), -1)
            
        return annotated_frame, new_ids, objects

    def remove_tracker(self, cam_id):
        """장치 연결 끊김 시 트래커 제거"""
        if cam_id in self.trackers:
            del self.trackers[cam_id]