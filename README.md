# 🛡️ ETRI Lab Guardian System
> **AI 기반 다중 로봇 및 CCTV 통합 실험실 안전 관제 시스템**
> (AI-Powered Multi-Robot & CCTV Laboratory Safety Monitoring System)

<div align="center">

![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)
![C#](https://img.shields.io/badge/C%23-239120?style=for-the-badge&logo=c-sharp&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-005571?style=for-the-badge&logo=fastapi)
![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![OpenCV](https://img.shields.io/badge/OpenCV-5C3EE8?style=for-the-badge&logo=opencv&logoColor=white)
![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socket.io&logoColor=white)

</div>

---

## 📖 Project Overview
**Lab Guardian**은 위험한 실험실 환경을 순찰하는 자율 주행 로봇(Raspbot)과 고정형 CCTV를 통합 관리하는 시스템입니다. AI 객체 탐지를 통해 위험 상황을 실시간 감지하며, 전용 **C# 게이트웨이**를 통해 모든 보안 이벤트를 데이터베이스에 체계적으로 기록합니다. 특히, 중간 서버를 거치지 않는 **로봇 직결 제어 시스템**과 **상태별 로그 분리 저장 로직**을 통해 실시간 관제 성능과 사후 추적성을 동시에 확보했습니다.

### ✨ 핵심 업데이트 기능 (Core Features)
* **Integrated C# Gateway:** 모든 엣지 장치의 신호를 통합하여 WebSocket으로 브라우저에 전송하고, 동시에 SQLite DB에 이력을 남기는 고성능 관제 허브 구현.
* **Dual-Column Log System:** CCTV 로그와 로봇 로그를 별도 컬럼에 저장하여 장치별 독립적인 이력 관리가 가능하며, `CamId`를 통한 명확한 기기 식별 지원.
* **Real-time Connection Monitoring:** 장치의 연결 성공(`CONNECTED`) 및 종료(`DISCONNECTED`)를 실시간 감지하여 DB에 자동 기록.
* **Operation Mode Tracking:** 사용자의 전체화면 조종(`CONTROL`) 및 자동 감시(`MONITOR`) 모드 전환 이력을 로그화하여 관제 상태 추적 가능.
* **Smart Log Categorization:** 기기 이름(CCTV/Webcam/Robot)에 따라 웹 대시보드의 좌/우 로그 섹션으로 자동 분류되는 지능형 라우팅 로직.
* **Direct Web-to-Robot Control:** Socket.io를 활용해 웹 브라우저에서 로봇으로 제어 신호를 직접 송신하여 초저지연 조종 성능 확보.
* **Auto-Recovery Alarm:** 위험 감지 시 붉은색 점멸 알람이 발생하며, 10초 후 자동으로 정상 상태로 복구되는 지능형 타이머 로직.

---

## 🏗️ System Architecture

### 1. High-Level Architecture

```mermaid
graph TD
    subgraph "Edge Devices (Robot / CCTV)"
        A[🤖 Raspbot] -- aiohttp (POST) --> C
        B[📷 Static CCTV] -- aiohttp (POST) --> C
        A -- Socket.io (Port: 5001) --- F
    end

    subgraph "Core Data & Control Hub"
        C[🧠 Algo Server (FastAPI)] -- TCP Message --> G
        G[🚀 C# Gateway] -- Save Log --> DB[(SQLite DB)]
        G -- WebSocket (Port: 8080) --> F
    end

    subgraph "Control Center (Dashboard)"
        F[💻 React Web] -- MJPEG Stream --> F
        F -- Direct Control Cmd --> A
        F -- Mode Update (POST) --> C
    end
```
</div>
</div>
---
</div>
</div>
## 📖 Project Overview
**Lab Guardian**은 위험한 실험실 환경을 순찰하는 자율 주행 로봇(Raspbot)과 고정형 CCTV를 통합 관리하는 시스템입니다. AI 객체 탐지를 통해 위험 상황을 실시간 감지하며, 전용 **C# 게이트웨이**를 통해 모든 보안 이벤트를 데이터베이스에 체계적으로 기록합니다. 특히, 중간 서버를 거치지 않는 **로봇 직결 제어 시스템**과 **상태별 로그 분리 저장 로직**을 통해 실시간 관제 성능과 사후 추적성을 동시에 확보했습니다.

### ✨ 핵심 업데이트 기능 (Core Features)
* **Integrated C# Gateway:** 모든 엣지 장치의 신호를 통합하여 WebSocket으로 브라우저에 전송하고, 동시에 SQLite DB에 이력을 남기는 고성능 관제 허브 구현.
* **Dual-Column Log System:** CCTV 로그와 로봇 로그를 별도 컬럼에 저장하여 장치별 독립적인 이력 관리가 가능하며, `CamId`를 통한 명확한 기기 식별 지원.
* **Real-time Connection Monitoring:** 장치의 연결 성공(`CONNECTED`) 및 종료(`DISCONNECTED`)를 실시간 감지하여 DB에 자동 기록.
* **Operation Mode Tracking:** 사용자의 전체화면 조종(`CONTROL`) 및 자동 감시(`MONITOR`) 모드 전환 이력을 로그화하여 관제 상태 추적 가능.
* **Smart Log Categorization:** 기기 이름(CCTV/Webcam/Robot)에 따라 웹 대시보드의 좌/우 로그 섹션으로 자동 분류되는 지능형 라우팅 로직.
* **Direct Web-to-Robot Control:** Socket.io를 활용해 웹 브라우저에서 로봇으로 제어 신호를 직접 송신하여 초저지연 조종 성능 확보.
* **Auto-Recovery Alarm:** 위험 감지 시 붉은색 점멸 알람이 발생하며, 10초 후 자동으로 정상 상태로 복구되는 지능형 타이머 로직.
</div>
</div>
---
</div>
</div>
## 🏗️ System Architecture

### 1. High-Level Architecture

```mermaid
graph TD
    subgraph "Edge Devices (Robot / CCTV)"
        A[🤖 Raspbot] -- aiohttp (POST) --> C
        B[📷 Static CCTV] -- aiohttp (POST) --> C
        A -- Socket.io (Port: 5001) --- F
    end

    subgraph "Core Data & Control Hub"
        C[🧠 Algo Server (FastAPI)] -- TCP Message --> G
        G[🚀 C# Gateway] -- Save Log --> DB[(SQLite DB)]
        G -- WebSocket (Port: 8080) --> F
    end

    subgraph "Control Center (Dashboard)"
        F[💻 React Web] -- MJPEG Stream --> F
        F -- Direct Control Cmd --> A
        F -- Mode Update (POST) --> C
    end
```
</div>
</div>
---
</div>
</div>
## 2. Standardized Event Flow (이벤트 흐름)
모든 이벤트는 일관된 메시지 포맷으로 처리되어 DB와 웹에 동일하게 기록됩니다.
| **상태 \(Status\)** | **내용 \(Message\)** | **비고**             | **** | **** | **** | **** | **** | **** | **** |
|-------------------|--------------------|--------------------|------|------|------|------|------|------|------|
| DANGER            | 🚨 침입자 감지\!        | 즉시 DB 저장 및 웹 점멸 알람 |      |      |      |      |      |      |      |
| SAFE              | ✅ 이상 없음 \(정기 보고\)  | 10분 주기 하트비트 보고     |      |      |      |      |      |      |      |
| CONNECTED         | 🌐 장치 연결 성공        | 장치 최초 접속 시 기록      |      |      |      |      |      |      |      |
| DISCONNECTED      | ❌ 장치 연결 끊김         | 5초 이상 신호 부재 시 기록   |      |      |      |      |      |      |      |
| CONTROL           | 🎮 조종 모드 진입        | 전체화면 조종 시 기록       |      |      |      |      |      |      |      |
| MONITOR           | 🛡️ 감시 모드 복귀       | 전체화면 해제 시 기록       |      |      |      |      |      |      |      |
|                   |                    |                    |      |      |      |      |      |      |      |
|                   |                    |                    |      |      |      |      |      |      |      |
|                   |                    |                    |      |      |      |      |      |      |      |

</div>
</div>
---
</div>
</div>
## 💡 Technical Decisions (기술적 의사결정)
### 1. C# 기반 통합 게이트웨이 및 SQLite 연동
데이터의 무결성과 실시간 전송을 위해 멀티스레딩에 강한 C#으로 게이트웨이를 구축했습니다. Fleck 라이브러리를 활용한 WebSocket 통신과 Entity Framework Core를 활용한 SQLite 연동으로 고부하 상황에서도 안정적인 로그 저장을 보장합니다.

### 2. 정밀 로그 분리 로직 (CctvLog vs RobotLog)
단일 로그 테이블에서 발생하던 기기 식별의 혼란을 방지하기 위해, 수신된 `deviceId` 키워드를 분석하여 해당 컬럼에만 로그를 남기고 반대편은 `NULL`로 처리하는 로직을 구현했습니다. 이를 통해 데이터베이스의 가독성과 분석 효율을 극대화했습니다.

### 3. aiohttp 기반의 비동기 데이터 파이프라인
기존 동기 전송 방식의 성능 병목을 해결하기 위해 `aiohttp`와 `asyncio`를 도입했습니다. 영상 전송과 로봇 제어를 병렬 처리함으로써, 매끄러운 주행과 고화질 스트리밍을 동시에 달성했습니다.
</div>
</div>
---
</div>
</div>
## 🚀 Getting Started (통합 실행 가이드)
### 1️⃣ C# 게이트웨이 (Hub)
```bash
# dotnet CLI 환경에서 실행
cd lab-guardian-gateway
dotnet run
# Port: 8888 (TCP), 8080 (WS)
```
</div>
### 2️⃣ 알고리즘 서버 (AI Server)
```bash
cd lab-guardian-algorithm
pip install -r requirements.txt
# AI 탐지 및 10분 주기 SAFE 보고 활성화
python main.py
python multi_cam_agent.py
```
</div>
### 3️⃣ 웹 대시보드 (React)
```bash
cd lab-guardian-web
npm install
npm run dev
```
</div>
</div>
---
</div>
</div>
## 📂 Project Structure
```bash
root/
├── lab-guardian-gateway/    # C# 통합 게이트웨이 (Fleck, EF Core)
│   ├── Program.cs           # DB 저장 및 WebSocket 브로드캐스트 로직
│   └── LogDatabase.db       # 보안 이벤트 로그 저장소 (SQLite)
│
├── lab-guardian-algorithm/  # AI 처리 서버 (FastAPI)
│   ├── main.py              # 프레임 분석 및 상태(DANGER/SAFE/MODE) 보고
│   └── ai_detector.py       # YOLO 기반 객체 탐지 및 추적 엔진
│
└── lab-guardian-web/        # React 관제 대시보드 (MUI)
    └── src/App.tsx          # 좌(CCTV)/우(Robot) 로그 자동 분류 및 조종 로직
```
</div>
</div>
---
</div>
</div>
## 🛠️ Troubleshooting (해결 사례)

+ **DB 파일 잠금 및 완전 초기화**: 서버 종료 후 .db, .db-shm, .db-wal 파일을 모두 삭제하여 데이터 정합성 문제 해결 및 클린 초기화를 수행하는 가이드를 구축했습니다.

+ **터미널 제어권 반환 및 프로세스 관리**: 서버 종료 시 백그라운드 스레드 점유 문제를 stop_event와 os._exit(0) 도입으로 해결하여 즉각적인 프롬프트 반환을 보장했습니다.

+ **로그 실시간 분류 오류**: 리액트 onmessage 내 기기 키워드(CCTV/WEBCAM) 필터링 로직 보완을 통해 로봇 로그가 CCTV 창에 섞이는 문제를 해결했습니다.

+ **비동기 영상 전송 딜레이**: main_server.py의 asyncio.sleep() 조정을 통해 주행 제어와 스트리밍 간의 성능 최적화를 달성했습니다.

---

<div align="center"> <b>This project was designed and developed entirely by GyuBeom Hwang.</b>

<sub>1인 개인 프로젝트 | ETRI 자율형IoT연구실</sub>

</div>
