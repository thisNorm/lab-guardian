import sys
import tty
import termios
import select

class RobotController:
    def __init__(self, bot):
        self.car = bot
        self.last_move_cmd = "stop"

    def get_key(self, timeout=0.01):
        fd = sys.stdin.fileno()
        old_settings = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            rlist, _, _ = select.select([sys.stdin], [], [], timeout)
            if rlist:
                key = sys.stdin.read(1)
                if key == '\x1b': key += sys.stdin.read(2)
                return key
            return None
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old_settings)

    def process_command(self, key):
        if not key:
            if self.last_move_cmd != "stop":
                self.car.motor_stop()
                self.last_move_cmd = "stop"
            return True

        k = key.lower()
        if k == 'q': return False 

        speed = 10
        # 이동 제어
        if k == 'w': self.car.motor_go(speed); self.last_move_cmd = "forward"
        elif k == 's': self.car.motor_back(speed); self.last_move_cmd = "backward"
        elif k == 'a': self.car.motor_left(speed); self.last_move_cmd = "left"
        elif k == 'd': self.car.motor_right(speed); self.last_move_cmd = "right"
        
        # 카메라 제어
        elif key == '\x1b[A': self.car.camera_control("up")
        elif key == '\x1b[B': self.car.camera_control("down")
        elif key == '\x1b[D': self.car.camera_control("left")
        elif key == '\x1b[C': self.car.camera_control("right")
        
        return True