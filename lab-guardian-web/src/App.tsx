import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from "socket.io-client"; 
import { NETWORK_CONFIG } from './common/config'; 
import { 
  AppBar, Toolbar, Typography, Paper, Button, Card, Stack, Box,
  List, ListItem, ListItemText, CssBaseline, keyframes,
  IconButton, TextField, Dialog, DialogTitle, DialogContent, DialogActions,
  Tooltip
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { createTheme, ThemeProvider } from '@mui/material/styles';
import SecurityIcon from '@mui/icons-material/Security';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import VideocamOffIcon from '@mui/icons-material/VideocamOff';
import DeleteSweepIcon from '@mui/icons-material/DeleteSweep'; // 클리어 아이콘 추가

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
  const [devices, setDevices] = useState<Device[]>([]);
  
  const [cctvDisplayLogs, setCctvDisplayLogs] = useState<string[]>([]);
  const [robotDisplayLogs, setRobotDisplayLogs] = useState<string[]>([]);
  const [logHeight, setLogHeight] = useState(200);
  const [maximizedCctv, setMaximizedCctv] = useState<string | null>(null);
  const [maximizedRobot, setMaximizedRobot] = useState<string | null>(null);
  const maximizedRobotRef = useRef<string | null>(null);

  const [open, setOpen] = useState(false);
  const [targetType, setTargetType] = useState<'CCTV' | 'ROBOT'>('CCTV');
  const [newName, setNewName] = useState('');
  
  const [videoErrors, setVideoErrors] = useState<Record<string, boolean>>({});
  
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
  // 🔥 [수정] 게이트웨이 웹소켓 연결 및 로그 분류 로직
  // -------------------------------------------------------------
  useEffect(() => {
    const wsUrl = `ws://${NETWORK_CONFIG.PC_IP}:8080`;
    const ws = new WebSocket(wsUrl);
    gatewaySocketRef.current = ws;

    ws.onopen = () => {
      setRobotDisplayLogs(prev => [`[System] 게이트웨이(${NETWORK_CONFIG.PC_IP}) 연결됨`, ...prev]);
    };

    ws.onmessage = (event) => {
      try {
        // 1. [디버깅] 들어오는 데이터 콘솔에 출력 (이걸로 데이터 오는지 확인!)
        console.log("📩 WS 수신:", event.data); 

        const data = JSON.parse(event.data);
        // C#에서 보낸 키값: status, message, time, camId, snapshot
        const { status, message, time, camId, snapshot } = data;
        
        const deviceId = camId || 'Unknown';
        const normalizedId = deviceId.toUpperCase();

        // 2. 상태 업데이트 (테두리 색상 변경용)
        setDevices(prev => {
           // 이미 등록된 장치인지 확인
           const exists = prev.find(d => d.id.toUpperCase() === normalizedId);
           if (exists) {
             return prev.map(d => {
               if (d.id.toUpperCase() === normalizedId && d.status !== status) {
                 return { ...d, status: status as DeviceStatus };
               }
               return d;
             });
           } else {
             // 없으면 새로 추가 (자동 등록 기능)
             const type = (normalizedId.includes('CCTV') || normalizedId.includes('WEBCAM')) ? 'CCTV' : 'ROBOT';
             return [...prev, { id: deviceId, name: deviceId, status: status as DeviceStatus, type }];
           }
        });

        // 3. 로그 메시지 구성
        let emoji = 'ℹ️';
        if (status === 'DANGER') emoji = '🚨';
        else if (status === 'SAFE') emoji = '✅';
        else if (status === 'CONNECTED') emoji = '🌐';
        else if (status === 'DISCONNECTED') emoji = '❌';

        // 로그 객체 생성 (단순 문자열 대신 객체로 관리하면 클릭 기능 넣기 좋음)
        // 여기선 기존 호환성을 위해 문자열에 특수코드를 섞거나 HTML을 쓸 수 없으니
        // 일단 텍스트로 표현하되, 스냅샷이 있으면 [📸 VIEW] 문구를 뒤에 붙임
        let displayMsg = `[${time}] ${emoji} ${message}`;
        
        // 스냅샷 경로는 별도 데이터로 유지하고, 로그 문구에는 포함하지 않음

        // 4. 로그 분류 및 저장
        const isStaticCctv = normalizedId.includes('CCTV') || normalizedId.includes('WEBCAM');

        if (isStaticCctv) {
          setCctvDisplayLogs(prev => [displayMsg, ...prev].slice(0, 50));
        } else {
          setRobotDisplayLogs(prev => [displayMsg, ...prev].slice(0, 50));
        }

        // 5. 알람 해제 타이머
        if (status === 'DANGER') {
            if (alertTimers.current[deviceId]) window.clearTimeout(alertTimers.current[deviceId]);
            alertTimers.current[deviceId] = window.setTimeout(() => {
                setDevices(curr => curr.map(d => d.id === deviceId ? { ...d, status: 'IDLE' } : d));
            }, 10000);
        }

      } catch (e) {
        console.error("❌ 로그 파싱 에러:", e);
      }
    };
    ws.onclose = () => {};
    return () => { ws.close(); };
  }, []);

  useEffect(() => {
    const robotUrl = `http://${NETWORK_CONFIG.ROBOT_IP}:5001`;
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

      <Box sx={{ width: '100%', height: '100%', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {videoErrors[dev.id] ? (
          <Stack alignItems="center" spacing={1}>
            <VideocamOffIcon sx={{ fontSize: 48, color: '#333' }} />
            <Typography variant="caption" color="grey.700">NO SIGNAL ({dev.id})</Typography>
          </Stack>
        ) : (
          <img 
            src={`${NETWORK_CONFIG.ALGO_API_URL}/video_feed/${dev.id}`} 
            alt={dev.id}
            onError={() => setVideoErrors(prev => ({ ...prev, [dev.id]: true }))}
            style={{ width: '100%', height: '100%', objectFit: isMaximized ? 'contain' : 'cover', display: 'block' }} 
          />
        )}
        
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

        {/* -------------------------------------------------------------
          🔥 [수정] 로그 창 레이아웃 및 클리어 버튼 추가
        ------------------------------------------------------------- */}
        <Box sx={{ height: `${logHeight}px`, position: 'relative', display: 'flex', borderTop: '2px solid #333', bgcolor: '#050505' }}>
          <Box onMouseDown={startResizing} sx={{ position: 'absolute', top: -5, left: 0, right: 0, height: '10px', cursor: 'row-resize', zIndex: 20, '&:hover': { bgcolor: 'primary.main', opacity: 0.5 } }} />
          
          {/* CCTV 로그 섹션 */}
          <Paper sx={{ width: '50%', p: 1, bgcolor: 'transparent', borderRight: '1px solid #333', overflow: 'hidden' }} elevation={0}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="error" sx={{ fontWeight: 'bold' }}>📡 SECURITY EVENTS (CCTV)</Typography>
              <Tooltip title="Clear CCTV Logs">
                <IconButton size="small" onClick={() => setCctvDisplayLogs([])} sx={{ color: '#ff5252', p: 0.5 }}>
                  <DeleteSweepIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
            <List dense sx={{ height: 'calc(100% - 32px)', overflowY: 'auto', bgcolor: '#000', borderRadius: 1 }}>
              {cctvDisplayLogs.map((log, i) => (
                <ListItem key={i} sx={{ py: 0.5, borderBottom: '1px solid #222' }}>
                  <ListItemText primary={log} primaryTypographyProps={{ fontSize: '0.75rem', color: '#ff5252', fontFamily: 'monospace' }} />
                </ListItem>
              ))}
            </List>
          </Paper>

          {/* 로봇 로그 섹션 */}
          <Paper sx={{ width: '50%', p: 1, bgcolor: 'transparent', overflow: 'hidden' }} elevation={0}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="caption" color="primary" sx={{ fontWeight: 'bold' }}>🤖 SYSTEM LOGS (ROBOT)</Typography>
              <Tooltip title="Clear Robot Logs">
                <IconButton size="small" onClick={() => setRobotDisplayLogs([])} sx={{ color: '#64b5f6', p: 0.5 }}>
                  <DeleteSweepIcon sx={{ fontSize: 18 }} />
                </IconButton>
              </Tooltip>
            </Box>
            <List dense sx={{ height: 'calc(100% - 32px)', overflowY: 'auto', bgcolor: '#000', borderRadius: 1 }}>
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
