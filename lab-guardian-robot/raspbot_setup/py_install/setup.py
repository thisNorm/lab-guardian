from setuptools import find_packages, setup

setup(
    name='Raspbot_Lib',
    version='0.0.3', # 버전을 0.0.3으로 업데이트
    py_modules=['Raspbot_Lib', 'control'], # control.py도 모듈로 포함
    author='Yahboom Team',
    url='www.yahboom.com',
    packages=find_packages(),
    description='Raspbot driver V0.0.3 with Video Streaming and Control dependencies',
    
    install_requires=[
        'smbus2',           # I2C 통신용
        'numpy',            # 이미지 행렬 처리용
        'opencv-python',    # 카메라 영상 처리용
        'websockets',       # 실시간 스트리밍용
    ],
)