import { useState, useEffect } from 'react';
import axios from 'axios'; 

import { 
  AppBar, Toolbar, Typography, Container, Grid, Paper, 
  Button, Card, CardContent, Chip, Stack, Box,
  List, ListItem, ListItemText, Divider, CssBaseline
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

// 아이콘
import SecurityIcon from '@mui/icons-material/Security';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import VideocamIcon from '@mui/icons-material/Videocam';
import AutoModeIcon from '@mui/icons-material/AutoMode';

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
  id: number;
  name: string;
  status: RobotStatus;
}

function App() {
  const [robots, setRobots] = useState<Robot[]>([]);
  const [logs, setLogs] = useState<string[]>([]);

  // 2초마다 서버 상태 확인 (Polling)
  useEffect(() => {
    addLog("시스템 모니터링 시작...");
    
    const interval = setInterval(() => {
      axios.get('http://localhost:8000/robots')
        .then(res => {
          setRobots(res.data);
        })
        .catch(err => console.error("서버 연결 대기 중..."));
    }, 2000);

    return () => clearInterval(interval);
  }, []);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev]);
  };

  // 그리드 사이즈 자동 계산
  const getGridSize = (total: number) => {
    if (total === 1) return 12; // 1개면 꽉 차게
    if (total === 2) return 6;  // 2개면 반반
    if (total === 3) return 4;  // 3개면 3등분
    if (total === 4) return 6;  // 4개면 2줄
    return 4; 
  };

  // 비디오 높이 자동 계산
  const getVideoHeight = (total: number) => {
    if (total === 1) return '65vh'; // 1개일 땐 크게
    if (total <= 2) return 400;
    return 250;
  };

  const RobotCard = ({ robot, count }: { robot: Robot, count: number }) => (
    <Card sx={{ height: '100%', border: robot.status === 'DANGER' ? '2px solid red' : 'none' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={1}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6">🤖 {robot.name}</Typography>
            {robot.status === 'PATROL' && <Chip icon={<AutoModeIcon />} label="순찰 중" color="success" size="small" />}
            {robot.status === 'DANGER' && <Chip icon={<WarningAmberIcon />} label="위험 감지" color="error" size="small" />}
            {robot.status === 'IDLE' && <Chip label="대기" color="primary" variant="outlined" size="small" />}
          </Stack>
        </Stack>
        
        <Box sx={{ 
            bgcolor: 'black', 
            height: getVideoHeight(count), 
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            borderRadius: 1, mb: 2, overflow: 'hidden',
            transition: 'height 0.5s ease'
          }}>
          <img 
            src={`http://localhost:8000/video_feed/${robot.id}`} 
            alt={`${robot.name} Camera`}
            style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            onError={(e) => { e.currentTarget.style.display='none'; }} 
          />
        </Box>

        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="success" fullWidth 
            onClick={() => { axios.post(`http://localhost:8000/command/${robot.id}/start`); addLog(`${robot.name} 출동`); }}>
            출동
          </Button>
          <Button variant="outlined" color="error" fullWidth 
            onClick={() => { axios.post(`http://localhost:8000/command/${robot.id}/stop`); addLog(`${robot.name} 복귀`); }}>
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
          <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 'bold' }}>ETRI Lab Guardian</Typography>
          <Stack direction="row" spacing={2} alignItems="center">
            <Chip label={`Active: ${robots.length}`} color="default" size="small" />
            <Chip label="Server: Online" color="success" size="small" variant="outlined" />
          </Stack>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 4, mb: 4 }}>
        <Grid container spacing={3}>
          <Grid item xs={12} md={9}>
            <Grid container spacing={2} justifyContent="center">
              {robots.length === 0 ? (
                <Grid item xs={12}>
                  <Paper sx={{ p: 10, textAlign: 'center', borderStyle: 'dashed', borderColor: '#555' }}>
                    <Typography variant="h5" color="text.secondary">연결된 로봇이 없습니다.</Typography>
                    <Typography color="gray">터미널에서 dummy_robot.py를 실행하세요.</Typography>
                  </Paper>
                </Grid>
              ) : (
                robots.map((robot) => (
                  <Grid item key={robot.id} xs={12} md={getGridSize(robots.length)}>
                    <RobotCard robot={robot} count={robots.length} />
                  </Grid>
                ))
              )}
            </Grid>
          </Grid>

          <Grid item xs={12} md={3}>
            <Paper sx={{ height: '100%', p: 2, maxHeight: '85vh', overflow: 'auto' }}>
              <Typography variant="h6" gutterBottom>System Logs</Typography>
              <Divider sx={{ mb: 2 }} />
              <List dense>
                {logs.map((log, index) => (
                  <ListItem key={index}>
                    <ListItemText primary={log} primaryTypographyProps={{ style: { fontFamily: 'monospace' } }} />
                  </ListItem>
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