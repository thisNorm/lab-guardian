// src/common/config.ts

export const NETWORK_CONFIG = {
  // 데스크탑(PC) IP - NestJS와 알고리즘 서버가 실행되는 곳
  PC_IP: "192.168.0.131",
  
  // 라즈베리파이(로봇) IP
  ROBOT_IP: "192.168.0.100",

  // 서비스별 포트 번호
  PORT_NEST: 8000,
  PORT_ALGO: 3000,
  PORT_WEB: 5000,
  PORT_ROBOT: 9999,

  // API 호출용 전체 URL
  NEST_API_URL: "http://192.168.0.131:8000",
  ALGO_API_URL: "http://192.168.0.131:3000",
  
  // 소켓 연결용 주소 (NestJS와 실시간 통신)
  NEST_SOCKET_URL: "http://192.168.0.131:8000",
};