import { useEffect, useMemo, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import "./App.css";
import { NETWORK_CONFIG } from "./common/config";

type CamStatus = "online" | "offline";
type Quality = "FHD" | "HD" | "SD";
type EventType = "danger" | "safe" | "conn" | "disconn" | "manual_on" | "manual_off";
type Dir = "up" | "down" | "left" | "right" | "none";
type SourceType = "USB" | "RTSP";
type AddTargetType = "robot" | "cctv";

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
  minute?: number;
  type: EventType;
  ts?: number;
}
interface TimelineClusterSelection {
  cameraId: string;
  startMinuteOfDay: number;
  endMinuteOfDay: number;
  events: TimelineEvent[];
}

interface GatewayRealtimePayload {
  status?: string;
  camId?: string;
  message?: string;
  time?: string;
  snapshot?: string | null;
}

interface GatewayRecentLogItem {
  id: number | string;
  camId?: string;
  createdAt?: string;
  cctvLog?: string | null;
  robotLog?: string | null;
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

const isRobotDevice = (cam?: CameraItem | null) =>
  !!cam && (
    cam.id.toUpperCase().includes("ROBOT") ||
    cam.name.toUpperCase().includes("ROBOT") ||
    cam.sourceLabel.toUpperCase().includes("ROBOT")
  );

const ROOT_IP = NETWORK_CONFIG.PC_IP;
const QUALITY_OPTIONS: Quality[] = ["FHD", "HD", "SD"];
const FIXED_GRID_SIZE = 3;
const FIXED_GRID_LEN = FIXED_GRID_SIZE * FIXED_GRID_SIZE;

const STORAGE_KEYS = {
  tree: "lg_service_tree",
  selectedTreeId: "lg_selected_tree_id",
  folderAssignments: "lg_folder_assignments",
  cameras: "lg_cameras",
  markers: "lg_markers",
  timelineEvents: "lg_timeline_events",
};

const INITIAL_NEW_CAMERA_FORM: NewCameraForm = {
  camId: "",
  sourceType: "USB",
  displayName: "",
  usbDeviceName: "",
  rtspIp: "",
  rtspPort: "554",
  rtspPath: "stream1",
};

const QUALITY_STREAM_CONFIG: Record<Quality, { width: number; height: number; fps: number; quality: number; label: string }> = {
  FHD: { width: 1920, height: 1080, fps: 22, quality: 92, label: "FHD" },
  HD: { width: 1280, height: 720, fps: 14, quality: 72, label: "HD" },
  SD: { width: 640, height: 360, fps: 8, quality: 50, label: "SD" },
};

const DEFAULT_CAMERAS: CameraItem[] = [];

const canonicalDeviceId = (raw: string): string => {
  const id = (raw || "").trim().replace(/^USB\//i, "");
  const upper = id.toUpperCase();
  if (upper === "ROBOT_1" || upper === "ROBOT1" || upper === "ROBOT") return "ROBOT_1";
  if (
    upper === "CCTV_REALSENSE_999" ||
    upper === "REALSENSE" ||
    upper === "CCTV_REALSENSE" ||
    upper === "CCTV_REALSENSE999"
  ) {
    return "CCTV_RealSense_999";
  }
  return id;
};

const sameDeviceId = (a?: string | null, b?: string | null) =>
  canonicalDeviceId(a || "").toUpperCase() === canonicalDeviceId(b || "").toUpperCase();

const normalizeCameraItem = (cam: CameraItem): CameraItem => {
  const nextId = canonicalDeviceId(cam.id);
  const nextName = /realsense/i.test(cam.name) ? "CCTV_RealSense_999" : cam.name;
  const nextUsbLabel = /USB\//i.test(cam.sourceLabel)
    ? cam.sourceLabel.replace(/realsense/gi, "CCTV_RealSense_999")
    : cam.sourceLabel;
  return { ...cam, id: nextId, name: nextName, sourceLabel: nextUsbLabel };
};

const EVENT_COLOR: Record<EventType, string> = {
  danger: "#ff5f6d",
  safe: "#38d39f",
  conn: "#59a7ff",
  disconn: "#f6c94a",
  manual_on: "#9b8cff",
  manual_off: "#ff9e64",
};

const EVENT_PRIORITY: Record<EventType, number> = {
  conn: 1,
  disconn: 1,
  manual_off: 2,
  manual_on: 2,
  safe: 2,
  danger: 3,
};

const EVENT_LABEL: Record<EventType, string> = {
  danger: "DANGER",
  safe: "SAFE",
  conn: "CONNECTED",
  disconn: "DISCONNECTED",
  manual_on: "원격수동조종 시작",
  manual_off: "원격수동조종 종료",
};

const eventMinuteOfDay = (e: TimelineEvent) => ((e.hour * 60) + (e.minute ?? 0));
const minuteOfDayToLabel = (value: number) => {
  const h = Math.floor(value / 60);
  const m = value % 60;
  return `${h}시 ${m}분`;
};

const TIMELINE_RETENTION_MS = 24 * 60 * 60 * 1000;
const TIMELINE_BUCKET_MINUTES = 15;
const TIMELINE_DEDUP_WINDOW_MS = 5000;

const pruneTimelineEvents = (events: TimelineEvent[], nowTs = Date.now()) => {
  const now = new Date(nowTs);
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();

  return events
    .filter((e) => {
      const ts = typeof e.ts === "number" ? e.ts : nowTs;
      if (nowTs - ts >= TIMELINE_RETENTION_MS) return false;
      const dt = new Date(ts);
      // 타임라인 축(0~24시)이 "당일 시각" 기준이므로 전날 로그는 제거한다.
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    })
    .slice(0, 1500);
};

const isDuplicateTimelineEvent = (a: TimelineEvent, b: TimelineEvent) => {
  if (!sameDeviceId(a.cameraId, b.cameraId)) return false;
  if (a.type !== b.type) return false;
  const ta = typeof a.ts === "number" ? a.ts : null;
  const tb = typeof b.ts === "number" ? b.ts : null;
  if (ta == null || tb == null) {
    return a.hour === b.hour && (a.minute ?? 0) === (b.minute ?? 0);
  }
  return Math.abs(ta - tb) <= TIMELINE_DEDUP_WINDOW_MS;
};

const mergeTimelineEventsUnique = (prev: TimelineEvent[], incoming: TimelineEvent[]) => {
  const next = [...prev];
  for (const ev of incoming) {
    const duplicated = next.some((x) => isDuplicateTimelineEvent(x, ev));
    if (!duplicated) next.unshift(ev);
  }
  return pruneTimelineEvents(next);
};

const MARKER_PRESETS = [
  { x: 30, y: 69, angle: 35 },
  { x: 52, y: 64, angle: -20 },
  { x: 64, y: 71, angle: 140 },
  { x: 24, y: 54, angle: 5 },
  { x: 70, y: 48, angle: 180 },
  { x: 42, y: 38, angle: 90 },
];

const mapGatewayStatusToEventType = (status?: string, message?: string): EventType | null => {
  const normalized = (status || "").trim().toUpperCase();
  if (normalized === "DANGER") return "danger";
  if (normalized === "SAFE") return "safe";
  if (normalized === "CONNECTED") return "conn";
  if (normalized === "DISCONNECTED") return "disconn";
  if (normalized === "FORCED_DISCONNECTED") return "disconn";
  if (normalized === "MANUAL_ON") return "manual_on";
  if (normalized === "MANUAL_OFF") return "manual_off";
  const msg = (message || "").toUpperCase();
  if (msg.includes("[DANGER]")) return "danger";
  if (msg.includes("[SAFE]")) return "safe";
  if (msg.includes("[CONNECTED]")) return "conn";
  if (msg.includes("[DISCONNECTED]")) return "disconn";
  if (msg.includes("[FORCED_DISCONNECTED]")) return "disconn";
  if (msg.includes("[MANUAL_ON]")) return "manual_on";
  if (msg.includes("[MANUAL_OFF]")) return "manual_off";
  if (msg.includes("연결 성공")) return "conn";
  if (msg.includes("연결 끊김")) return "disconn";
  return null;
};

const mapRecentLogToEventType = (item: GatewayRecentLogItem): EventType | null => {
  const raw = `${item.cctvLog || ""} ${item.robotLog || ""}`.toUpperCase();
  const bracket = raw.match(/\[(.*?)\]/)?.[1]?.trim();
  if (bracket) return mapGatewayStatusToEventType(bracket, raw);
  return mapGatewayStatusToEventType(undefined, raw);
};

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

const makeEmptyGridAssignments = (): (string | null)[] =>
  Array.from({ length: FIXED_GRID_LEN }, () => null);

const parseJson = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

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

const addChildFolderNode = (node: FolderNode, targetId: string, child: FolderNode): FolderNode => {
  if (node.id === targetId) {
    return { ...node, children: [...node.children, child] };
  }
  return {
    ...node,
    children: node.children.map((n) => addChildFolderNode(n, targetId, child)),
  };
};

const collectFolderIds = (node: FolderNode): string[] => {
  const ids = [node.id];
  for (const child of node.children) ids.push(...collectFolderIds(child));
  return ids;
};

function App() {
  const [cameras, setCameras] = useState<CameraItem[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.cameras);
    if (raw !== null) {
      return parseJson<CameraItem[]>(raw, []).map(normalizeCameraItem);
    }
    return DEFAULT_CAMERAS.map(normalizeCameraItem);
  });
  const [tree, setTree] = useState<FolderNode>(() =>
    parseJson<FolderNode>(localStorage.getItem(STORAGE_KEYS.tree), INITIAL_TREE)
  );
  const [selectedTreeId, setSelectedTreeId] = useState<string>(() =>
    localStorage.getItem(STORAGE_KEYS.selectedTreeId) || "branch-01"
  );
  const [folderAssignments, setFolderAssignments] = useState<Record<string, (string | null)[]>>(() => {
    const fallback: Record<string, (string | null)[]> = {
      "branch-01": makeEmptyGridAssignments(),
    };
    if (DEFAULT_CAMERAS.length > 0) fallback["branch-01"][0] = DEFAULT_CAMERAS[0].id;
    const stored = parseJson<Record<string, (string | null)[]>>(
      localStorage.getItem(STORAGE_KEYS.folderAssignments),
      fallback
    );
    const next: Record<string, (string | null)[]> = {};
    for (const [folderId, list] of Object.entries(stored)) {
      next[folderId] = list.map((id) => (id ? canonicalDeviceId(id) : null));
    }
    if (!next["branch-01"]) next["branch-01"] = fallback["branch-01"];
    return next;
  });

  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>(() =>
    pruneTimelineEvents(
      parseJson<TimelineEvent[]>(localStorage.getItem(STORAGE_KEYS.timelineEvents), [])
        .map((e) => ({ ...e, cameraId: canonicalDeviceId(e.cameraId), ts: typeof e.ts === "number" ? e.ts : Date.now() }))
    )
  );
  const [selectedTimelineCluster, setSelectedTimelineCluster] = useState<TimelineClusterSelection | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showMapPlacementModal, setShowMapPlacementModal] = useState(false);
  const [pendingMapPlacementCamId, setPendingMapPlacementCamId] = useState<string | null>(null);
  const [addError, setAddError] = useState("");
  const [newCamera, setNewCamera] = useState<NewCameraForm>(INITIAL_NEW_CAMERA_FORM);
  const [addTarget, setAddTarget] = useState<AddTargetType>("cctv");
  const controlsLocked = showAddModal || showMapPlacementModal;

  const gridSize = FIXED_GRID_SIZE;
  const gridAssignments = useMemo(
    () => folderAssignments[selectedTreeId] ?? makeEmptyGridAssignments(),
    [folderAssignments, selectedTreeId]
  );

  const [markers, setMarkers] = useState<MapMarker[]>(() => {
    const raw = localStorage.getItem(STORAGE_KEYS.markers);
    if (raw !== null) {
      return parseJson<MapMarker[]>(raw, []).map((m) => ({
        ...m,
        cameraId: canonicalDeviceId(m.cameraId),
      }));
    }
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
  const [streamRetryMap, setStreamRetryMap] = useState<Record<string, number>>({});
  const [streamUiStatus, setStreamUiStatus] = useState<Record<string, CamStatus>>({});
  const streamHealthRef = useRef<Record<string, { lastOkAt: number; errorCount: number }>>({});
  const camerasRef = useRef<CameraItem[]>([]);
  const monitoringStartedRef = useRef<Set<string>>(new Set());
  const timelineLogSeenRef = useRef<Set<string>>(new Set());
  const uiSessionIdRef = useRef<string>("");
  const lastRetryAtRef = useRef<Record<string, number>>({});

  const robotSocketRef = useRef<Socket | null>(null);
  const gatewayWsRef = useRef<WebSocket | null>(null);
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
  const cameraIdKey = useMemo(
    () => cameras.map((c) => canonicalDeviceId(c.id)).sort().join("|"),
    [cameras]
  );
  const focusedCam = focusedCamId ? cameraMap.get(focusedCamId) ?? null : null;
  const focusedCamSlots = useMemo(() => {
    if (!focusedCamId) return [] as number[];
    const slots: number[] = [];
    gridAssignments.forEach((camId, idx) => {
      if (camId === focusedCamId) slots.push(idx + 1);
    });
    return slots;
  }, [focusedCamId, gridAssignments]);

  const buildStreamUrl = (camId: string) => {
    const normalizedCamId = canonicalDeviceId(camId);
    const retry = streamRetryMap[normalizedCamId] ?? 0;
    const cam = cameras.find((c) => sameDeviceId(c.id, normalizedCamId));
    const qualityTag = cam?.quality ?? "SD";
    return `${NETWORK_CONFIG.ALGO_API_URL}/video_feed/${encodeURIComponent(normalizedCamId)}?r=${retry}&q=${encodeURIComponent(qualityTag)}`;
  };

  const bumpStreamRetry = (camId: string) => {
    const normalizedCamId = canonicalDeviceId(camId);
    setStreamRetryMap((prev) => ({ ...prev, [normalizedCamId]: (prev[normalizedCamId] ?? 0) + 1 }));
  };

  const bumpStreamRetryThrottled = (camId: string) => {
    const now = Date.now();
    const last = lastRetryAtRef.current[camId] ?? 0;
    if (now - last < 1200) return;
    lastRetryAtRef.current[camId] = now;
    bumpStreamRetry(camId);
  };

  const markStreamLoaded = (camId: string) => {
    const key = canonicalDeviceId(camId);
    streamHealthRef.current[key] = { lastOkAt: Date.now(), errorCount: 0 };
    setStreamUiStatus((prev) => ({ ...prev, [key]: "online" }));
  };

  const markStreamErrored = (camId: string) => {
    const key = canonicalDeviceId(camId);
    const now = Date.now();
    const prev = streamHealthRef.current[key] ?? { lastOkAt: 0, errorCount: 0 };
    const next = {
      lastOkAt: prev.lastOkAt,
      errorCount: prev.errorCount + 1,
    };
    streamHealthRef.current[key] = next;

    // MJPEG는 간헐 오류가 잦으므로 단일 오류로 offline 처리하지 않는다.
    const msSinceLastOk = prev.lastOkAt ? now - prev.lastOkAt : Number.POSITIVE_INFINITY;
    const shouldForceOffline = next.errorCount >= 3 && msSinceLastOk > 3000;
    if (shouldForceOffline) {
      setStreamUiStatus((statusPrev) => ({ ...statusPrev, [key]: "offline" }));
    }
    if (shouldForceOffline) bumpStreamRetryThrottled(camId);
  };

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.tree, JSON.stringify(tree));
  }, [tree]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.selectedTreeId, selectedTreeId);
  }, [selectedTreeId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.folderAssignments, JSON.stringify(folderAssignments));
  }, [folderAssignments]);

  useEffect(() => {
    camerasRef.current = cameras;
  }, [cameras]);

  useEffect(() => {
    const alive = new Set(cameras.map((c) => canonicalDeviceId(c.id)));
    monitoringStartedRef.current.forEach((id) => {
      if (!alive.has(id)) monitoringStartedRef.current.delete(id);
    });

    cameras.forEach((cam) => {
      const camId = canonicalDeviceId(cam.id);
      if (!camId || monitoringStartedRef.current.has(camId)) return;
      monitoringStartedRef.current.add(camId);
      void fetch(`${NETWORK_CONFIG.ALGO_API_URL}/monitoring/start/${camId}`, { method: "POST" }).catch(() => {
        monitoringStartedRef.current.delete(camId);
      });
    });
  }, [cameraIdKey, cameras]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.cameras, JSON.stringify(cameras));
  }, [cameraIdKey]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.markers, JSON.stringify(markers));
  }, [markers]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.timelineEvents, JSON.stringify(timelineEvents));
  }, [timelineEvents]);

  useEffect(() => {
    if (!selectedTimelineCluster) return;
    const hasCam = cameras.some((cam) => sameDeviceId(cam.id, selectedTimelineCluster.cameraId));
    if (!hasCam) setSelectedTimelineCluster(null);
  }, [cameras, selectedTimelineCluster]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimelineEvents((prev) => pruneTimelineEvents(prev));
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!findNodeById(tree, selectedTreeId)) {
      setSelectedTreeId("branch-01");
    }
  }, [selectedTreeId, tree]);

  useEffect(() => {
    const socket = io(`http://${NETWORK_CONFIG.ROBOT_IP}:5001`, {
      // Do not force websocket only; allow polling fallback for unstable networks.
      reconnection: true,
      reconnectionAttempts: 20,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 5000,
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

  useEffect(() => {
    const ws = new WebSocket(`ws://${NETWORK_CONFIG.PC_IP}:8080`);
    gatewayWsRef.current = ws;

    ws.onmessage = (event) => {
      let payload: GatewayRealtimePayload | null = null;
      try {
        payload = JSON.parse(String(event.data)) as GatewayRealtimePayload;
      } catch {
        return;
      }

      const cameraId = canonicalDeviceId(payload?.camId || "");
      const type = mapGatewayStatusToEventType(payload?.status, payload?.message);
      if (!cameraId || !type) return;

      const hour = new Date().getHours();
      const minute = new Date().getMinutes();
      const nowTs = Date.now();
      setTimelineEvents((prev) =>
        mergeTimelineEventsUnique(prev, [
          {
            id: `ev-${nowTs}-${Math.random().toString(36).slice(2, 7)}`,
            cameraId,
            hour,
            minute,
            type,
            ts: nowTs,
          },
        ])
      );

      // 상태 점은 게이트웨이 disconn 이벤트보다 실제 스트림 렌더링(onLoad/onError)을 우선한다.
      // disconn 이벤트만으로 즉시 빨강 전환하지 않는다.

      // conn 이벤트가 자주 오면 스트림 재열기로 오히려 흔들릴 수 있어서
      // 최근 프레임이 끊긴 경우에만 재시도 트리거.
      if (type === "conn") {
        const health = streamHealthRef.current[cameraId];
        const isStale = !health?.lastOkAt || (Date.now() - health.lastOkAt > 5000);
        if (isStale) bumpStreamRetryThrottled(cameraId);
      }
    };

    return () => {
      ws.close();
      gatewayWsRef.current = null;
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const pollRecentLogs = async () => {
      try {
        const res = await fetch(
          `${NETWORK_CONFIG.GATEWAY_URL}/api/logs/recent?take=200&_=${Date.now()}`,
          {
            cache: "no-store",
            headers: {
              "Cache-Control": "no-cache",
              Pragma: "no-cache",
            },
          }
        );
        if (!res.ok) return;
        const data = await res.json();
        const items: GatewayRecentLogItem[] = Array.isArray(data?.items) ? data.items : [];
        if (items.length === 0 || disposed) return;

        const newEvents: TimelineEvent[] = [];
        for (const item of items) {
          const eventKey = `db-${String(item.id)}`;
          if (timelineLogSeenRef.current.has(eventKey)) continue;

          const camId = canonicalDeviceId(String(item.camId || ""));
          const type = mapRecentLogToEventType(item);
          if (!camId || !type) {
            timelineLogSeenRef.current.add(eventKey);
            continue;
          }

          const now = new Date();
          let created = item.createdAt ? new Date(item.createdAt) : now;
          // 서버/클라이언트 시간대 차이로 미래 시간(예: 16~17시로 밀림)이 들어오면 현재 시각으로 보정
          if (Number.isNaN(created.getTime()) || created.getTime() > now.getTime() + 5 * 60 * 1000) {
            created = now;
          }
          const hour = created.getHours();
          const minute = created.getMinutes();
          newEvents.push({ id: eventKey, cameraId: camId, hour, minute, type, ts: created.getTime() });
          timelineLogSeenRef.current.add(eventKey);
        }

        if (newEvents.length > 0 && !disposed) {
          setTimelineEvents((prev) => mergeTimelineEventsUnique(prev, newEvents));
        }
      } catch {
        // ignore transient polling errors
      }
    };

    void pollRecentLogs();
    const timer = window.setInterval(pollRecentLogs, 2000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const existing = sessionStorage.getItem("lg_ui_session_id");
    if (existing) uiSessionIdRef.current = existing;
    else {
      const id = `ui-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      uiSessionIdRef.current = id;
      sessionStorage.setItem("lg_ui_session_id", id);
    }

    const sendHeartbeat = () => {
      const sessionId = uiSessionIdRef.current;
      if (!sessionId) return;
      const cameraIds = camerasRef.current.map((c) => canonicalDeviceId(c.id));
      fetch(`${NETWORK_CONFIG.ALGO_API_URL}/ui/session/heartbeat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          camera_ids: cameraIds,
        }),
      }).catch(() => {});
    };

    void sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const emitControl = (command: string, type: "down" | "up", speed: number) => {
    // Keep compatibility with robot server command format:
    // move: w/a/s/d, camera: arrowup/arrowdown/arrowleft/arrowright
    const mapped = (() => {
      if (command.startsWith("cam_")) {
        const dir = command.replace("cam_", "");
        const camMap: Record<string, string> = {
          up: "arrowup",
          down: "arrowdown",
          left: "arrowleft",
          right: "arrowright",
        };
        return camMap[dir] || command;
      }
      const moveMap: Record<string, string> = {
        up: "w",
        down: "s",
        left: "a",
        right: "d",
      };
      return moveMap[command] || command;
    })();

    robotSocketRef.current?.emit("direct_control", { command: mapped, type, speed });
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
    const isTypingElement = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (controlsLocked || isTypingElement(e.target)) return;
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
      if (controlsLocked || isTypingElement(e.target)) return;
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
  }, [camSpeed, moveSpeed, controlsLocked]);

  const onDropToCell = (toIndex: number) => {
    const payload = dragPayloadRef.current;
    if (!payload) return;

    setFolderAssignments((prevMap) => {
      const current = prevMap[selectedTreeId] ?? makeEmptyGridAssignments();
      const next = [...current];
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

      return { ...prevMap, [selectedTreeId]: next };
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
    if (!pendingMapPlacementCamId) return;

    const p = toMapCoord(e.clientX, e.clientY);
    const camId = pendingMapPlacementCamId;
    const markerId = `m-${camId}`;
    const hasExisting = markers.some((m) => m.id === markerId);

    // Existing marker should be moved only by dragging, not by map-click creation flow.
    if (hasExisting) {
      setPendingMapPlacementCamId(null);
      setShowMapPlacementModal(false);
      setSelectedMarkerId(markerId);
      setFocusedCamId(camId);
      setSelectedMapCam(camId);
      return;
    }

    setMarkers((prev) => {
      return [
        ...prev,
        {
          id: markerId,
          cameraId: camId,
          x: p.x,
          y: p.y,
          angle: 0,
        },
      ];
    });

    setSelectedMarkerId(markerId);
    setFocusedCamId(camId);
    setSelectedMapCam(camId);
    setPendingMapPlacementCamId(null);
    setShowMapPlacementModal(false);
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
    setAddTarget("cctv");
    setShowAddModal(true);
    setAddError("");
    setNewCamera({ ...INITIAL_NEW_CAMERA_FORM, camId: "" });
  };

  const closeAddCameraModal = () => {
    setShowAddModal(false);
    setAddError("");
  };

  const applyStreamConfig = async (camId: string, q: Quality) => {
    const cfg = QUALITY_STREAM_CONFIG[q];
    try {
      await fetch(`${NETWORK_CONFIG.ALGO_API_URL}/streams/config/${camId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
    } catch {
      // Keep UI responsive even if stream tuning API is unreachable.
    }
  };

  useEffect(() => {
    cameras.forEach((cam) => {
      void applyStreamConfig(cam.id, cam.quality);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameras.length]);

  const addCamera = async () => {
    const sourceType: SourceType = addTarget === "robot" ? "USB" : newCamera.sourceType;
    const typedCamId = newCamera.camId.trim();
    const usbDeviceNameRaw = newCamera.usbDeviceName.trim();
    const usbDeviceName = usbDeviceNameRaw.replace(/^USB\//i, "").trim();

    // USB/ROBOT: use USB device name as camera ID. RTSP: use explicit camera ID.
    const idSeed = sourceType === "USB" ? usbDeviceName : typedCamId;
    if (!idSeed) {
      if (sourceType === "USB") {
        setAddError(addTarget === "robot" ? "로봇 USB 장치명을 입력하세요." : "USB 장치명을 입력하세요.");
      } else {
        setAddError("RTSP 카메라 ID를 입력하세요.");
      }
      return;
    }

    let camId = canonicalDeviceId(idSeed);
    // Keep stable IDs for built-in USB templates so upstream frame uploader IDs match.
    if (addTarget === "robot") camId = camId || "ROBOT_1";
    if (addTarget === "cctv" && sourceType === "USB" && /realsense/i.test(camId || newCamera.displayName || usbDeviceName)) {
      camId = "CCTV_RealSense_999";
    }
    const displayName = newCamera.displayName.trim();
    const rtspIp = newCamera.rtspIp.trim();
    const rtspPort = (newCamera.rtspPort.trim() || "554").replace(/[^\d]/g, "");
    const rtspPath = newCamera.rtspPath.trim() || "stream1";

    if (!camId) {
      setAddError(sourceType === "USB" ? "USB 장치명을 입력하세요." : "RTSP 카메라 ID를 입력하세요.");
      return;
    }
    if (cameras.some((c) => sameDeviceId(c.id, camId))) {
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
      status: "offline",
      quality: "SD",
      sourceType,
      sourceLabel,
    };

    setCameras((prev) => [...prev, newCam]);
    setStreamUiStatus((prev) => ({ ...prev, [canonicalDeviceId(id)]: "offline" }));
    setSelectedMapCam(id);
    setFocusedCamId(id);
    setSelectedMarkerId(null);

    // Connection timeline/status should be driven by realtime gateway events,
    // not by local optimistic UI state.

    setFolderAssignments((prevMap) => {
      const current = prevMap[selectedTreeId] ?? makeEmptyGridAssignments();
      const next = [...current];
      const firstEmpty = next.findIndex((x) => x === null);
      if (firstEmpty >= 0) next[firstEmpty] = id;
      return { ...prevMap, [selectedTreeId]: next };
    });

    closeAddCameraModal();
    void applyStreamConfig(id, "SD");
    // Ensure monitoring state is enabled for newly attached device.
    // (streaming itself can still run without detection, but this keeps behavior consistent)
    void fetch(`${NETWORK_CONFIG.ALGO_API_URL}/monitoring/start/${id}`, { method: "POST" }).catch(() => {});
    // Warm-up retries: some USB/robot feeds publish a bit later than first mount.
    window.setTimeout(() => bumpStreamRetryThrottled(id), 1200);
    window.setTimeout(() => bumpStreamRetryThrottled(id), 3500);
    setPendingMapPlacementCamId(id);
    setShowMapPlacementModal(true);
  };

  const disconnectCamera = async (cameraId: string) => {
    const target = cameraMap.get(cameraId);
    if (!target) return;

    // Optimistic UI cleanup first so "해제" responds immediately even if API is slow/unreachable.
    const now = new Date();
    const hour = now.getHours();
    const minute = now.getMinutes();
    setTimelineEvents((prev) =>
      pruneTimelineEvents([
        { id: `ev-${Date.now()}`, cameraId: canonicalDeviceId(cameraId), hour, minute, type: "disconn", ts: Date.now() },
        ...prev.filter((e) => !sameDeviceId(e.cameraId, cameraId)),
      ])
    );

    setCameras((prev) => prev.filter((cam) => cam.id !== cameraId));
    setMarkers((prev) => prev.filter((m) => m.cameraId !== cameraId));

    setFolderAssignments((prevMap) => {
      const nextMap: Record<string, (string | null)[]> = {};
      for (const [folderId, assignments] of Object.entries(prevMap)) {
        nextMap[folderId] = assignments.map((id) => (id && sameDeviceId(id, cameraId) ? null : id));
      }
      return nextMap;
    });

    if (focusedCamId === cameraId) setFocusedCamId(null);
    if (selectedMapCam === cameraId) {
      const fallback = cameras.find((c) => c.id !== cameraId)?.id ?? "";
      setSelectedMapCam(fallback);
    }
    if (singleViewCam === cameraId) setSingleViewCam(null);
    setSelectedMarkerId((prev) => (prev === `m-${cameraId}` || prev === `m-${canonicalDeviceId(cameraId)}` ? null : prev));
    setStreamRetryMap((prev) => {
      const next = { ...prev };
      delete next[cameraId];
      return next;
    });
    setStreamUiStatus((prev) => {
      const next = { ...prev };
      delete next[canonicalDeviceId(cameraId)];
      return next;
    });

    // Backend cleanup in background.
    void fetch(`${NETWORK_CONFIG.ALGO_API_URL}/monitoring/stop/${cameraId}`, { method: "POST" }).catch(() => {});
    void fetch(`${NETWORK_CONFIG.ALGO_API_URL}/cameras/unregister/${cameraId}`, { method: "POST" }).catch(() => {});
  };

  const rotateSelectedMarker = (delta: number) => {
    if (!selectedMarkerId) return;
    setMarkers((prev) => prev.map((m) => (
      m.id === selectedMarkerId ? { ...m, angle: m.angle + delta } : m
    )));
  };

  const appendControlSessionLog = (cameraId: string, mode: "enter" | "exit") => {
    const normalizedCamId = canonicalDeviceId(cameraId);
    const now = new Date();
    const nowTs = now.getTime();
    const eventType: EventType = mode === "enter" ? "manual_on" : "manual_off";

    // 서버 응답과 무관하게 UI 타임라인에는 즉시 반영한다.
    setTimelineEvents((prev) =>
      mergeTimelineEventsUnique(prev, [
        {
          id: `ctrl-local-${mode}-${nowTs}-${Math.random().toString(36).slice(2, 6)}`,
          cameraId: normalizedCamId,
          hour: now.getHours(),
          minute: now.getMinutes(),
          type: eventType,
          ts: nowTs,
        },
      ])
    );

    const status = mode === "enter" ? "MANUAL_ON" : "MANUAL_OFF";
    const message = mode === "enter" ? "[MANUAL_ON] 확대 모드 진입" : "[MANUAL_OFF] 멀티뷰 복귀";
    void fetch(`${NETWORK_CONFIG.GATEWAY_URL}/api/logs/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        camId: normalizedCamId,
        status,
        message,
      }),
    }).then((res) => {
      if (!res.ok) throw new Error(`manual log failed: ${res.status}`);
    }).catch((err) => {
      console.warn("[manual-log] gateway 전송 실패", err);
    });
  };

  const toggleSingleView = (cameraId: string) => {
    setSingleViewCam((prev) => {
      const next = prev === cameraId ? null : cameraId;
      if (!prev && next) appendControlSessionLog(cameraId, "enter");
      if (prev && !next) appendControlSessionLog(cameraId, "exit");
      if (prev && next && prev !== next) {
        appendControlSessionLog(prev, "exit");
        appendControlSessionLog(next, "enter");
      }
      return next;
    });
  };

  const addFolderByNode = (targetId: string) => {
    const base = findNodeById(tree, targetId);
    if (!base) return;
    const name = window.prompt("새 폴더 이름을 입력하세요");
    if (!name) return;
    const label = name.trim();
    if (!label) return;
    const newNode: FolderNode = {
      id: `folder-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      label,
      children: [],
    };
    setTree((prev) => addChildFolderNode(prev, targetId, newNode));
    setFolderAssignments((prevMap) => ({ ...prevMap, [newNode.id]: makeEmptyGridAssignments() }));
  };

  const removeFolderByNode = (targetId: string) => {
    if (targetId === "root" || targetId === "branch-01") return;
    const targetNode = findNodeById(tree, targetId);
    if (!targetNode) return;
    const deletedIds = collectFolderIds(targetNode);

    setTree((prev) => removeFolderNode(prev, targetId));
    setFolderAssignments((prevMap) => {
      const nextMap = { ...prevMap };
      for (const id of deletedIds) delete nextMap[id];
      return nextMap;
    });

    if (deletedIds.includes(selectedTreeId)) setSelectedTreeId("branch-01");
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
    activeDirRef: React.MutableRefObject<Dir>,
    disabled: boolean
  ) => {
    return (
      <div className={`joystick-card ${disabled ? "locked" : ""}`}>
        <div className="joystick-title">{title}</div>
        <div
          ref={joyRef}
          className={`joystick-pad ${disabled ? "disabled" : ""}`}
          onPointerDown={(e) => {
            if (disabled) return;
            const root = joyRef.current;
            if (!root) return;
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            moveJoystick(e, root, commandPrefix, speed, setKnob, activeDirRef);
          }}
          onPointerMove={(e) => {
            if (disabled) return;
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
            disabled={disabled}
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
            {renderJoystick("로봇 이동 조이스틱", "", moveSpeed, setMoveSpeed, moveJoyRef, moveKnob, setMoveKnob, activeMoveDirRef, controlsLocked)}
            {renderJoystick("카메라 조이스틱", "cam_", camSpeed, setCamSpeed, camJoyRef, camKnob, setCamKnob, activeCamDirRef, controlsLocked)}
          </section>
        </aside>

        <main className="center-panel">
          <section className="grid-panel">
            <div className="panel-head row">
              <span>멀티뷰 ({gridSize}x{gridSize})</span>
              <span className="tip">드래그해서 화면 배치 · 연결 없는 화면은 검정</span>
            </div>
            <div
              className="camera-grid"
              style={{
                gridTemplateColumns: `repeat(${gridSize}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${gridSize}, minmax(0, 1fr))`,
              }}
            >
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
                            <span
                              className={`status-dot ${streamUiStatus[canonicalDeviceId(cam.id)] ?? "offline"}`}
                            />
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
                              void applyStreamConfig(cam.id, value);
                              // Re-open MJPEG stream so new quality/resolution reflects immediately.
                              bumpStreamRetry(cam.id);
                            }}
                          >
                            {QUALITY_OPTIONS.map((q) => (
                              <option key={`${cam.id}-${q}`} value={q}>{q}</option>
                            ))}
                          </select>
                        </div>

                        <button
                          type="button"
                          className="stream-btn"
                          onClick={() => toggleSingleView(cam.id)}
                        >
                          <img
                            src={buildStreamUrl(cam.id)}
                            alt={cam.id}
                            onError={() => markStreamErrored(cam.id)}
                            onLoad={() => markStreamLoaded(cam.id)}
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
              <div className="timeline-scale-spacer" />
              <div className="timeline-scale-track">
                {Array.from({ length: 25 }, (_, i) => (
                  <div key={`tick-${i}`} className="tick" style={{ left: `${(i / 24) * 100}%` }}>
                    <span>{i}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="timeline-rows">
              {cameras.map((cam) => {
                const events = timelineEvents
                  .filter((e) => sameDeviceId(e.cameraId, cam.id))
                  .sort((a, b) => eventMinuteOfDay(a) - eventMinuteOfDay(b));
                const clusters = Array.from(
                  events.reduce((map, event) => {
                    const minuteOfDay = eventMinuteOfDay(event);
                    const bucketStart =
                      Math.floor(minuteOfDay / TIMELINE_BUCKET_MINUTES) * TIMELINE_BUCKET_MINUTES; // 00/15/30/45 분 기준
                    if (!map.has(bucketStart)) map.set(bucketStart, [] as TimelineEvent[]);
                    map.get(bucketStart)!.push(event);
                    return map;
                  }, new Map<number, TimelineEvent[]>())
                )
                  .sort((a, b) => a[0] - b[0])
                  .map(([bucketStart, bucketEvents]) => {
                    const repr = [...bucketEvents].sort((a, b) => EVENT_PRIORITY[b.type] - EVENT_PRIORITY[a.type])[0];
                    const bucketEnd = Math.min(bucketStart + TIMELINE_BUCKET_MINUTES - 1, 1439);
                    const hasMultiple = bucketEvents.length > 1;
                    const firstMinute = eventMinuteOfDay(bucketEvents[0]);
                    return {
                      key: `k-${cam.id}-${bucketStart}`,
                      events: bucketEvents,
                      // 단일 로그는 실제 분 위치, 복수 로그만 15분 버킷 시작(00/15/30/45)에 고정
                      leftPct: ((hasMultiple ? bucketStart : firstMinute) / (24 * 60)) * 100,
                      reprType: repr.type,
                      startMinuteOfDay: hasMultiple ? bucketStart : firstMinute,
                      endMinuteOfDay: hasMultiple ? bucketEnd : firstMinute,
                    };
                  });
                return (
                  <div key={`line-${cam.id}`} className="timeline-row-line">
                    <div className="cam-name">{cam.name}</div>
                    <div className="line-track">
                      <div className="base-line" />
                      {clusters.map((cluster) => (
                        <button
                          key={`${cam.id}-${cluster.key}`}
                          type="button"
                          className={`event-dot ${cluster.events.length > 1 ? "event-cluster" : ""}`}
                          style={{
                            left: `${cluster.leftPct}%`,
                            backgroundColor: EVENT_COLOR[cluster.reprType],
                          }}
                          title={
                            cluster.startMinuteOfDay === cluster.endMinuteOfDay
                              ? `${minuteOfDayToLabel(cluster.startMinuteOfDay)} / ${cluster.events.length}건`
                              : `${minuteOfDayToLabel(cluster.startMinuteOfDay)} ~ ${minuteOfDayToLabel(cluster.endMinuteOfDay)} / ${cluster.events.length}건`
                          }
                          onClick={() => setSelectedTimelineCluster({
                            cameraId: cam.id,
                            startMinuteOfDay: cluster.startMinuteOfDay,
                            endMinuteOfDay: cluster.endMinuteOfDay,
                            events: cluster.events,
                          })}
                        >
                          {cluster.events.length > 1 ? cluster.events.length : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
            {selectedTimelineCluster && (
              <div className="timeline-detail">
                <div className="timeline-detail-head">
                  <strong>
                    {cameraMap.get(selectedTimelineCluster.cameraId)?.name ?? selectedTimelineCluster.cameraId}
                  </strong>
                  <span>
                    {selectedTimelineCluster.startMinuteOfDay === selectedTimelineCluster.endMinuteOfDay
                      ? `${minuteOfDayToLabel(selectedTimelineCluster.startMinuteOfDay)}`
                      : `${minuteOfDayToLabel(selectedTimelineCluster.startMinuteOfDay)} ~ ${minuteOfDayToLabel(selectedTimelineCluster.endMinuteOfDay)}`
                    } · {selectedTimelineCluster.events.length}건
                  </span>
                  <button type="button" onClick={() => setSelectedTimelineCluster(null)}>닫기</button>
                </div>
                <div className="timeline-detail-list">
                  {Array.from(
                    selectedTimelineCluster.events
                      .sort((a, b) => eventMinuteOfDay(a) - eventMinuteOfDay(b))
                      .reduce((map, event) => {
                        const minuteKey = eventMinuteOfDay(event);
                        if (!map.has(minuteKey)) map.set(minuteKey, [] as TimelineEvent[]);
                        map.get(minuteKey)!.push(event);
                        return map;
                      }, new Map<number, TimelineEvent[]>())
                  ).map(([minuteKey, list]) => (
                    <div key={`g-${minuteKey}`} className="timeline-detail-group">
                      <div className="timeline-detail-time">{minuteOfDayToLabel(minuteKey)}</div>
                      <div className="timeline-detail-list">
                        {list
                          .sort((a, b) => EVENT_PRIORITY[b.type] - EVENT_PRIORITY[a.type])
                          .map((event) => (
                            <div key={event.id} className="timeline-detail-item">
                              <span className="dot" style={{ backgroundColor: EVENT_COLOR[event.type] }} />
                              <span>{EVENT_LABEL[event.type]}</span>
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>
        </main>

        <aside className="right-panel">
          <section className="map-panel">
            <div className="panel-head row">
              <span>맵 (장비 배치)</span>
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
            <div className="map-main">
              <div className={`placement-banner ${pendingMapPlacementCamId ? "" : "placeholder"}`}>
                {pendingMapPlacementCamId ? (
                  <>
                    배치 대기: <strong>{cameraMap.get(pendingMapPlacementCamId)?.name ?? pendingMapPlacementCamId}</strong>
                    {" "}장비 위치를 맵에서 클릭하세요.
                  </>
                ) : (
                  <span>&nbsp;</span>
                )}
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
                    const markerCam = cameraMap.get(marker.cameraId) ?? null;
                    const isRobot = isRobotDevice(markerCam);
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
                            className={`camera-marker ${isRobot ? "robot-marker" : ""}`}
                            onMouseDown={() => {
                              draggingMarkerRef.current = marker.id;
                            }}
                            onClick={() => {
                              setSelectedMarkerId(marker.id);
                              setFocusedCamId(marker.cameraId);
                            }}
                            onDoubleClick={() => toggleSingleView(marker.cameraId)}
                          >
                            {isRobot ? "🤖" : "📹"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          <section className="source-panel source-panel-right">
            <div className="panel-head row">
              <span>화면 소스</span>
              <button type="button" className="add-cam-btn" onClick={openAddCameraModal}>+ 장치 추가</button>
            </div>
            <div className="source-list">
              {cameras.length === 0 && <div className="source-empty">등록된 CCTV가 없습니다. 추가 후 사용하세요.</div>}
              {cameras.map((cam) => (
                <div
                  key={cam.id}
                  className={`source-item ${focusedCamId === cam.id ? "focus" : ""}`}
                >
                  <button
                    type="button"
                    className="source-main-btn"
                    draggable
                    onDragStart={() => {
                      dragPayloadRef.current = { cameraId: cam.id, fromIndex: null };
                    }}
                    onClick={() => {
                      setFocusedCamId(cam.id);
                      setSelectedMapCam(cam.id);

                      const existingMarker = markers.find((m) => sameDeviceId(m.cameraId, cam.id));
                      if (existingMarker) {
                        setSelectedMarkerId(existingMarker.id);
                        setPendingMapPlacementCamId(null);
                        return;
                      }

                      // Only unmapped devices enter map placement mode from source click.
                      setSelectedMarkerId(null);
                      setPendingMapPlacementCamId(cam.id);
                    }}
                  >
                  <span
                    className={`status-dot ${streamUiStatus[canonicalDeviceId(cam.id)] ?? "offline"}`}
                  />
                  <span className="source-name">{cam.name}</span>
                  <span className="source-id">{cam.sourceType}</span>
                  <span className="source-source">{cam.sourceLabel}</span>
                  </button>
                  <button
                    type="button"
                    className="disconnect-btn"
                    onClick={() => disconnectCamera(cam.id)}
                    title="연결 해제"
                  >
                    해제
                  </button>
                </div>
              ))}
            </div>
            <div className="source-selected-summary">
              {!focusedCam && <span className="muted">현재 선택된 장비 없음</span>}
              {focusedCam && (
                <>
                  <div><strong>선택:</strong> {focusedCam.name}</div>
                  <div><strong>소스:</strong> {focusedCam.sourceType} / {focusedCam.sourceLabel}</div>
                  <div><strong>화질:</strong> {focusedCam.quality}</div>
                  <div><strong>배치:</strong> {focusedCamSlots.length > 0 ? focusedCamSlots.map((v) => `${v}번`).join(", ") : "미배치"}</div>
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
              <h3>장비 연결 추가</h3>
              <button type="button" onClick={closeAddCameraModal}>닫기</button>
            </div>

            <div className="add-modal-body">
                <div className="template-row">
                  <button
                    type="button"
                    className={`template-btn ${addTarget === "robot" ? "active" : ""}`}
                    onClick={() => {
                      setAddError("");
                      setAddTarget("robot");
                      setNewCamera((prev) => ({
                        ...prev,
                        sourceType: "USB",
                        camId: "",
                        displayName: "ROBOT_1",
                        usbDeviceName: "ROBOT_1",
                      }));
                    }}
                  >
                  로봇
                </button>
                <button
                  type="button"
                  className={`template-btn ${addTarget === "cctv" ? "active" : ""}`}
                    onClick={() => {
                      setAddError("");
                      setAddTarget("cctv");
                      setNewCamera((prev) => ({
                        ...prev,
                        sourceType: "USB",
                        camId: "",
                        displayName: "CCTV_RealSense_999",
                        usbDeviceName: "CCTV_RealSense_999",
                      }));
                    }}
                  >
                  CCTV
                </button>
              </div>

              {addTarget === "cctv" && (
                <div className="source-toggle">
                  <button
                    type="button"
                    className={`source-toggle-btn ${newCamera.sourceType === "USB" ? "active" : ""}`}
                    onClick={() => {
                      setAddError("");
                      setNewCamera((prev) => ({ ...prev, sourceType: "USB" }));
                    }}
                  >
                    USB형
                  </button>
                  <button
                    type="button"
                    className={`source-toggle-btn ${newCamera.sourceType === "RTSP" ? "active" : ""}`}
                    onClick={() => {
                      setAddError("");
                      setNewCamera((prev) => ({ ...prev, sourceType: "RTSP" }));
                    }}
                  >
                    RTSP형
                  </button>
                </div>
              )}

              {addTarget === "cctv" && newCamera.sourceType === "RTSP" && (
                <label className="add-modal-field">
                  <span>RTSP 카메라 ID *</span>
                  <input
                    value={newCamera.camId}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAddError("");
                      setNewCamera((prev) => ({ ...prev, camId: value }));
                    }}
                    placeholder="예: CCTV_RTSP_01"
                  />
                </label>
              )}

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

              {(addTarget === "robot" || newCamera.sourceType === "USB") && (
                <label className="add-modal-field">
                  <span>USB 장치명 *</span>
                  <input
                    value={newCamera.usbDeviceName}
                    onChange={(e) => {
                      const value = e.target.value;
                      setAddError("");
                      setNewCamera((prev) => ({ ...prev, usbDeviceName: value }));
                    }}
                    placeholder={addTarget === "robot" ? "예: ROBOT_1" : "예: CCTV_RealSense_999"}
                  />
                </label>
              )}

              {addTarget === "cctv" && newCamera.sourceType === "RTSP" && (
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

      {showMapPlacementModal && pendingMapPlacementCamId && (
        <div className="placement-modal-overlay" onClick={() => setShowMapPlacementModal(false)}>
          <div className="placement-modal" onClick={(e) => e.stopPropagation()}>
            <h3>맵 배치 안내</h3>
            <p>
              <strong>{cameraMap.get(pendingMapPlacementCamId)?.name ?? pendingMapPlacementCamId}</strong>
              {" "}장비를 추가했습니다.
            </p>
            <p>아래 우측 맵 영역에서 원하는 위치를 클릭하면 장비가 배치됩니다.</p>
            <div className="placement-modal-actions">
              <button type="button" onClick={() => setShowMapPlacementModal(false)}>닫기</button>
            </div>
          </div>
        </div>
      )}

      {singleViewCam && (
        <div className="single-view-overlay">
          <div className="single-head">
            <div>{cameraMap.get(singleViewCam)?.name ?? singleViewCam}</div>
            <button type="button" onClick={() => toggleSingleView(singleViewCam!)}>닫기</button>
          </div>
          <div className="single-body" onClick={() => toggleSingleView(singleViewCam!)}>
            <img
              src={buildStreamUrl(singleViewCam)}
              alt={singleViewCam}
              onError={() => markStreamErrored(singleViewCam)}
              onLoad={() => markStreamLoaded(singleViewCam)}
            />
            <div className="single-fallback">NO SIGNAL</div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

