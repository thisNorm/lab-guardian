#!/usr/bin/env python3
# coding: utf-8

try:
    import smbus
except ImportError:
    import smbus2 as smbus
import time, random
import math

PI5Car_I2CADDR = 0x2B

class Raspbot():
    def get_i2c_device(self, address, i2c_bus):
        self._addr = address
        if i2c_bus is None:
            return smbus.SMBus(13)
        else:
            return smbus.SMBus(i2c_bus)

    def __init__(self):
        # I2C 장치 초기화
        self._device = self.get_i2c_device(PI5Car_I2CADDR, 1)
        
        # 내부 상태 관리 변수 (카메라 각도 등)
        self.pan = 90
        self.tilt = 90
        self.speed = 50  # 기본 속도 설정 (필요시 조정)

    # --- [ 하위 통신 메서드 ] ---
    def write_u8(self, reg, data):
        try:
            self._device.write_byte_data(self._addr, reg, data)
        except:
            print('write_u8 I2C error')

    def write_reg(self, reg):
        try:
            self._device.write_byte(self._addr, reg)
        except:
            print('write_reg I2C error')

    def write_array(self, reg, data):
            try:
                # 명령 전송 전 미세 대기 (I2C 안정화)
                time.sleep(0.005) 
                self._device.write_i2c_block_data(self._addr, reg, data)
                # 명령 전송 후 미세 대기
                time.sleep(0.005)
            except Exception as e:
                print (f'write_array I2C error: {e}')
                # 에러 발생 시 I2C 장치 재연결 시도 (먹통 방지)
                try:
                    self._device = self.get_i2c_device(PI5Car_I2CADDR, 1)
                except:
                    pass

    def read_data_array(self, reg, length):
        try:
            buf = self._device.read_i2c_block_data(self._addr, reg, length)
            return buf
        except:
            print('read_data_array I2C error')

    # --- [ 핵심 제어 메서드 ] ---
    def Ctrl_Car(self, motor_id, motor_dir, motor_speed):
        """개별 모터 제어"""
        try:
            if motor_dir not in [0, 1]: motor_dir = 0
            motor_speed = max(0, min(255, motor_speed))
            reg = 0x01
            data = [motor_id, motor_dir, motor_speed]
            self.write_array(reg, data)
        except:
            print('Ctrl_Car I2C error')

    def Ctrl_Servo(self, id, angle):
        """개별 서보 제어"""
        try:
            reg = 0x02
            angle = max(0, min(180, angle))
            if id == 2 and angle > 110: angle = 110  # 상하 서보 보호
            data = [id, angle]
            self.write_array(reg, data)
        except:
            print('Ctrl_Servo I2C error')

    # --- [ 확장: 이동 관련 통합 메서드 ] ---
    def move(self, direction, speed=None):
        """로봇 이동 통합 제어 (forward, backward, left, right, stop)"""
        if speed is None: speed = self.speed
        
        if direction == "forward":
            for i in range(4): self.Ctrl_Car(i, 0, speed)
        elif direction == "backward":
            for i in range(4): self.Ctrl_Car(i, 1, speed)
        elif direction == "left":
            self.Ctrl_Car(0, 1, speed); self.Ctrl_Car(1, 1, speed)
            self.Ctrl_Car(2, 0, speed); self.Ctrl_Car(3, 0, speed)
        elif direction == "right":
            self.Ctrl_Car(0, 0, speed); self.Ctrl_Car(1, 0, speed)
            self.Ctrl_Car(2, 1, speed); self.Ctrl_Car(3, 1, speed)
        elif direction == "stop":
            for i in range(4): self.Ctrl_Car(i, 0, 0)

    # ==========================================================
    # ✅ [수정됨] 서버 코드(main_server.py) 호환용 래퍼 함수 추가
    # ==========================================================
    def motor_go(self, speed):
        self.move("forward", speed)

    def motor_back(self, speed):
        self.move("backward", speed)

    def motor_left(self, speed):
        self.move("left", speed)

    def motor_right(self, speed):
        self.move("right", speed)

    def motor_stop(self):
        self.move("stop")
    # ==========================================================

    # --- [ 확장: 카메라 관련 통합 메서드 ] ---
    def camera_control(self, action, step=10):
        """카메라 제어 로직 재정의"""
        # 현재 각도가 초기화되지 않았다면 중앙값 설정
        if not hasattr(self, 'pan'): self.pan = 90
        if not hasattr(self, 'tilt'): self.tilt = 90

        if action == "up":
            self.tilt += step
        elif action == "down":
            self.tilt -= step
        elif action == "left":
            self.pan += step
        elif action == "right":
            self.pan -= step
        elif action == "center":
            self.pan = 90
            self.tilt = 90

        # 각도 제한 (하드웨어 보호)
        self.pan = max(0, min(180, self.pan))
        self.tilt = max(0, min(110, self.tilt)) # 상하는 보통 110도까지만 움직임

        # 실제 서보에 명령 전송 (ID 1: 좌우, ID 2: 상하)
        self.Ctrl_Servo(1, self.pan)
        time.sleep(0.01) # 통신 간격 확보
        self.Ctrl_Servo(2, self.tilt)

    # --- [ 기타 장치 제어 ] ---
    def Ctrl_BEEP_Switch(self, state):
        try:
            reg = 0x06
            data = [1 if state else 0]
            self.write_array(reg, data)
        except:
            print('Ctrl_BEEP_Switch I2C error')

    def Ctrl_WQ2812_ALL(self, state, color):
        try:
            reg = 0x03
            data = [1 if state else 0, color]
            self.write_array(reg, data)
        except:
            print('Ctrl_WQ2812 I2C error')