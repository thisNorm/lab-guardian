import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import { NETWORK_CONFIG } from "./common/config";

type CamStatus = "online" | "offline";
type Quality = "FHD" | "HD" | "SD";
type EventType = "danger" | "safe" | "conn" | "disconn";
type Dir = "up" | "down" | "left" | "right" | "none";
type SourceType = "USB" | "RTSP";

interface CameraItem {
  id: string;
  name: string;
  status: CamStatus;
  quality: Quality;
  sourceType: SourceType;
  sourceLabel: string;
}

interface FolderNode {
  id: string;
  label: string;
  children: FolderNode[];
}

interface MapMarker {
  id: string;
  cameraId: string;
  x: number;
  y: number;
  angle: number;
}

interface TimelineEvent {
  id: string;
  cameraId: string;
  hour: number;
  type: EventType;
}

interface NewCameraForm {
  camId: string;
  sourceType: SourceType;
  displayName: string;
  usbDeviceName: string;
  rtspIp: string;
  rtspPort: string;
  rtspPath: string;
}

const ROOT_IP = NETWORK_CONFIG.PC_IP;
const QUALITY_OPTIONS: Quality[] = ["FHD", "HD", "SD"];

const INITIAL_NEW_CAMERA_FORM: NewCameraForm = {
  camId: "",
  sourceType: "USB",
  displayName: "",
  usbDeviceName: "",
  rtspIp: "",
  rtspPort: "554",
  rtspPath: "stream1",
};

const DEFAULT_CAMERAS: CameraItem[] = [
  {
    id: "CCTV_RealSense_999",
    name: "CCTV_RealSense_999",
    status: "online",
    quality: "HD",
    sourceType: "USB",
    sourceLabel: "USB/CCTV_RealSense_999",
  },
];

const EVENT_COLOR: Record<EventType, string> = {
  danger: "#ff5f6d",
  safe: "#38d39f",
  conn: "#59a7ff",
  disconn: "#f6c94a",
};

const MARKER_PRESETS = [
  { x: 30, y: 69, angle: 35 },
  { x: 52, y: 64, angle: -20 },
  { x: 64, y: 71, angle: 140 },
  { x: 24, y: 54, angle: 5 },
  { x: 70, y: 48, angle: 180 },
  { x: 42, y: 38, angle: 90 },
];

const INITIAL_TREE: FolderNode = {
  id: "root",
  label: `🏠 [${ROOT_IP}]`,
  children: [
    {
      id: "branch-01",
      label: "01. 방범",
      children: [],
    },
  ],
};

const FIXED_GRID_SIZE = 3;
const FIXED_GRID_LEN = FIXED_GRID_SIZE * FIXED_GRID_SIZE;

const findNodeById = (node: FolderNode, id: string): FolderNode | null => {
  if (node.id === id) return node;
  for (const child of node.children) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
};

const addChildFolder = (node: FolderNode, targetId: string, label: string): FolderNode => {
  if (node.id === targetId) {
    return {
      ...node,
      children: [...node.children, { id: `folder-${Date.now()}`, label, children: [] }],
    };
  }
  return {
    ...node,
    children: node.children.map((child) => addChildFolder(child, targetId, label)),
  };
};

const removeFolderNode = (node: FolderNode, targetId: string): FolderNode => {
  return {
    ...node,
    children: node.children
      .filter((child) => child.id !== targetId)
      .map((child) => removeFolderNode(child, targetId)),
  };
};

