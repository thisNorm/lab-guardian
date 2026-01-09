import { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from "socket.io-client";
import { NETWORK_CONFIG } from './common/config';
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

const darkTheme = createTheme({ palette: { mode: 'dark', background: { default: '#050a10', paper: '#0c141d' } } });

type DeviceStatus = 'IDLE' | 'PATROL' | 'DANGER';
interface Device { id: string; name: string; status: DeviceStatus; type: 'CCTV' | 'ROBOT'; }

function App() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [cctvDisplayLogs, setCctvDisplayLogs] = useState<string[]>([]);
  const [robotDisplayLogs, setRobotDisplayLogs] = useState<string[]>([]);
  const [logHeight, setLogHeight] = useState(200);
  const isResizing = useRef(false);
  
  const [maximizedCctv, setMaximizedCctv] = useState<string | null>(null);
  const [maximizedRobot, setMaximizedRobot] = useState<string | null>(null);

  const [open, setOpen] = useState(false);
  const [targetType, setTargetType] = useState<'CCTV' | 'ROBOT'>('CCTV');
  const [newName, setNewName] = useState('');
  const socketRef = useRef<Socket | null>(null);
  const alertTimers = useRef<{ [key: string]: NodeJS.Timeout }>({});

  const startResizing = useCallback(() => { isResizing.current = true; document.body.style.cursor = 'row-resize'; }, []);
  const stopResizing = useCallback(() => { isResizing.current = false; document.body.style.cursor = 'default'; }, []);
  const resizeLogs = useCallback((e: MouseEvent) => {
    if (!isResizing.current) return;
    const newHeight = window.innerHeight - e.clientY;
    if (newHeight > 80 && newHeight < window.innerHeight * 0.8) setLogHeight(newHeight);
  }, []);

  useEffect(() => {
    window.addEventListener('mousemove', resizeLogs);
    window.addEventListener('mouseup', stopResizing);
    socketRef.current = io(`${NETWORK_CONFIG.NEST_API_URL}/monitoring`, { transports: ['websocket'] });
    
    socketRef.current.on('alarm_event', (data: { cam_id: string; message: string }) => {
      setDevices((prev: Device[]) => {
        const updated = prev.map(d => d.id === data.cam_id ? { ...d, status: 'DANGER' as DeviceStatus } : d);
        const target = updated.find(d => d.id === data.cam_id);
        if (target) {
          const time = new Date().toLocaleTimeString();
          const log = `[${time}] 🚨 ${data.message}`;
          if (target.type === 'CCTV') setCctvDisplayLogs(p => [log, ...p].slice(0, 50));
          else setRobotDisplayLogs(p => [log, ...p].slice(0, 50));

          if (alertTimers.current[data.cam_id]) clearTimeout(alertTimers.current[data.cam_id]);
          alertTimers.current[data.cam_id] = setTimeout(() => {
            setDevices(curr => curr.map(d => d.id === data.cam_id ? { ...d, status: 'IDLE' as DeviceStatus } : d));
          }, 10000);
        }
        return updated;
      });
    });

    return () => { 
      window.removeEventListener('mousemove', resizeLogs); 
      window.removeEventListener('mouseup', stopResizing); 
      socketRef.current?.disconnect();
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
      {/* 🛠️ 컨트롤 오버레이 */}
      <Box sx={{ 
        position: 'absolute', top: 0, left: 0, right: 0, 
        p: '4px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', 
        bgcolor: 'rgba(0,0,0,0.3)', zIndex: 10,
        opacity: isMaximized ? 0 : 1, '&:hover': { opacity: 1 }, transition: 'opacity 0.3s'
      }}>
        <Typography variant="caption" sx={{ fontWeight: 'bold', color: '#fff' }}>{dev.name}</Typography>
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

      {/* 📺 영상 본체: cover 속성을 사용하여 여백 없이 꽉 채움 */}
      <Box sx={{ width: '100%', height: '100%' }}>
        <img 
          src={`${NETWORK_CONFIG.ALGO_API_URL}/video_feed/${dev.id}`} 
          style={{ 
            width: '100%', 
            height: '100%', 
            // 💡 핵심: cover를 사용하여 빈틈없이 채우되, 찌그러지지 않게 함
            objectFit: isMaximized ? 'cover' : 'contain', 
            display: 'block'
          }} 
        />
        {dev.status === 'DANGER' && (
          <Box sx={{ position: 'absolute', inset: 0, border: '6px solid rgba(255, 23, 68, 0.5)', pointerEvents: 'none' }} />
        )}
      </Box>

      {isMaximized && (
        <IconButton 
          onClick={onMaximize} 
          sx={{ position: 'absolute', top: 10, right: 10, bgcolor: 'rgba(0,0,0,0.4)', color: 'white', '&:hover': { bgcolor: 'rgba(0,0,0,0.8)' }, zIndex: 11 }}
        >
          <FullscreenExitIcon />
        </IconButton>
      )}
    </Card>
  );

  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <AppBar position="static" sx={{ bgcolor: '#000' }} elevation={0}>
          <Toolbar variant="dense">
            <SecurityIcon sx={{ mr: 2, color: '#90caf9' }} />
            <Typography variant="h6" sx={{ fontSize: '0.9rem', fontWeight: 'bold' }}>LAB GUARDIAN HUB</Typography>
          </Toolbar>
        </AppBar>

        <Box sx={{ flexGrow: 1, display: 'flex', overflow: 'hidden' }}>
          {/* CCTV 구역 */}
          <Box sx={{ width: '50%', display: 'flex', flexDirection: 'column', borderRight: '1px solid #444' }}>
            {!maximizedCctv && (
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1, bgcolor: '#0c141d' }}>
                <Typography variant="overline" color="primary" sx={{ fontWeight: 'bold' }}>Static CCTV</Typography>
                <Button size="small" startIcon={<AddIcon />} onClick={() => { setTargetType('CCTV'); setOpen(true); }}>Add</Button>
              </Stack>
            )}
            <Box sx={{ flexGrow: 1, p: maximizedCctv ? 0 : 1.5 }}>
              <Grid container spacing={maximizedCctv ? 0 : 1.5} sx={{ height: '100%' }}>
                {devices.filter(d => d.type === 'CCTV').map(dev => {
                  if (maximizedCctv && maximizedCctv !== dev.id) return null;
                  return (
                    <Grid item xs={maximizedCctv ? 12 : 6} key={dev.id} sx={{ height: maximizedCctv ? '100%' : '240px' }}>
                      <DeviceCard dev={dev} isMaximized={maximizedCctv === dev.id} onMaximize={() => setMaximizedCctv(maximizedCctv === dev.id ? null : dev.id)} />
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          </Box>

          {/* 로봇 구역 */}
          <Box sx={{ width: '50%', display: 'flex', flexDirection: 'column' }}>
            {!maximizedRobot && (
              <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ p: 1, bgcolor: '#0c141d' }}>
                <Typography variant="overline" color="secondary" sx={{ fontWeight: 'bold' }}>Mobile Robot</Typography>
                <Button size="small" color="secondary" startIcon={<AddIcon />} onClick={() => { setTargetType('ROBOT'); setOpen(true); }}>Add</Button>
              </Stack>
            )}
            <Box sx={{ flexGrow: 1, p: maximizedRobot ? 0 : 1.5 }}>
              <Grid container spacing={maximizedRobot ? 0 : 1.5} sx={{ height: '100%' }}>
                {devices.filter(d => d.type === 'ROBOT').map(dev => {
                  if (maximizedRobot && maximizedRobot !== dev.id) return null;
                  return (
                    <Grid item xs={maximizedRobot ? 12 : 6} key={dev.id} sx={{ height: maximizedRobot ? '100%' : '240px' }}>
                      <DeviceCard dev={dev} isMaximized={maximizedRobot === dev.id} onMaximize={() => setMaximizedRobot(maximizedRobot === dev.id ? null : dev.id)} />
                    </Grid>
                  );
                })}
              </Grid>
            </Box>
          </Box>
        </Box>

        {/* 하단 로그 */}
        <Box sx={{ height: `${logHeight}px`, position: 'relative', display: 'flex', borderTop: '2px solid #444', bgcolor: '#050505' }}>
          <Box onMouseDown={startResizing} sx={{ position: 'absolute', top: -5, left: 0, right: 0, height: '10px', cursor: 'row-resize', zIndex: 20 }} />
          <Paper sx={{ width: '50%', p: 1.5, bgcolor: 'transparent', borderRight: '1px solid #333', overflow: 'hidden' }} elevation={0}>
            <Typography variant="caption" color="error" sx={{ fontWeight: 'bold' }}>CCTV SECURITY LOGS</Typography>
            <List dense sx={{ height: 'calc(100% - 25px)', overflowY: 'auto', mt: 1 }}>
              {cctvDisplayLogs.map((log, i) => <ListItem key={i} sx={{ py: 0 }}><ListItemText primary={log} primaryTypographyProps={{ fontSize: '0.7rem', color: '#ff1744', fontFamily: 'monospace' }} /></ListItem>)}
            </List>
          </Paper>
          <Paper sx={{ width: '50%', p: 1.5, bgcolor: 'transparent', overflow: 'hidden' }} elevation={0}>
            <Typography variant="caption" color="primary" sx={{ fontWeight: 'bold' }}>ROBOT OPERATION LOGS</Typography>
            <List dense sx={{ height: 'calc(100% - 25px)', overflowY: 'auto', mt: 1 }}>
              {robotDisplayLogs.map((log, i) => <ListItem key={i} sx={{ py: 0 }}><ListItemText primary={log} primaryTypographyProps={{ fontSize: '0.7rem', color: '#90caf9', fontFamily: 'monospace' }} /></ListItem>)}
            </List>
          </Paper>
        </Box>
      </Box>

      <Dialog open={open} onClose={() => setOpen(false)}>
        <DialogTitle sx={{ fontSize: '1rem' }}>장치 등록</DialogTitle>
        <DialogContent><TextField autoFocus fullWidth variant="standard" label="ID 입력" value={newName} onChange={(e) => setNewName(e.target.value)} /></DialogContent>
        <DialogActions><Button onClick={() => setOpen(false)}>취소</Button><Button onClick={handleSave} variant="contained">저장</Button></DialogActions>
      </Dialog>
    </ThemeProvider>
  );
}

export default App;