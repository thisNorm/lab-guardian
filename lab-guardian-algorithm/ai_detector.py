# ai_detector.py
from ultralytics import YOLO
import cv2

class AIDetector:
    def __init__(self, model_name='yolov8n.pt'):
        print(f"🧠 [AI] 모델({model_name})을 로딩 중입니다...")
        self.model = YOLO(model_name)
        print("✅ [AI] 모델 로딩 완료!")

    def detect_and_draw(self, frame):
        """
        추적을 위해 '사람'의 좌표(rects)를 별도로 반환하도록 수정했습니다.
        """
        results = self.model(frame, verbose=False)
        
        # 1. 그림 그리기 (YOLO 기본 기능)
        annotated_frame = results[0].plot()
        
        # 2. '사람' 객체의 좌표 추출
        person_rects = []
        
        for box in results[0].boxes:
            class_id = int(box.cls[0])
            class_name = self.model.names[class_id]
            
            # 'person' 클래스일 경우에만 좌표 저장
            if class_name == 'person':
                x1, y1, x2, y2 = map(int, box.xyxy[0])
                person_rects.append((x1, y1, x2, y2))
            
        return annotated_frame, person_rects