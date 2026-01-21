# functions/ai_detector.py
from ultralytics import YOLO
import cv2
import numpy as np

# 🔴 [수정] main.py 실행 위치 기준으로 경로 변경
# 같은 폴더(functions) 안에 있더라도, 실행은 루트에서 하므로 전체 경로를 적어줍니다.
from functions.centroidtracker import CentroidTracker 

class AIDetector:
    def __init__(self, model_name='yolov8n.pt'):
        print(f"🧠 [AI] 모델({model_name}) 로딩 중...")
        self.model = YOLO(model_name)
        # 카메라별 트래커 관리
        self.trackers = {}
        print("✅ [AI] 모델 및 트래커 준비 완료!")

    def detect_and_track(self, cam_id, frame):
        """
        프레임을 분석하고, '사람(Person)' 객체의 ID 리스트를 반환합니다.
        """
        # 🚀 [핵심 수정 1] classes=[0] -> 사람(0번)만 탐지하도록 강제
        # 🚀 [핵심 수정 2] conf=0.5 -> 확신이 50% 이상일 때만 탐지
        results = self.model(frame, verbose=False, classes=[0], conf=0.5)
        
        # YOLO가 그린 그림 (사람만 그려져 있음)
        annotated_frame = results[0].plot()
        
        person_rects = []
        
        # 탐지된 박스 좌표 추출
        for box in results[0].boxes:
            # 이미 classes=[0]으로 필터링했으므로 굳이 if문으로 'person'인지 확인할 필요 없음
            # 좌표를 정수형 리스트로 변환
            x1, y1, x2, y2 = map(int, box.xyxy[0])
            person_rects.append((x1, y1, x2, y2))
        
        # 해당 카메라용 트래커가 없으면 생성
        if cam_id not in self.trackers:
            # maxDisappeared: 객체가 사라져도 40프레임 동안은 ID 유지 (잠깐 가려짐 대비)
            self.trackers[cam_id] = CentroidTracker(maxDisappeared=40)
        
        # 트래커 업데이트 (좌표 정보 전달)
        objects = self.trackers[cam_id].update(person_rects)
        
        # 이번 프레임에서 '새로' ID를 부여받은 목록 추출
        new_ids = getattr(self.trackers[cam_id], 'new_detected_ids', [])
        
        # 화면에 추적 ID 그리기 (디버깅용)
        for (objectID, centroid) in objects.items():
            text = f"ID {objectID}"
            # 점 찍기
            cv2.circle(annotated_frame, (centroid[0], centroid[1]), 4, (0, 0, 255), -1)
            # 글자 쓰기
            cv2.putText(annotated_frame, text, (centroid[0] - 10, centroid[1] - 10),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 0, 255), 2)
            
        return annotated_frame, new_ids, objects

    def remove_tracker(self, cam_id):
        """장치 연결 끊김 시 트래커 제거"""
        if cam_id in self.trackers:
            del self.trackers[cam_id]
            print(f"🧹 [AI] {cam_id} 트래커 메모리 해제")
