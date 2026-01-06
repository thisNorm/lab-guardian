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

function App() {
  const [robot1Status, setRobot1Status] = useState<RobotStatus>('IDLE');
  const [robot2Status, setRobot2Status] = useState<RobotStatus>('OFFLINE');
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    addLog("시스템이 시작되었습니다.");
    addLog("서버 연결 대기 중...");
  }, []);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev]);
  };

  const getStatusChip = (status: RobotStatus) => {
    switch (status) {
      case 'PATROL': return <Chip icon={<AutoModeIcon />} label="순찰 중" color="success" />;
      case 'DANGER': return <Chip icon={<WarningAmberIcon />} label="위험 감지" color="error" variant="filled" />;
      case 'OFFLINE': return <Chip label="연결 끊김" color="default" />;
      default: return <Chip label="대기 중" color="primary" variant="outlined" />;
    }
  };

  const RobotCard = ({ id, name, status, setStatus }: { id: number, name: string, status: RobotStatus, setStatus: any }) => (
    <Card sx={{ height: '100%', border: status === 'DANGER' ? '2px solid red' : 'none' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Typography variant="h6" component="div">🤖 {name}</Typography>
          {getStatusChip(status)}
        </Stack>
         
        <Box sx={{ bgcolor: 'black', height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 1, mb: 2, overflow: 'hidden' }}>
          {status === 'OFFLINE' ? (
            <Stack alignItems="center" spacing={1}>
                <VideocamIcon sx={{ fontSize: 40, color: '#555' }} />
                <Typography color="gray">신호 없음</Typography>
            </Stack>
          ) : (
            <img 
              src={`http://localhost:8000/video_feed/${id}`} 
              alt={`${name} Camera`}
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </Box>

        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="success" fullWidth disabled={status === 'OFFLINE'}
            onClick={() => { 
              setStatus('PATROL'); 
              addLog(`${name}: 순찰 시작 명령 전송.`);
              axios.post(`http://localhost:8000/command/${id}/start`).catch(e => console.error(e));
            }}>
            출동
          </Button>
          <Button variant="outlined" color="error" fullWidth disabled={status === 'OFFLINE'}
            onClick={() => { 
              setStatus('IDLE'); 
              addLog(`${name}: 복귀 명령 전송.`);
              axios.post(`http://localhost:8000/command/${id}/stop`).catch(e => console.error(e));
            }}>
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
          <Typography variant="h6" component="div" sx={{ flexGrow: 1, fontWeight: 'bold' }}>
            ETRI Lab Guardian System
          </Typography>
          <Chip label="Server: Online" color="success" size="small" variant="outlined" />
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ mt: 4, mb: 4 }}>
        {/* 호환성 모드: item 등의 에러를 무시하고 예전 방식 Grid 사용 */}
        <Grid container spacing={3}>
          
          <Grid item xs={12} md={8}>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={6}>
                <RobotCard id={1} name="Rasbot #01" status={robot1Status} setStatus={setRobot1Status} />
              </Grid>
              <Grid item xs={12} sm={6}>
                <RobotCard id={2} name="Rasbot #02" status={robot2Status} setStatus={setRobot2Status} />
              </Grid>
            </Grid>

            <Paper sx={{ p: 2, mt: 3, minHeight: 150 }}>
              <Typography variant="subtitle1" gutterBottom sx={{ color: '#90caf9' }}>
                👁️ AI Vision Analysis (Real-time)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {robot1Status === 'DANGER' 
                  ? "🚨 경고: 전방 3m 지점에 '쓰러진 사람' 객체가 98% 확률로 탐지되었습니다. (Camera 01)"
                  : "현재 특이사항 없습니다. 안전하게 순찰 중입니다."}
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} md={4}>
            <Paper sx={{ height: '100%', p: 2, maxHeight: 600, overflow: 'auto' }}>
              <Typography variant="h6" gutterBottom>
                System Logs
              </Typography>
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