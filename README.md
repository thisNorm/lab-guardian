# 🛡️ ETRI Lab Guardian System
> **AI 기반 다중 로봇 실험실 안전 관제 시스템** > **AI-Powered Multi-Robot Laboratory Safety Monitoring System**

<div align="center">

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![MUI](https://img.shields.io/badge/MUI-007FFF?style=for-the-badge&logo=mui&logoColor=white)
![OpenCV](https://img.shields.io/badge/OpenCV-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white)

</div>

---

## 📖 Project Overview (프로젝트 개요)

**Lab Guardian**은 위험한 실험실 환경을 **자율 주행 로봇(Rasbot)**이 순찰하며, **AI(VLM)**를 통해 위험 상황(사람 쓰러짐, 화재 등)을 실시간으로 감지하고 관제실에 알리는 웹 기반 통합 모니터링 시스템입니다.

### ✨ Key Features (핵심 기능)
* **📡 Real-time Low Latency Streaming:** MJPEG 기반의 초저지연 영상 스트리밍 구현 (OpenCV + FastAPI).
* **🤖 Multi-Robot Control:** 2대 이상의 로봇을 동시에 관제 및 상태 모니터링.
* **👁️ AI Vision Analysis:** VLM(Vision Language Model)을 활용한 실시간 위험 상황 텍스트 브리핑.
* **🚨 Interactive Dashboard:** 직관적인 UI/UX, 다크 모드, 긴급 상황 시각적 알림 (MUI v6).
* **⚡ High Performance:** `requests.Session` 및 이미지 최적화를 통한 고속 데이터 전송 파이프라인.

---

## 📸 Dashboard Preview

<div align="center">
  <img src="https://via.placeholder.com/800x450.png?text=ETRI+Lab+Guardian+Dashboard+Preview" alt="Dashboard Screen" width="100%" />
</div>

---

## 🏗️ System Architecture

```mermaid
graph LR
    A[🤖 Rasbot #1] -- HTTP POST (Image) --> C[🧠 FastAPI Server]
    B[🤖 Rasbot #2] -- HTTP POST (Image) --> C
    C -- AI Analysis (VLM) --> D[(State DB)]
    C -- MJPEG Stream --> E[💻 React Dashboard]
    E -- Command (Start/Stop) --> C

---

🚀 Getting Started
이 프로젝트는 **Server(Python)**와 **Client(React)**로 구성되어 있습니다.

1. Prerequisites (준비 사항)
Node.js 18+

Python 3.10+

Webcam (for testing)

2. Server Setup (Back-end)
`# 1. 폴더 이동
cd lab-guardian-server

# 2. 가상환경 생성 및 활성화
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate

# 3. 라이브러리 설치
pip install fastapi uvicorn[standard] opencv-python python-multipart numpy requests

# 4. 서버 실행
python main.py`

3. Client Setup (Front-end)
`# 1. 폴더 이동
cd lab-guardian-web

# 2. 의존성 설치
npm install

# 3. 웹 서버 실행
npm run dev`

4. Robot Simulation (Test Mode)
로봇 하드웨어가 없어도 웹캠으로 테스트할 수 있습니다.
`# 새 터미널에서 실행
cd lab-guardian-server
python dummy_robot.py`

---

📂 Project Structure
`root/
├── lab-guardian-server/   # 🧠 Backend (FastAPI)
│   ├── main.py            # API Server & Streaming Logic
│   ├── dummy_robot.py     # Robot Simulator (Client Logic)
│   └── venv/              # Python Virtual Environment
│
└── lab-guardian-web/      # 💻 Frontend (React + Vite)
    ├── src/
    │   ├── App.tsx        # Dashboard UI & Logic
    │   └── main.tsx       # Entry Point
    └── package.json`

---

🛠️ Troubleshooting
Q. 카메라가 켜지지 않고 멈춰있어요.

dummy_robot.py 파일에서 cv2.VideoCapture(0, cv2.CAP_DSHOW) 옵션을 추가하거나, 인덱스 번호를 1로 변경해 보세요.

Q. 영상이 너무 끊겨서 보여요.

HTTP 핸드셰이크 오버헤드 때문입니다. requests.Session()을 사용하여 세션을 유지하고 있는지 확인하세요. (현재 코드 적용 완료)

Q. MUI Grid 관련 오류가 떠요.

MUI v6부터는 <Grid item> 대신 <Grid size={{ xs: 12 }}> 형식을 사용해야 합니다. 또는 Grid2 컴포넌트를 사용하세요.

---

<div align="center"> <sub>Built with ❤️ by Team ETRI Lab Guardian</sub> </div>

`-----

### 🎨 적용하는 꿀팁

1.  **스크린샷 추가:** 프로젝트 폴더 안에 `assets`라는 폴더를 만들고, 아까 띄운 웹 화면을 캡처해서 `dashboard.png`로 저장하세요.
      * 그 후 위 코드의 `![Dashboard Screen](...)` 부분 주소를 `./assets/dashboard.png`로 바꾸면 진짜 멋있어집니다.
2.  **배지:** 맨 위에 있는 배지들(React, Python 등)은 깃허브에 올리면 자동으로 예쁘게 나옵니다.

이대로 깃허브(GitHub)에 올리면 포트폴리오로 쓰기에도 손색없을 겁니다\! 추가하고 싶은 내용이 있으면 말씀해주세요.`
