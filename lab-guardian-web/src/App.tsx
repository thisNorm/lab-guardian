import { useState, useEffect, useRef } from 'react';
import axios from 'axios'; 
import { io, Socket } from "socket.io-client";
import { NETWORK_CONFIG } from './common/config.ts';

import { 
  AppBar, Toolbar, Typography, Container, Grid, Paper, 
  Button, Card, CardContent, Chip, Stack, Box,
  List, ListItem, ListItemText, Divider, CssBaseline
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import SecurityIcon from '@mui/icons-material/Security';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import AutoModeIcon from '@mui/icons-material/AutoMode';

// MUI Grid의 유효한 값들을 타입으로 지정
type GridSize = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#90caf9' },
    secondary: { main: '#f48fb1' },
    background: { default: '#0a1929', paper: '#102030' },
  },
});

type RobotStatus = 'IDLE' | 'PATROL' | 'DANGER' | 'OFFLINE';

interface Robot {
  id: number | string;
  name: string;
  status: RobotStatus;
}

function App() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const socketRef = useRef<Socket | null>(null);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev]);
  };

  useEffect(() => {
    addLog("시스템 모니터링 시작...");
    axios.get(`${NETWORK_CONFIG.NEST_API_URL}/api/robots`)
      .then(res => setRobots(res.data))
      .catch(() => addLog("⚠️ 백엔드 서버 연결 실패"));

    socketRef.current = io(NETWORK_CONFIG.NEST_API_URL);
    socketRef.current.on('alarm_event', (data: any) => {
      addLog(`🚨 감지 알람: ${data.message} (${data.cam_id})`);
      setRobots(prev => prev.map(robot => 
        String(robot.id) === String(data.cam_id).replace('Robot_', '') 
        ? { ...robot, status: 'DANGER' } : robot
      ));
    });

    return () => { socketRef.current?.disconnect(); };
  }, []);

  // ✅ 수정된 그리드 계산 함수: 반환 타입을 GridSize로 강제함
  const getGridSize = (total: number): GridSize => {
    if (total === 1) return 12;
    if (total === 2) return 6;
    return 4; // 3개 이상일 때
  };

  const getVideoHeight = (total: number) => total === 1 ? '65vh' : (total <= 2 ? 400 : 250);

  const RobotCard = ({ robot, count }: { robot: Robot, count: number }) => (
    <Card sx={{ height: '100%', border: robot.status === 'DANGER' ? '3px solid #ff1744' : '1px solid #333' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6">🤖 {robot.name}</Typography>
            {robot.status === 'PATROL' && <Chip icon={<AutoModeIcon />} label="순찰 중" color="success" size="small" />}
            {robot.status === 'DANGER' && <Chip icon={<WarningAmberIcon />} label="위험" color="error" size="small" />}
            {robot.status === 'IDLE' && <Chip label="대기" color="primary" variant="outlined" size="small" />}
          </Stack>
        </Stack>
        
        <Box sx={{ 
            bgcolor: 'black', height: getVideoHeight(count), 
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            borderRadius: 1, mb: 2, overflow: 'hidden'
          }}>
          <img 
            src={`http://${NETWORK_CONFIG.PC_IP}:${NETWORK_CONFIG.PORT_ALGO}/video_feed/${robot.id}`} 
            alt={`${robot.name} Stream`}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onError={(e) => { e.currentTarget.src = "https://via.placeholder.com/640x480?text=No+Signal"; }}
          />
        </Box>

        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="success" fullWidth 
            onClick={() => { axios.post(`${NETWORK_CONFIG.NEST_API_URL}/api/robot/command/${robot.id}`, {action: 'start'}); addLog(`${robot.name} 출동`); }}>
            출동
          </Button>
          <Button variant="outlined" color="error" fullWidth 
            onClick={() => { axios.post(`${NETWORK_CONFIG.NEST_API_URL}/api/robot/command/${robot.id}`, {action: 'stop'}); addLog(`${robot.name} 복귀`); }}>
            복귀
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <AppBar position="static" color="transparent" elevation={0} sx={{ borderBottom: '1px solid #333' }}>
        <Toolbar>
          <SecurityIcon sx={{ mr: 2, color: '#90caf9' }} />
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 'bold' }}>Lab Guardian Dashboard</Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <Chip label={`Active Robots: ${robots.length}`} color="default" size="small" />
            <Chip label="System: Live" color="success" size="small" variant="outlined" />
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 4 }}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={9}>
            <Grid container spacing={2}>
              {robots.length === 0 ? (
                <Grid item xs={12}>
                  <Paper sx={{ p: 10, textAlign: 'center', borderStyle: 'dashed' }}>
                    <Typography color="gray">대기 중인 로봇이 없습니다.</Typography>
                  </Paper>
                </Grid>
              ) : (
                robots.map((robot) => (
                  // ✅ md 프롭스에 들어가는 값을 명확히 함
                  <Grid item key={robot.id} xs={12} md={getGridSize(robots.length)}>
                    <RobotCard robot={robot} count={robots.length} />
                  </Grid>
                ))
              )}
            </Grid>
          </Grid>

          <Grid item xs={12} md={3}>
            <Paper sx={{ height: '80vh', p: 2, overflow: 'auto' }}>
              <Typography variant="h6" gutterBottom>Real-time Logs</Typography>
              <Divider sx={{ mb: 2 }} />
              <List dense>
                {logs.map((log, index) => (
                  <ListItem key={index}><ListItemText primary={log} /></ListItem>
                ))}
              </List>
            </Paper>
          </Grid>
        </Grid>
      </Container>
    </ThemeProvider>
  );
}

export default App;