function App() {
  const [cameras, setCameras] = useState<CameraItem[]>(DEFAULT_CAMERAS);
  const [tree, setTree] = useState<FolderNode>(INITIAL_TREE);
  const [selectedTreeId, setSelectedTreeId] = useState<string>("branch-01");

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [addError, setAddError] = useState("");
  const [newCamera, setNewCamera] = useState<NewCameraForm>(INITIAL_NEW_CAMERA_FORM);

  const [gridAssignments, setGridAssignments] = useState<(string | null)[]>(() => {
    const base = Array.from({ length: FIXED_GRID_LEN }, () => null) as (string | null)[];
    if (DEFAULT_CAMERAS.length > 0) base[0] = DEFAULT_CAMERAS[0].id;
    return base;
  });

  const gridSize = FIXED_GRID_SIZE;

  const [markers, setMarkers] = useState<MapMarker[]>(() => {
    if (DEFAULT_CAMERAS.length === 0) return [];
    const preset = MARKER_PRESETS[0];
    return [{
      id: `m-${DEFAULT_CAMERAS[0].id}`,
      cameraId: DEFAULT_CAMERAS[0].id,
      x: preset.x,
      y: preset.y,
      angle: preset.angle,
    }];
  });
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(
    DEFAULT_CAMERAS[0] ? `m-${DEFAULT_CAMERAS[0].id}` : null
  );
  const [selectedMapCam, setSelectedMapCam] = useState<string>(DEFAULT_CAMERAS[0]?.id ?? "");

  const mapRef = useRef<HTMLDivElement | null>(null);
  const draggingMarkerRef = useRef<string | null>(null);

  const [singleViewCam, setSingleViewCam] = useState<string | null>(null);
  const [focusedCamId, setFocusedCamId] = useState<string | null>(DEFAULT_CAMERAS[0]?.id ?? null);

  const robotSocketRef = useRef<Socket | null>(null);
  const [robotConnected, setRobotConnected] = useState(false);
  const [moveSpeed, setMoveSpeed] = useState(3);
  const [camSpeed, setCamSpeed] = useState(3);

  const dragPayloadRef = useRef<{ cameraId: string; fromIndex: number | null } | null>(null);

  const moveJoyRef = useRef<HTMLDivElement | null>(null);
  const camJoyRef = useRef<HTMLDivElement | null>(null);
  const [moveKnob, setMoveKnob] = useState({ x: 0, y: 0 });
  const [camKnob, setCamKnob] = useState({ x: 0, y: 0 });
  const activeMoveDirRef = useRef<Dir>("none");
  const activeCamDirRef = useRef<Dir>("none");
  const keyboardMoveDirRef = useRef<Dir>("none");
  const keyboardCamDirRef = useRef<Dir>("none");

  const cameraMap = useMemo(() => new Map(cameras.map((c) => [c.id, c])), [cameras]);

  useEffect(() => {
    const socket = io(`http://${NETWORK_CONFIG.ROBOT_IP}:5001`, {
      transports: ["websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 2500,
    });

    socket.on("connect", () => setRobotConnected(true));
    socket.on("disconnect", () => setRobotConnected(false));
    socket.on("connect_error", () => setRobotConnected(false));

    robotSocketRef.current = socket;

    return () => {
      socket.disconnect();
      robotSocketRef.current = null;
    };
  }, []);

  const emitControl = (command: string, type: "down" | "up", speed: number) => {
    robotSocketRef.current?.emit("direct_control", { command, type, speed });
  };

  const knobFromDir = (dir: Dir) => {
    const offset = 30;
    if (dir === "up") return { x: 0, y: -offset };
    if (dir === "down") return { x: 0, y: offset };
    if (dir === "left") return { x: -offset, y: 0 };
    if (dir === "right") return { x: offset, y: 0 };
    return { x: 0, y: 0 };
  };

  const calcDirection = (x: number, y: number): Dir => {
    const ax = Math.abs(x);
    const ay = Math.abs(y);
    if (ax < 8 && ay < 8) return "none";
    if (ax >= ay) return x >= 0 ? "right" : "left";
    return y >= 0 ? "down" : "up";
  };

  const moveJoystick = (
    e: React.PointerEvent<HTMLDivElement>,
    root: HTMLDivElement,
    commandPrefix: "" | "cam_",
    speed: number,
    setKnob: (p: { x: number; y: number }) => void,
    activeDirRef: React.MutableRefObject<Dir>
  ) => {
    const box = root.getBoundingClientRect();
    const cx = box.left + box.width / 2;
    const cy = box.top + box.height / 2;
    const dx = e.clientX - cx;
    const dy = e.clientY - cy;

    const max = box.width * 0.28;
    const len = Math.hypot(dx, dy) || 1;
    const clamped = Math.min(max, len);
    const nx = (dx / len) * clamped;
    const ny = (dy / len) * clamped;

    setKnob({ x: nx, y: ny });

    const newDir = calcDirection(nx, ny);
    const prevDir = activeDirRef.current;

    if (newDir !== prevDir) {
      if (prevDir !== "none") emitControl(`${commandPrefix}${prevDir}`, "up", speed);
      if (newDir !== "none") emitControl(`${commandPrefix}${newDir}`, "down", speed);
      activeDirRef.current = newDir;
    }
  };

  const endJoystick = (
    commandPrefix: "" | "cam_",
    speed: number,
    setKnob: (p: { x: number; y: number }) => void,
    activeDirRef: React.MutableRefObject<Dir>
  ) => {
    const prev = activeDirRef.current;
    if (prev !== "none") emitControl(`${commandPrefix}${prev}`, "up", speed);
    activeDirRef.current = "none";
    setKnob({ x: 0, y: 0 });
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const moveMapping: Record<string, Dir> = {
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };
      const camMapping: Record<string, Dir> = {
        arrowup: "up",
        arrowdown: "down",
        arrowleft: "left",
        arrowright: "right",
      };

      const moveDir = moveMapping[key];
      if (moveDir) {
        e.preventDefault();
        const prevMove = keyboardMoveDirRef.current;
        if (prevMove !== moveDir) {
          if (prevMove !== "none") emitControl(prevMove, "up", moveSpeed);
          emitControl(moveDir, "down", moveSpeed);
          keyboardMoveDirRef.current = moveDir;
          setMoveKnob(knobFromDir(moveDir));
        }
        return;
      }

      const camDir = camMapping[key];
      if (camDir) {
        e.preventDefault();
        const prevCam = keyboardCamDirRef.current;
        if (prevCam !== camDir) {
          if (prevCam !== "none") emitControl(`cam_${prevCam}`, "up", camSpeed);
          emitControl(`cam_${camDir}`, "down", camSpeed);
          keyboardCamDirRef.current = camDir;
          setCamKnob(knobFromDir(camDir));
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      const moveMapping: Record<string, Dir> = {
        w: "up",
        s: "down",
        a: "left",
        d: "right",
      };
      const camMapping: Record<string, Dir> = {
        arrowup: "up",
        arrowdown: "down",
        arrowleft: "left",
        arrowright: "right",
      };

      const moveDir = moveMapping[key];
      if (moveDir) {
        e.preventDefault();
        if (keyboardMoveDirRef.current === moveDir) {
          emitControl(moveDir, "up", moveSpeed);
          keyboardMoveDirRef.current = "none";
          setMoveKnob({ x: 0, y: 0 });
        }
        return;
      }

      const camDir = camMapping[key];
      if (camDir) {
        e.preventDefault();
        if (keyboardCamDirRef.current === camDir) {
          emitControl(`cam_${camDir}`, "up", camSpeed);
          keyboardCamDirRef.current = "none";
          setCamKnob({ x: 0, y: 0 });
        }
      }
    };

    const onBlur = () => {
      const currentMove = keyboardMoveDirRef.current;
      if (currentMove !== "none") {
        emitControl(currentMove, "up", moveSpeed);
        keyboardMoveDirRef.current = "none";
        setMoveKnob({ x: 0, y: 0 });
      }
      const currentCam = keyboardCamDirRef.current;
      if (currentCam !== "none") {
        emitControl(`cam_${currentCam}`, "up", camSpeed);
        keyboardCamDirRef.current = "none";
        setCamKnob({ x: 0, y: 0 });
      }
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [camSpeed, moveSpeed]);

  const onDropToCell = (toIndex: number) => {
    const payload = dragPayloadRef.current;
    if (!payload) return;

    setGridAssignments((prev) => {
      const next = [...prev];
      const { cameraId, fromIndex } = payload;

      const existingIdx = next.findIndex((x) => x === cameraId);
      if (existingIdx >= 0) next[existingIdx] = null;

      if (fromIndex !== null && fromIndex >= 0 && fromIndex < next.length) {
        const target = next[toIndex];
        next[toIndex] = cameraId;
        if (target && target !== cameraId) next[fromIndex] = target;
      } else {
        next[toIndex] = cameraId;
      }

      return next;
    });

    dragPayloadRef.current = null;
  };

  const toMapCoord = (clientX: number, clientY: number) => {
    const box = mapRef.current?.getBoundingClientRect();
    if (!box) return { x: 50, y: 50 };

    const localX = clientX - box.left;
    const localY = clientY - box.top;

    return {
      x: Math.min(98, Math.max(2, (localX / box.width) * 100)),
      y: Math.min(98, Math.max(2, (localY / box.height) * 100)),
    };
  };

  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.marker === "1") return;
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!draggingMarkerRef.current) return;
      const p = toMapCoord(e.clientX, e.clientY);
      setMarkers((prev) => prev.map((m) => (
        m.id === draggingMarkerRef.current ? { ...m, x: p.x, y: p.y } : m
      )));
    };

    const onUp = () => {
      draggingMarkerRef.current = null;
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);

    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const openAddCameraModal = () => {
    const nextNum = cameras.length + 1;
    const suggestedId = `CCTV_${String(nextNum).padStart(2, "0")}`;
    setShowAddModal(true);
    setAddError("");
    setNewCamera({ ...INITIAL_NEW_CAMERA_FORM, camId: suggestedId });
  };

  const closeAddCameraModal = () => {
    setShowAddModal(false);
    setAddError("");
  };

  const addCamera = async () => {
    const sourceType = newCamera.sourceType;
    const camId = newCamera.camId.trim();
    const displayName = newCamera.displayName.trim();
    const usbDeviceName = newCamera.usbDeviceName.trim();
    const rtspIp = newCamera.rtspIp.trim();
    const rtspPort = (newCamera.rtspPort.trim() || "554").replace(/[^\d]/g, "");
    const rtspPath = newCamera.rtspPath.trim() || "stream1";

    if (!camId) {
      setAddError("카메라 ID를 입력하세요. (예: CCTV_RealSense_999)");
      return;
    }
    if (cameras.some((c) => c.id === camId)) {
      setAddError("이미 등록된 카메라 ID입니다.");
      return;
    }
    if (sourceType === "RTSP" && !rtspIp) {
      setAddError("RTSP IP 주소를 입력하세요.");
      return;
    }

    if (sourceType === "RTSP") {
      try {
        const response = await fetch(`${NETWORK_CONFIG.ALGO_API_URL}/cameras/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cam_id: camId,
            ip: rtspIp,
            port: Number(rtspPort || "554"),
            path: rtspPath,
            stream: "sub",
            transport: "auto",
            username: "",
            password: "",
          }),
        });
        if (!response.ok) {
          const message = await response.text();
          setAddError(`RTSP 등록 실패: ${message || response.status}`);
          return;
        }
      } catch (error) {
        setAddError(`RTSP 등록 실패: ${String(error)}`);
        return;
      }
    }

    const nextNum = cameras.length + 1;
    const id = camId;
    const preset = MARKER_PRESETS[(nextNum - 1) % MARKER_PRESETS.length];
    const fallbackName = `신규 CCTV ${String(nextNum).padStart(2, "0")}`;

    const cameraName = sourceType === "USB"
      ? (displayName || camId || usbDeviceName || fallbackName)
      : (displayName || `RTSP ${rtspIp}`);

    const sourceLabel = sourceType === "USB"
      ? `USB/${usbDeviceName || camId}`
      : `RTSP/rtsp://${rtspIp}:${rtspPort}/${rtspPath}`;

    const newCam: CameraItem = {
      id,
      name: cameraName,
      status: "online",
      quality: "HD",
      sourceType,
      sourceLabel,
    };

    setCameras((prev) => [...prev, newCam]);
    setSelectedMapCam(id);
    setFocusedCamId(id);
    setSelectedMarkerId(`m-${id}`);

    setMarkers((prev) => [
      ...prev,
      {
        id: `m-${id}`,
        cameraId: id,
        x: preset.x,
        y: preset.y,
        angle: preset.angle,
      },
    ]);

    const hour = new Date().getHours();
    setTimelineEvents((prev) => [
      { id: `ev-${Date.now()}`, cameraId: id, hour, type: "conn" },
      ...prev,
    ]);

    setGridAssignments((prev) => {
      const firstEmpty = prev.findIndex((x) => x === null);
      if (firstEmpty >= 0) {
        const next = [...prev];
        next[firstEmpty] = id;
        return next;
      }
      return prev;
    });

    closeAddCameraModal();
  };

  const rotateSelectedMarker = (delta: number) => {
    if (!selectedMarkerId) return;
    setMarkers((prev) => prev.map((m) => (
      m.id === selectedMarkerId ? { ...m, angle: m.angle + delta } : m
    )));
  };

  const addFolderByNode = (targetId: string) => {
    const base = findNodeById(tree, targetId);
    if (!base) return;
    const name = window.prompt("새 폴더 이름을 입력하세요");
    if (!name) return;
    setTree((prev) => addChildFolder(prev, targetId, name.trim()));
  };

  const removeFolderByNode = (targetId: string) => {
    if (targetId === "root" || targetId === "branch-01") return;
    setTree((prev) => removeFolderNode(prev, targetId));
    if (selectedTreeId === targetId) setSelectedTreeId("branch-01");
  };

  const renderTree = (node: FolderNode) => {
    return (
      <li key={node.id}>
        <div className={`tree-row ${selectedTreeId === node.id ? "active" : ""}`}>
          <button type="button" className="tree-label" onClick={() => setSelectedTreeId(node.id)}>
            <span className="folder-icon">📁</span>
            <span>{node.label}</span>
          </button>
          <div className="tree-actions">
            <button type="button" onClick={() => addFolderByNode(node.id)}>+</button>
            <button
              type="button"
              onClick={() => removeFolderByNode(node.id)}
              disabled={node.id === "root" || node.id === "branch-01"}
            >
              -
            </button>
          </div>
        </div>
        {node.children.length > 0 && (
          <ul className="tree-list">
            {node.children.map((child) => renderTree(child))}
          </ul>
        )}
      </li>
    );
  };

  const renderJoystick = (
    title: string,
    commandPrefix: "" | "cam_",
    speed: number,
    setSpeed: (v: number) => void,
    joyRef: React.RefObject<HTMLDivElement | null>,
    knob: { x: number; y: number },
    setKnob: (p: { x: number; y: number }) => void,
    activeDirRef: React.MutableRefObject<Dir>
  ) => {
    return (
      <div className="joystick-card">
        <div className="joystick-title">{title}</div>
        <div
          ref={joyRef}
          className="joystick-pad"
          onPointerDown={(e) => {
            const root = joyRef.current;
            if (!root) return;
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            moveJoystick(e, root, commandPrefix, speed, setKnob, activeDirRef);
          }}
          onPointerMove={(e) => {
            const root = joyRef.current;
            if (!root || !(e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
            moveJoystick(e, root, commandPrefix, speed, setKnob, activeDirRef);
          }}
          onPointerUp={() => endJoystick(commandPrefix, speed, setKnob, activeDirRef)}
          onPointerCancel={() => endJoystick(commandPrefix, speed, setKnob, activeDirRef)}
          onPointerLeave={(e) => {
            if ((e.currentTarget as HTMLDivElement).hasPointerCapture(e.pointerId)) return;
            endJoystick(commandPrefix, speed, setKnob, activeDirRef);
          }}
        >
          <div className="pad-cross" />
          <div className="pad-ring" />
          <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
        </div>
        <div className="speed-row">
          <label>속도</label>
          <input
            type="range"
            min={1}
            max={8}
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
          />
          <span>{speed}</span>
        </div>
      </div>
    );
  };

  return (
    <div className="monitor-root">
      <header className="monitor-header">
        <div className="title">통합 관제 GUI (서비스 트리 / 맵 / 멀티뷰)</div>
        <div className={`socket-badge ${robotConnected ? "on" : "off"}`}>
          {robotConnected ? "로봇 연결됨" : "로봇 연결 끊김"}
        </div>
      </header>

      <div className="monitor-body">
        <aside className="left-panel">
          <section className="tree-panel">
            <div className="panel-head">서비스 트리</div>
            <ul className="tree-list root">{renderTree(tree)}</ul>
          </section>

          <section className="controller-panel">
            {renderJoystick("로봇 이동 조이스틱", "", moveSpeed, setMoveSpeed, moveJoyRef, moveKnob, setMoveKnob, activeMoveDirRef)}
            {renderJoystick("카메라 조이스틱", "cam_", camSpeed, setCamSpeed, camJoyRef, camKnob, setCamKnob, activeCamDirRef)}
          </section>
        </aside>

        <main className="center-panel">
          <section className="source-panel">
            <div className="panel-head row">
              <span>화면 소스</span>
              <button type="button" className="add-cam-btn" onClick={openAddCameraModal}>+ CCTV 추가</button>
            </div>
            <div className="source-list">
              {cameras.length === 0 && <div className="source-empty">등록된 CCTV가 없습니다. 추가 후 사용하세요.</div>}
              {cameras.map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  className={`source-item ${focusedCamId === cam.id ? "focus" : ""}`}
                  draggable
                  onDragStart={() => {
                    dragPayloadRef.current = { cameraId: cam.id, fromIndex: null };
                  }}
                  onClick={() => setFocusedCamId(cam.id)}
                >
                  <span className={`status-dot ${cam.status}`} />
                  <span className="source-name">{cam.name}</span>
                  <span className="source-id">{cam.sourceType}</span>
                  <span className="source-source">{cam.sourceLabel}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="grid-panel">
            <div className="panel-head row">
              <span>멀티뷰 ({gridSize}x{gridSize})</span>
              <span className="tip">드래그해서 화면 배치 · 연결 없는 화면은 검정</span>
            </div>
            <div className="camera-grid" style={{ gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))` }}>
              {gridAssignments.map((camId, idx) => {
                const cam = camId ? cameraMap.get(camId) ?? null : null;
                return (
                  <div
                    key={`cell-${idx}`}
                    className={`camera-cell ${cam?.id === focusedCamId ? "focus" : ""}`}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => onDropToCell(idx)}
                    draggable={!!cam}
                    onDragStart={() => {
                      if (!cam) return;
                      dragPayloadRef.current = { cameraId: cam.id, fromIndex: idx };
                    }}
                  >
                    {!cam && <div className="cell-empty">NO SIGNAL</div>}
                    {cam && (
                      <>
                        <div className="cell-top">
                          <div className="left-meta">
                            <span className={`status-dot ${cam.status}`} />
                            <input
                              value={cam.name}
                              onChange={(e) => {
                                const value = e.target.value;
                                setCameras((prev) => prev.map((p) => (
                                  p.id === cam.id ? { ...p, name: value } : p
                                )));
                              }}
                            />
                          </div>
                          <select
                            value={cam.quality}
                            onChange={(e) => {
                              const value = e.target.value as Quality;
                              setCameras((prev) => prev.map((p) => (
                                p.id === cam.id ? { ...p, quality: value } : p
                              )));
                            }}
                          >
                            {QUALITY_OPTIONS.map((q) => (
                              <option key={`${cam.id}-${q}`} value={q}>{q}</option>
                            ))}
                          </select>
                        </div>

                        <button type="button" className="stream-btn" onClick={() => setSingleViewCam(cam.id)}>
                          <img
                            src={`${NETWORK_CONFIG.ALGO_API_URL}/video_feed/${cam.id}`}
                            alt={cam.id}
                            onError={(e) => {
                              e.currentTarget.style.display = "none";
                            }}
                          />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          <section className="timeline-panel">
            <div className="panel-head">타임라인 로그 (선형)</div>
            <div className="timeline-scale">
              {Array.from({ length: 25 }, (_, i) => (
                <div key={`tick-${i}`} className="tick" style={{ left: `${(i / 24) * 100}%` }}>
                  <span>{i}</span>
                </div>
              ))}
            </div>
            <div className="timeline-rows">
              {cameras.map((cam) => {
                const events = timelineEvents.filter((e) => e.cameraId === cam.id);
                return (
                  <div key={`line-${cam.id}`} className="timeline-row-line">
                    <div className="cam-name">{cam.name}</div>
                    <div className="line-track">
                      <div className="base-line" />
                      {events.map((event) => (
                        <div
                          key={event.id}
                          className="event-dot"
                          style={{
                            left: `${(event.hour / 24) * 100}%`,
                            backgroundColor: EVENT_COLOR[event.type],
                          }}
                          title={`${event.type.toUpperCase()} / ${event.hour}시`}
                        />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        </main>

        <aside className="right-panel">
          <section className="map-panel">
            <div className="panel-head row">
              <span>맵 (CCTV 배치)</span>
              <div className="map-tools">
                <select
                  value={selectedMapCam}
                  onChange={(e) => setSelectedMapCam(e.target.value)}
                  disabled={cameras.length === 0}
                >
                  {cameras.length === 0 && <option value="">카메라 없음</option>}
                  {cameras.map((cam) => (
                    <option key={`map-${cam.id}`} value={cam.id}>{cam.name}</option>
                  ))}
                </select>
                <button type="button" onClick={() => rotateSelectedMarker(-10)}>↺</button>
                <button type="button" onClick={() => rotateSelectedMarker(10)}>↻</button>
              </div>
            </div>

            <div
              ref={mapRef}
              className="map-canvas"
              onClick={handleMapClick}
            >
              <div className="map-world">
                <div className="map-layout">
                  <div className="wall wall-left-top" />
                  <div className="wall wall-top-right" />
                  <div className="wall wall-center-vertical" />
                  <div className="wall wall-right-mid-small-1" />
                  <div className="wall wall-right-mid-small-2" />
                  <div className="wall wall-right-bottom-vertical" />
                  <div className="wall wall-center-bottom-box" />
                  <div className="wall wall-bottom-left-h" />
                  <div className="wall wall-bottom-center-h" />
                  <div className="wall wall-bottom-right-h" />
                  <div className="door-arc" />
                </div>
                {markers.map((marker) => {
                  const isSelected = marker.id === selectedMarkerId;
                  return (
                    <div
                      key={marker.id}
                      data-marker="1"
                      className={`marker-wrap ${isSelected ? "selected" : ""}`}
                      style={{ left: `${marker.x}%`, top: `${marker.y}%` }}
                    >
                      <div data-marker="1" className="marker-rotate-group" style={{ transform: `rotate(${marker.angle}deg)` }}>
                        <div data-marker="1" className="fov-cone" />
                        <button
                          data-marker="1"
                          type="button"
                          className="camera-marker"
                          onMouseDown={() => {
                            draggingMarkerRef.current = marker.id;
                          }}
                          onClick={() => {
                            setSelectedMarkerId(marker.id);
                            setFocusedCamId(marker.cameraId);
                          }}
                          onDoubleClick={() => setSingleViewCam(marker.cameraId)}
                        >
                          📹
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          <section className="map-info-panel">
            <div className="panel-head">선택 CCTV</div>
            <div className="map-info-content">
              {!focusedCamId && <div className="muted">선택된 CCTV가 없습니다.</div>}
              {focusedCamId && (
                <>
                  <div><strong>ID:</strong> {focusedCamId}</div>
                  <div><strong>이름:</strong> {cameraMap.get(focusedCamId)?.name}</div>
                  <div><strong>상태:</strong> {cameraMap.get(focusedCamId)?.status === "online" ? "정상" : "끊김"}</div>
                  <button type="button" onClick={() => setSingleViewCam(focusedCamId)}>단일 화면 열기</button>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>

      {showAddModal && (
        <div className="add-modal-overlay" onClick={closeAddCameraModal}>
          <div className="add-modal" onClick={(e) => e.stopPropagation()}>
            <div className="add-modal-head">
              <h3>CCTV 연결 추가</h3>
              <button type="button" onClick={closeAddCameraModal}>닫기</button>
            </div>

            <div className="add-modal-body">
              <label className="add-modal-field">
                <span>카메라 ID *</span>
                <input
                  value={newCamera.camId}
                  onChange={(e) => {
                    const value = e.target.value;
                    setAddError("");
                    setNewCamera((prev) => ({ ...prev, camId: value }));
                  }}
                  placeholder="예: CCTV_RealSense_999"
                />
              </label>

              <div className="add-source-type">
                <label>
                  <input
                    type="radio"
                    checked={newCamera.sourceType === "USB"}
                    onChange={() => {
                      setAddError("");
                      setNewCamera((prev) => ({ ...prev, sourceType: "USB" }));
                    }}
                  />
                  USB 카메라
                </label>
                <label>
                  <input
                    type="radio"
                    checked={newCamera.sourceType === "RTSP"}
                    onChange={() => {
                      setAddError("");
                      setNewCamera((prev) => ({ ...prev, sourceType: "RTSP" }));
                    }}
                  />
                  RTSP 스트림
                </label>
              </div>

              <label className="add-modal-field">
                <span>표시 이름 (선택)</span>
                <input
                  value={newCamera.displayName}
                  onChange={(e) => {
                    const value = e.target.value;
                    setNewCamera((prev) => ({ ...prev, displayName: value }));
                  }}
                  placeholder="예: 고등-정문-01"
                />
              </label>

              {newCamera.sourceType === "USB" && (
                <label className="add-modal-field">
                  <span>USB 장치명 (선택)</span>
                  <input
                    value={newCamera.usbDeviceName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAddError("");
                      setNewCamera((prev) => ({ ...prev, usbDeviceName: value }));
                    }}
                    placeholder="예: USB_CAM_01"
                  />
                </label>
              )}

              {newCamera.sourceType === "RTSP" && (
                <div className="add-modal-grid-2">
                  <label className="add-modal-field">
                    <span>RTSP IP 주소 *</span>
                    <input
                      value={newCamera.rtspIp}
                      onChange={(e) => {
                        const value = e.target.value;
                        setAddError("");
                        setNewCamera((prev) => ({ ...prev, rtspIp: value }));
                      }}
                      placeholder="예: 192.168.0.120"
                    />
                  </label>

                  <label className="add-modal-field">
                    <span>포트</span>
                    <input
                      value={newCamera.rtspPort}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewCamera((prev) => ({ ...prev, rtspPort: value }));
                      }}
                      placeholder="554"
                    />
                  </label>

                  <label className="add-modal-field add-modal-grid-span-2">
                    <span>경로</span>
                    <input
                      value={newCamera.rtspPath}
                      onChange={(e) => {
                        const value = e.target.value;
                        setNewCamera((prev) => ({ ...prev, rtspPath: value }));
                      }}
                      placeholder="stream1"
                    />
                  </label>
                </div>
              )}

              {addError && <div className="add-modal-error">{addError}</div>}
            </div>

            <div className="add-modal-foot">
              <button type="button" className="ghost" onClick={closeAddCameraModal}>취소</button>
              <button type="button" className="primary" onClick={addCamera}>연결 추가</button>
            </div>
          </div>
        </div>
      )}

      {singleViewCam && (
        <div className="single-view-overlay">
          <div className="single-head">
            <div>{cameraMap.get(singleViewCam)?.name ?? singleViewCam}</div>
            <button type="button" onClick={() => setSingleViewCam(null)}>닫기</button>
          </div>
          <div className="single-body">
            <img
              src={`${NETWORK_CONFIG.ALGO_API_URL}/video_feed/${singleViewCam}`}
              alt={singleViewCam}
              onError={(e) => {
                e.currentTarget.style.display = "none";
              }}
            />
            <div className="single-fallback">NO SIGNAL</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

