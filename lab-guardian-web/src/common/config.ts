// src/common/config.ts

export const NETWORK_CONFIG = {
  // 데스크탑(PC) IP - C# 게이트웨이 및 Redis가 실행되는 메인 서버 IP
  PC_IP: "192.168.0.149",
  
  // 라즈베리파이(로봇) IP
  ROBOT_IP: "192.168.0.100",

  // 서비스별 포트 번호
  PORT_GATEWAY: 8888, // C# 게이트웨이 (알고리즘 및 웹의 목적지)
  PORT_ALGO: 3000,    // 파이썬 AI 서버
  PORT_WEB: 5173,     // 리액트 대시보드
  PORT_ROBOT: 9999,   // 라즈베리파이 제어용 (필요 시)

  // API 및 소켓 호출용 URL (실제 IP 적용)
  GATEWAY_URL: "http://192.168.0.149:8888",
  ALGO_API_URL: "http://192.168.0.149:3000",
  
  // 기존 코드 호환용
  NEST_API_URL: "http://192.168.0.149:8888",
};