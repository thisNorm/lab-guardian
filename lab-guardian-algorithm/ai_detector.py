# ai_detector.py
from ultralytics import YOLO
import cv2

class AIDetector:
    def __init__(self, model_name='yolov8n.pt'):
        """
        클래스가 생성될 때 모델을 딱 한 번만 로딩합니다.
        """
        print(f"🧠 [AI] 모델({model_name})을 로딩 중입니다...")
        self.model = YOLO(model_name)
        print("✅ [AI] 모델 로딩 완료!")

    def detect_and_draw(self, frame):
        """
        이미지를 받아서 객체를 인식하고, 
        그림이 그려진 이미지와 감지된 물체 목록을 반환합니다.
        """
        # 1. AI 추론 실행
        results = self.model(frame, verbose=False)
        
        # 2. 결과 이미지 생성 (박스 그려진 이미지)
        annotated_frame = results[0].plot()
        
        # 3. 감지된 물체 이름 리스트 추출 (예: ['person', 'cup'])
        detected_objects = []
        for box in results[0].boxes:
            class_id = int(box.cls[0])
            class_name = self.model.names[class_id]
            detected_objects.append(class_name)
            
        return annotated_frame, detected_objects