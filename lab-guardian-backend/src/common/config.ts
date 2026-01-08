// src/common/config.ts

export const NETWORK_CONFIG = {
  // 1. IP 주소 정의
  ROBOT_IP: "192.168.0.100",
  PC_IP: "192.168.0.131",
  
  // 2. 포트 정의
  PORT_ALGO: 3000,
  PORT_NEST: 8000,
  PORT_WEB: 5000,
  PORT_ROBOT: 9999,

  // 3. 서비스 풀 URL (주로 React나 외부 통신용)
  ROBOT_WS_URL: "ws://192.168.0.100:9999",
  NEST_API_URL: "http://192.168.0.131:8000",
};

// 상수로 개별 추출 (NestJS에서 쓰기 편하게)
export const NEST_PORT = NETWORK_CONFIG.PORT_NEST;