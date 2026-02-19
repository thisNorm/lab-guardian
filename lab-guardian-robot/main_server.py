import asyncio
import socketio
from aiohttp import web
import cv2
import numpy as np
import config 
import os

# ✅ 기존 라이브러리 및 클래스 유지
from Raspbot_Lib import Raspbot
from control import RobotController

# 글로벌 변수
shared_frame = None
global_bot = None
UPLOAD_WIDTH = int(os.getenv("ROBOT_UPLOAD_WIDTH", "1280"))
UPLOAD_HEIGHT = int(os.getenv("ROBOT_UPLOAD_HEIGHT", "720"))
UPLOAD_JPEG_QUALITY = int(os.getenv("ROBOT_UPLOAD_JPEG_QUALITY", "92"))

# 소켓 설정 (React 서버 주소 허용)
sio_server = socketio.AsyncServer(async_mode='aiohttp', cors_allowed_origins='*')
app = web.Application()
sio_server.attach(app)

@sio_server.on('direct_control')
async def handle_direct_control(sid, data):
    global global_bot
    cmd = data.get('command', '').lower()
    action = data.get('type') # 'down' (누름) 또는 'up' (뗌)

    if not global_bot: return

    # 이동 제어: 사용자의 기존 로직(WASD)과 동일한 속도 유지
    speed = 10 
    if cmd in ['w', 'a', 's', 'd']:
        if action == 'down':
            if cmd == 'w': global_bot.motor_go(speed)
            elif cmd == 's': global_bot.motor_back(speed)
            elif cmd == 'a': global_bot.motor_left(speed)
            elif cmd == 'd': global_bot.motor_right(speed)
        elif action == 'up':
            global_bot.motor_stop()

    # 카메라 제어: 방향키 대응
    elif 'arrow' in cmd:
        if action == 'down':
            # arrowup -> up, arrowdown -> down ...
            direction = cmd.replace('arrow', '')
            global_bot.camera_control(direction)

# --- 루프 정의 ---

async def camera_loop():
    global shared_frame
    cap = cv2.VideoCapture(0)
    # 대역폭 최적화
    cap.set(cv2.CAP_PROP_FRAME_WIDTH, UPLOAD_WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, UPLOAD_HEIGHT)
    while True:
        ret, frame = cap.read()
        if ret: shared_frame = frame
        await asyncio.sleep(0.03)

async def upload_task():
    import aiohttp
    async with aiohttp.ClientSession() as session:
        while True:
            if shared_frame is not None:
                try:
                    _, img = cv2.imencode('.jpg', shared_frame, [cv2.IMWRITE_JPEG_QUALITY, UPLOAD_JPEG_QUALITY])
                    data = aiohttp.FormData()
                    data.add_field('file', img.tobytes(), filename='f.jpg', content_type='image/jpeg')
                    # 웹 대시보드 로봇 섹션 ID와 일치하도록 ROBOT_1로 전송
                    url = f"http://{config.PC_IP}:{config.PORT_ALGO}/upload_frame/ROBOT_1"
                    async with session.post(url, data=data, timeout=0.2): pass
                except: pass
            await asyncio.sleep(0.05)

async def local_control_loop(controller):
    """사용자가 작성한 기존 터미널 제어 로직 유지"""
    print("⌨️ 터미널 제어 활성화 (WASD / 방향키)")
    while True:
        # 비차단(Non-blocking) 방식으로 키 입력 감지
        key = await asyncio.to_thread(controller.get_key, 0.05)
        if key == 'q': break
        # 사용자의 기존 process_command 로직 그대로 수행
        controller.process_command(key)
        await asyncio.sleep(0.01)

async def main():
    global global_bot
    global_bot = Raspbot()
    global_bot.camera_control("center")
    
    controller = RobotController(global_bot)

    # 웹 서버 설정 (포트 5001)
    runner = web.AppRunner(app)
    await runner.setup()
    await web.TCPSite(runner, '0.0.0.0', 5001).start()
    
    print("🚀 로봇 통합 제어 서버 가동 (Terminal + Web)")

    await asyncio.gather(
        camera_loop(),
        upload_task(),
        local_control_loop(controller)
    )

if __name__ == '__main__':
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        if global_bot: global_bot.motor_stop()