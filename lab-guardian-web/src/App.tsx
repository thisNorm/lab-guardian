import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from "socket.io-client"; 
import { NETWORK_CONFIG } from './common/config'; // 👈 설정 파일 임포트
import { 
  AppBar, Toolbar, Typography, Paper, Button, Card, Stack, Box,
  List, ListItem, ListItemText, CssBaseline, keyframes,
  IconButton, TextField, Dialog, DialogTitle, DialogContent, DialogActions 
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import SecurityIcon from '@mui/icons-material/Security';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';

const flashRed = keyframes`
  0% { border-color: #ff1744; box-shadow: 0 0 5px #ff1744; }
  50% { border-color: #b2102f; box-shadow: 0 0 30px #ff1744; }
  100% { border-color: #ff1744; box-shadow: 0 0 5px #ff1744; }
`;

const darkTheme = createTheme({ 
  palette: { 
    mode: 'dark', 
    background: { default: '#050a10', paper: '#0c141d' },
    primary: { main: '#90caf9' },
    secondary: { main: '#ce93d8' },
    error: { main: '#ff1744' },
  } 
});

type DeviceStatus = 'IDLE' | 'PATROL' | 'DANGER';
interface Device { id: string; name: string; status: DeviceStatus; type: 'CCTV' | 'ROBOT'; }

function App() {
  const [devices, setDevices] = useState<Device[]>([
    { id: 'Robot_01', name: 'Robot_01', status: 'IDLE', type: 'ROBOT' }
  ]);
  
  const [cctvDisplayLogs, setCctvDisplayLogs] = useState<string[]>([]);
  const [robotDisplayLogs, setRobotDisplayLogs] = useState<string[]>([]);
  const [logHeight, setLogHeight] = useState(200);
  const [maximizedCctv, setMaximizedCctv] = useState<string | null>(null);
  const [maximizedRobot, setMaximizedRobot] = useState<string | null>(null);
  const maximizedRobotRef = useRef<string | null>(null);

  const [open, setOpen] = useState(false);
  const [targetType, setTargetType] = useState<'CCTV' | 'ROBOT'>('CCTV');
  const [newName, setNewName] = useState('');
  
  const gatewaySocketRef = useRef<WebSocket | null>(null);
  const robotSocketRef = useRef<Socket | null>(null);
  const isResizing = useRef(false);
  const alertTimers = useRef<{ [key: string]: number }>({});

  useEffect(() => { maximizedRobotRef.current = maximizedRobot; }, [maximizedRobot]);

  const startResizing = useCallback(() => { isResizing.current = true; document.body.style.cursor = 'row-resize'; }, []);
  const stopResizing = useCallback(() => { isResizing.current = false; document.body.style.cursor = 'default'; }, []);
  const resizeLogs = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const newHeight = window.innerHeight - e.clientY;
    if (newHeight > 80 && newHeight < window.innerHeight * 0.8) setLogHeight(newHeight);
  }, []);

  // -------------------------------------------------------------
  // 🔥 [1] C# 게이트웨이 웹소켓 연결
  // -------------------------------------------------------------
  useEffect(() => {
    // 주의: C# 서버에서 웹 대시보드용으로 열어둔 포트는 8080입니다.
    // NETWORK_CONFIG.PC_IP (192.168.0.149) 사용
    const wsUrl = `ws://${NETWORK_CONFIG.PC_IP}:8080`;
    console.log(`📡 Connecting to Gateway: ${wsUrl}`);
    
    const ws = new WebSocket(wsUrl);
    gatewaySocketRef.current = ws;

    ws.onopen = () => {
      console.log("✅ C# Gateway Connected");
      setRobotDisplayLogs(prev => [`[System] 게이트웨이(${NETWORK_CONFIG.PC_IP}) 연결됨`, ...prev]);
    };

    ws.onmessage = (event) => {
      try {
        // 1. C#이 보낸 JSON 데이터를 뜯어봅니다.
        const data = JSON.parse(event.data);
        const { status, message, time } = data; // 구조 분해 할당

        console.log(`📩 DB Data Received:`, data);

        const targetId = 'Robot_01'; // 혹은 data.camId 사용 가능

        // 2. 상태 아이콘/테두리 업데이트
        setDevices(prev => prev.map(d => {
            if (d.id === targetId && d.status !== status) {
                return { ...d, status: status as DeviceStatus };
            }
            return d;
        }));

        // 3. 로그 목록에 추가 (DB에 저장된 메시지 그대로 표시)
        if (status === 'DANGER') {
            const logMsg = `[${time}] 🚨 ${message}`; // 서버가 준 시간과 메시지 사용
            
            setCctvDisplayLogs(prev => {
                if (prev[0] === logMsg) return prev; 
                return [logMsg, ...prev].slice(0, 50);
            });

            // 알람 해제 타이머
            if (alertTimers.current[targetId]) window.clearTimeout(alertTimers.current[targetId]);
            alertTimers.current[targetId] = window.setTimeout(() => {
                setDevices(curr => curr.map(d => d.id === targetId ? { ...d, status: 'IDLE' } : d));
            }, 10000);
        }
      } catch (e) {
        // 혹시 JSON이 아니라 평문이 오면 무시하거나 예전 방식으로 처리
        console.warn("Non-JSON message:", event.data);
      }
    };

    ws.onclose = () => {
      console.log("❌ Gateway Disconnected");
    };

    return () => { ws.close(); };
  }, []);

  // -------------------------------------------------------------
  // 🔥 [2] 로봇 제어 소켓 연결 (IP: 192.168.0.100)
  // -------------------------------------------------------------
  useEffect(() => {
    // config에 정의된 ROBOT_IP와 PORT_ROBOT(혹은 5001) 사용
    // 만약 로봇 파이썬 코드가 5001을 쓴다면 5001로 수정하세요. 여기선 5001로 가정.
    const robotUrl = `http://${NETWORK_CONFIG.ROBOT_IP}:5001`;
    
    console.log(`🤖 Connecting to Robot: ${robotUrl}`);
    robotSocketRef.current = io(robotUrl, { 
      transports: ['websocket'],
      reconnectionAttempts: 5
    });

    const handleRemoteControl = (e: KeyboardEvent, type: 'down' | 'up') => {
      if (!maximizedRobotRef.current || !robotSocketRef.current) return;
      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key) || key.includes('arrow')) {
        e.preventDefault();
        robotSocketRef.current.emit('direct_control', { command: key, type: type });
      }
    };

    const onKeyDown = (e: KeyboardEvent) => handleRemoteControl(e, 'down');
    const onKeyUp = (e: KeyboardEvent) => handleRemoteControl(e, 'up');

    window.addEventListener('mousemove', resizeLogs);
    window.addEventListener('mouseup', stopResizing);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    return () => { 
      window.removeEventListener('mousemove', resizeLogs); 
      window.removeEventListener('mouseup', stopResizing); 
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      robotSocketRef.current?.disconnect();
    };
  }, [resizeLogs, stopResizing]);

  // ... (이하 렌더링 코드는 동일, 단 이미지 주소만 변경) ...
  
  const handleSave = () => {
    const isCctv = targetType === 'CCTV' || newName.toLowerCase().includes('cctv');
    setDevices(prev => [...prev, { id: newName, name: newName, status: 'IDLE', type: isCctv ? 'CCTV' : 'ROBOT' }]);
    setOpen(false); setNewName('');
  };

  const DeviceCard = ({ dev, isMaximized, onMaximize }: { dev: Device, isMaximized: boolean, onMaximize: () => void }) => (
    <Card sx={{ 
      height: '100%', width: '100%',
      border: dev.status === 'DANGER' ? '4px solid #ff1744' : 'none',
      animation: dev.status === 'DANGER' ? `${flashRed} 1s infinite` : 'none',
      position: 'relative', borderRadius: isMaximized ? 0 : 2,
      overflow: 'hidden', bgcolor: '#000'
    }}>
      {/* ... (상단 헤더 동일) ... */}
      <Box sx={{ 
        position: 'absolute', top: 0, left: 0, right: 0, 
        p: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
        bgcolor: 'rgba(0,0,0,0.5)', zIndex: 10,
        opacity: isMaximized ? 0 : 1, '&:hover': { opacity: 1 }, transition: 'opacity 0.3s'
      }}>
        <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#fff' }}>
          {dev.name} {dev.status === 'DANGER' && "🚨"}
        </Typography>
        <Box>
          <IconButton size="small" onClick={onMaximize} sx={{ color: 'white' }}>
            {isMaximized ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
          {!isMaximized && (
            <IconButton size="small" onClick={() => setDevices(prev => prev.filter(d => d.id !== dev.id))} sx={{ color: '#ff5252' }}>
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      </Box>

      <Box sx={{ width: '100%', height: '100%', position: 'relative' }}>
        {/* 🔥 [이미지 주소 변경] ALGO_API_URL 사용 */}
        <img 
          src={`${NETWORK_CONFIG.ALGO_API_URL}/video_feed/${dev.id}`} 
          alt={dev.id}
          onError={(e) => { e.currentTarget.src = 'https://via.placeholder.com/640x480?text=NO+SIGNAL'; }}
          style={{ width: '100%', height: '100%', objectFit: isMaximized ? 'contain' : 'cover', display: 'block' }} 
        />
        {dev.status === 'DANGER' && (
          <Box sx={{ position: 'absolute', inset: 0, border: '6px solid rgba(255, 23, 68, 0.5)', pointerEvents: 'none' }} />
        )}
      </Box>

      {isMaximized && (
        <IconButton 
          onClick={onMaximize} 
          sx={{ position: 'absolute', top: 20, right: 20, bgcolor: 'rgba(0,0,0,0.6)', color: 'white', '&:hover': { bgcolor: 'rgba(0,0,0,0.9)' }, zIndex: 20 }}
        >
          <FullscreenExitIcon fontSize="large" />
        </IconButton>
      )}
    </Card>
  );

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* ... (이하 레이아웃 코드는 이전과 100% 동일하므로 생략) ... */}
        <AppBar position="static" sx={{ bgcolor: '#000', borderBottom: '1px solid #333' }} elevation={0}>
          <Toolbar variant="dense">
            <SecurityIcon sx={{ mr: 2, color: '#ff1744' }} />
            <Typography variant="h6" sx={{ fontSize: '1rem', fontWeight: 'bold', letterSpacing: 1 }}>
              LAB GUARDIAN <span style={{ color: '#90caf9' }}>CONTROL CENTER</span>
            </Typography>
          </Toolbar>
        </AppBar>

        <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
          <Box sx={{ width: '50%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #333' }}>
            {!maximizedCctv && (
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1, bgcolor: '#0c141d', borderBottom: '1px solid #333' }}>
                <Typography variant="overline" color="error" sx={{ fontWeight: 'bold' }}> • Static CCTV</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={() => { setTargetType('CCTV'); setOpen(true); }}>Add</Button>
              </Stack>
            )}
            <Box sx={{ flexGrow: 1, p: maximizedCctv ? 0 : 1 }}>
              <Grid container spacing={maximizedCctv ? 0 : 1} sx={{ height: '100%' }}>
                {devices.filter(d => d.type === 'CCTV').map((dev, idx) => {
                  if (maximizedCctv && maximizedCctv !== dev.id) return null;
                  return (
                    <Grid item xs={maximizedCctv ? 12 : 6} key={`${dev.id}-${idx}`} sx={{ height: maximizedCctv ? '100%' : '50%' }}>
                      <DeviceCard dev={dev} isMaximized={maximizedCctv === dev.id} onMaximize={() => setMaximizedCctv(maximizedCctv === dev.id ? null : dev.id)} />
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          </Box>

          <Box sx={{ width: '50%', display: 'flex', flexDirection: 'column' }}>
            {!maximizedRobot && (
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1, bgcolor: '#0c141d', borderBottom: '1px solid #333' }}>
                <Typography variant="overline" color="primary" sx={{ fontWeight: 'bold' }}> • Mobile Robot</Typography>
                <Button size="small" color="secondary" startIcon={<AddIcon />} onClick={() => { setTargetType('ROBOT'); setOpen(true); }}>Add</Button>
              </Stack>
            )}
            <Box sx={{ flexGrow: 1, p: maximizedRobot ? 0 : 1 }}>
              <Grid container spacing={maximizedRobot ? 0 : 1} sx={{ height: '100%' }}>
                {devices.filter(d => d.type === 'ROBOT').map((dev, idx) => {
                  if (maximizedRobot && maximizedRobot !== dev.id) return null;
                  return (
                    <Grid item xs={maximizedRobot ? 12 : 6} key={`${dev.id}-${idx}`} sx={{ height: maximizedRobot ? '100%' : '50%' }}>
                      <DeviceCard dev={dev} isMaximized={maximizedRobot === dev.id} onMaximize={() => setMaximizedRobot(maximizedRobot === dev.id ? null : dev.id)} />
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          </Box>
        </Box>

        <Box sx={{ height: `${logHeight}px`, position: 'relative', display: 'flex', borderTop: '2px solid #333', bgcolor: '#050505' }}>
          <Box onMouseDown={startResizing} sx={{ position: 'absolute', top: -5, left: 0, right: 0, height: '10px', cursor: 'row-resize', zIndex: 20, '&:hover': { bgcolor: 'primary.main', opacity: 0.5 } }} />
          <Paper sx={{ width: '50%', p: 1, bgcolor: 'transparent', borderRight: '1px solid #333', overflow: 'hidden' }} elevation={0}>
            <Typography variant="caption" color="error" sx={{ fontWeight: 'bold', display: 'block', mb: 1 }}>📡 SECURITY EVENTS (CCTV)</Typography>
            <List dense sx={{ height: 'calc(100% - 25px)', overflowY: 'auto', bgcolor: '#000', borderRadius: 1 }}>
              {cctvDisplayLogs.map((log, i) => (
                <ListItem key={i} sx={{ py: 0.5, borderBottom: '1px solid #222' }}>
                  <ListItemText primary={log} primaryTypographyProps={{ fontSize: '0.75rem', color: '#ff5252', fontFamily: 'monospace' }} />
                </ListItem>
              ))}
            </List>
          </Paper>
          <Paper sx={{ width: '50%', p: 1, bgcolor: 'transparent', overflow: 'hidden' }} elevation={0}>
            <Typography variant="caption" color="primary" sx={{ fontWeight: 'bold', display: 'block', mb: 1 }}>🤖 SYSTEM LOGS (ROBOT)</Typography>
            <List dense sx={{ height: 'calc(100% - 25px)', overflowY: 'auto', bgcolor: '#000', borderRadius: 1 }}>
              {robotDisplayLogs.map((log, i) => (
                <ListItem key={i} sx={{ py: 0.5, borderBottom: '1px solid #222' }}>
                  <ListItemText primary={log} primaryTypographyProps={{ fontSize: '0.75rem', color: '#64b5f6', fontFamily: 'monospace' }} />
                </ListItem>
              ))}
            </List>
          </Paper>
        </Box>
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle sx={{ fontSize: '1rem' }}>새 장치 등록</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth variant="filled" label="Device ID" value={newName} onChange={(e) => setNewName(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} color="inherit">취소</Button>
          <Button onClick={handleSave} variant="contained" color="primary">등록</Button>
        </DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

export default App;