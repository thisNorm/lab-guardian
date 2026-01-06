import { useState, useEffect } from 'react';
import axios from 'axios'; 

import { 
  AppBar, Toolbar, Typography, Container, Grid, Paper, 
  Button, Card, CardContent, Chip, Stack, Box,
  List, ListItem, ListItemText, Divider, CssBaseline, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField // 팝업창 관련 컴포넌트 추가
} from '@mui/material';
import { createTheme, ThemeProvider } from '@mui/material/styles';

// 아이콘
import SecurityIcon from '@mui/icons-material/Security';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import VideocamIcon from '@mui/icons-material/Videocam';
import AutoModeIcon from '@mui/icons-material/AutoMode';
import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
import DeleteIcon from '@mui/icons-material/Delete';

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
  const [robots, setRobots] = useState<Robot[]>([
    { id: 1, name: "Rasbot #01", status: "IDLE" }
  ]);
  const [logs, setLogs] = useState<string[]>([]);

  // 1. 팝업창 상태 관리 (열림/닫힘, 입력된 이름)
  const [openDialog, setOpenDialog] = useState(false);
  const [newRobotName, setNewRobotName] = useState("");

  useEffect(() => {
    addLog("시스템이 시작되었습니다.");
  }, []);

  const addLog = (msg: string) => {
    const time = new Date().toLocaleTimeString();
    setLogs(prev => [`[${time}] ${msg}`, ...prev]);
  };

  // 2. 기기 추가 버튼 클릭 시 -> 팝업 열기
  const handleOpenAddDialog = () => {
    const maxId = robots.length > 0 ? Math.max(...robots.map(r => r.id)) : 0;
    setNewRobotName(`Rasbot #0${maxId + 1}`); // 기본 이름 추천
    setOpenDialog(true);
  };

  // 3. 팝업에서 '추가' 클릭 시 -> 실제 기기 생성
  const handleConfirmAdd = () => {
    if (!newRobotName.trim()) {
      alert("기기 이름을 입력해주세요.");
      return;
    }

    const maxId = robots.length > 0 ? Math.max(...robots.map(r => r.id)) : 0;
    const newId = maxId + 1;
    
    const newRobot: Robot = {
      id: newId,
      name: newRobotName, // 입력받은 이름 사용
      status: 'OFFLINE'
    };
    
    setRobots([...robots, newRobot]);
    addLog(`새로운 기기(${newRobot.name})가 추가되었습니다.`);
    setOpenDialog(false); // 팝업 닫기
  };

  const handleDeleteRobot = (targetId: number, targetName: string) => {
    if (window.confirm(`${targetName} 기기를 삭제하시겠습니까?`)) {
      setRobots(prev => prev.filter(r => r.id !== targetId));
      addLog(`${targetName} 기기가 삭제되었습니다.`);
    }
  };

  const updateRobotStatus = (id: number, newStatus: RobotStatus) => {
    setRobots(prev => prev.map(robot => 
      robot.id === id ? { ...robot, status: newStatus } : robot
    ));
  };

  const getStatusChip = (status: RobotStatus) => {
    switch (status) {
      case 'PATROL': return <Chip icon={<AutoModeIcon />} label="순찰 중" color="success" />;
      case 'DANGER': return <Chip icon={<WarningAmberIcon />} label="위험 감지" color="error" variant="filled" />;
      case 'OFFLINE': return <Chip label="연결 끊김" color="default" />;
      default: return <Chip label="대기 중" color="primary" variant="outlined" />;
    }
  };

  const RobotCard = ({ robot, isSingleMode }: { robot: Robot, isSingleMode: boolean }) => (
    <Card sx={{ height: '100%', border: robot.status === 'DANGER' ? '2px solid red' : 'none' }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" mb={2}>
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="h6">🤖 {robot.name}</Typography>
            {getStatusChip(robot.status)}
          </Stack>
          <IconButton 
            aria-label="delete" 
            size="small" 
            color="error"
            onClick={() => handleDeleteRobot(robot.id, robot.name)}
          >
            <DeleteIcon />
          </IconButton>
        </Stack>
        
        <Box sx={{ 
            bgcolor: 'black', 
            height: isSingleMode ? '60vh' : 300, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            borderRadius: 1, 
            mb: 2, 
            overflow: 'hidden',
            transition: 'height 0.3s ease'
          }}>
          {robot.status === 'OFFLINE' ? (
            <Stack alignItems="center" spacing={1}>
                <VideocamIcon sx={{ fontSize: isSingleMode ? 80 : 50, color: '#555' }} />
                <Typography color="gray">신호 없음</Typography>
            </Stack>
          ) : (
            <img 
              src={`http://localhost:8000/video_feed/${robot.id}`} 
              alt={`${robot.name} Camera`}
              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
            />
          )}
        </Box>

        <Stack direction="row" spacing={1}>
          <Button variant="contained" color="success" fullWidth disabled={robot.status === 'OFFLINE'}
            onClick={() => { 
              updateRobotStatus(robot.id, 'PATROL'); 
              addLog(`${robot.name}: 순찰 시작 명령 전송.`);
              axios.post(`http://localhost:8000/command/${robot.id}/start`).catch(e => console.error(e));
            }}>
            출동
          </Button>
          <Button variant="outlined" color="error" fullWidth disabled={robot.status === 'OFFLINE'}
            onClick={() => { 
              updateRobotStatus(robot.id, 'IDLE'); 
              addLog(`${robot.name}: 복귀 명령 전송.`);
              axios.post(`http://localhost:8000/command/${robot.id}/stop`).catch(e => console.error(e));
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
          
          <Stack direction="row" spacing={2} alignItems="center">
            <Button 
              variant="outlined" 
              startIcon={<AddCircleOutlineIcon />} 
              onClick={handleOpenAddDialog} // 버튼 클릭 시 팝업 열기
              size="small"
              sx={{ borderColor: '#90caf9', color: '#90caf9' }}
            >
              기기 추가
            </Button>
            <Chip label={`Devices: ${robots.length}`} color="default" size="small" variant="outlined" />
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
                  <Paper sx={{ p: 5, textAlign: 'center', borderStyle: 'dashed', borderColor: '#555' }}>
                    <Typography color="gray">연결된 기기가 없습니다. 우측 상단 '기기 추가' 버튼을 눌러주세요.</Typography>
                  </Paper>
                </Grid>
              ) : (
                robots.map((robot) => (
                  <Grid 
                    item 
                    key={robot.id} 
                    xs={12} 
                    md={robots.length === 1 ? 12 : 6} 
                  >
                    <RobotCard 
                      robot={robot} 
                      isSingleMode={robots.length === 1}
                    />
                  </Grid>
                ))
              )}
            </Grid>

            <Paper sx={{ p: 2, mt: 3, minHeight: 100 }}>
              <Typography variant="subtitle1" gutterBottom sx={{ color: '#90caf9' }}>
                👁️ AI Vision Analysis (Real-time)
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {robots.some(r => r.status === 'DANGER')
                  ? "🚨 경고: 위험 객체가 감지되었습니다! 즉시 확인 바랍니다."
                  : "현재 모든 구역 특이사항 없습니다. 안전하게 순찰 중입니다."}
              </Typography>
            </Paper>
          </Grid>

          <Grid item xs={12} md={3}>
            <Paper sx={{ height: '100%', p: 2, maxHeight: '85vh', overflow: 'auto' }}>
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

        {/* 4. 기기 추가 팝업창 (Dialog) */}
        <Dialog open={openDialog} onClose={() => setOpenDialog(false)}>
          <DialogTitle>새로운 로봇 추가</DialogTitle>
          <DialogContent>
            <Typography variant="body2" sx={{ mb: 2, color: 'gray' }}>
              추가할 로봇의 이름을 입력하세요.
            </Typography>
            <TextField
              autoFocus
              margin="dense"
              label="기기 이름"
              type="text"
              fullWidth
              variant="outlined"
              value={newRobotName}
              onChange={(e) => setNewRobotName(e.target.value)}
              onKeyPress={(e) => { if (e.key === 'Enter') handleConfirmAdd(); }} // 엔터키 지원
            />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setOpenDialog(false)} color="inherit">취소</Button>
            <Button onClick={handleConfirmAdd} variant="contained" color="primary">
              추가하기
            </Button>
          </DialogActions>
        </Dialog>

      </Container>
    </ThemeProvider>
  );
}

export default App;