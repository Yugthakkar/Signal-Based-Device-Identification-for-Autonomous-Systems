// Dev server: talk to the backend on :8000. Production build: use VITE_API_BASE_URL when set,
// otherwise the same origin (the backend serves the built site itself, e.g. behind one tunnel).
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.PROD ? '' : 'http://localhost:8000')).replace(/\/$/, '');

export type HealthResponse = {
  status: string;
  model_loaded: boolean;
};

export type LogsResponse = {
  logs: string[];
};

export type PredictionPayload = {
  prediction: {
    label: number;
    device: string;
    confidence: number;
    probabilities: Record<string, number>;
  };
  features: number[];
  timestamp: number;
  session_id?: string;
  prediction_id?: number | null;
};

export type ModelInfoResponse = {
  model_loaded: boolean;
  feature_columns: string[];
  classes: Record<string, string>;
};

async function readJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `Request failed with status ${res.status}`);
  }
  return (await res.json()) as T;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const res = await fetch(`${API_BASE_URL}/health`);
  return readJson<HealthResponse>(res);
}

export async function fetchLogs(): Promise<LogsResponse> {
  const res = await fetch(`${API_BASE_URL}/logs`);
  return readJson<LogsResponse>(res);
}

export async function fetchModelInfo(): Promise<ModelInfoResponse> {
  const res = await fetch(`${API_BASE_URL}/model-info`);
  return readJson<ModelInfoResponse>(res);
}

export async function predictWithFeatures(features: number[]): Promise<PredictionPayload> {
  const res = await fetch(`${API_BASE_URL}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ features }),
  });
  return readJson<PredictionPayload>(res);
}

export async function predictWithEvents(
  events: Array<{ event_type: string; timestamp: number; value: string }>
): Promise<PredictionPayload> {
  const res = await fetch(`${API_BASE_URL}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ events }),
  });
  return readJson<PredictionPayload>(res);
}

export async function uploadModel(file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE_URL}/upload-model`, {
    method: 'POST',
    body: formData,
  });
  await readJson<{ status: string }>(res);
}

// --- CAN intrusion-detection module ---

export type CanDataset = {
  capture_id: string;
  window_count: number;
  positive_windows: number;
  attack_types: string[];
  duration_s: number;
};

export type CanAlert = {
  id: string;
  run_id: string | null;
  replay_id: string | null;
  capture_id: string;
  attack_type: string | null;
  window_start_s: number;
  window_end_s: number;
  max_probability: number;
  window_count: number;
  classification: string;
  created_at: string;
};

export type CanAnalyzeSummary = {
  windows_total: number;
  positive_windows: number;
  confusion_matrix: {
    true_positive: number;
    false_positive: number;
    false_negative: number;
    true_negative: number;
  };
  precision: number | null;
  recall: number | null;
  false_positive_rate: number | null;
};

export type CanReplayWindowEvent = {
  type: 'window';
  capture_id: string;
  window_start_s: number;
  window_end_s: number;
  attack_type: string;
  ground_truth_positive: boolean;
  features: Record<string, number>;
  prediction: {
    label?: number;
    classification: string;
    probability: number;
    threshold?: number;
  };
  position: number;
  total: number;
};

export type CanReplayStatusEvent = {
  type: 'status';
  status: 'running' | 'paused' | 'completed' | 'stopped';
};

export type CanReplayEvent = CanReplayWindowEvent | CanReplayStatusEvent;

export type CanModelInfo = {
  model_loaded: boolean;
  schema: string | null;
  feature_columns: string[] | null;
  selected_model: string | null;
  threshold: number | null;
  training_report: {
    rows: { train: number; validation: number; test: number };
    positive_windows: { train: number; validation: number; test: number };
    validation: Record<string, {
      precision: number;
      recall: number;
      f1: number;
      pr_auc: number;
      threshold: number;
      confusion_matrix: number[][];
    }>;
    chosen_model: string;
    test: {
      precision: number;
      recall: number;
      f1: number;
      pr_auc: number;
      threshold: number;
      confusion_matrix: number[][];
    };
  } | null;
};

export async function fetchCanDatasets(): Promise<{ datasets: CanDataset[] }> {
  const res = await fetch(`${API_BASE_URL}/can/datasets`);
  return readJson(res);
}

export async function runCanAnalysis(captureId: string): Promise<{ run_id: string; status: string; summary: CanAnalyzeSummary }> {
  const res = await fetch(`${API_BASE_URL}/can/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capture_id: captureId }),
  });
  return readJson(res);
}

export async function startCanReplay(captureId: string, speed: number): Promise<{ replay_id: string; capture_id: string; total_windows: number }> {
  const res = await fetch(`${API_BASE_URL}/can/replays`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ capture_id: captureId, speed }),
  });
  return readJson(res);
}

export async function pauseCanReplay(replayId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/can/replays/${replayId}/pause`, { method: 'POST' });
}

export async function resumeCanReplay(replayId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/can/replays/${replayId}/resume`, { method: 'POST' });
}

export async function stopCanReplay(replayId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/can/replays/${replayId}/stop`, { method: 'POST' });
}

export async function pollCanReplay(
  replayId: string,
  after: number
): Promise<{ events: CanReplayEvent[]; status: string; last: number }> {
  const res = await fetch(`${API_BASE_URL}/can/replays/${replayId}/poll?after=${after}&max_events=200`);
  return readJson(res);
}

export function openCanReplayStream(replayId: string): EventSource {
  return new EventSource(`${API_BASE_URL}/can/replays/${replayId}/events`);
}

export async function fetchCanAlerts(params: { runId?: string; replayId?: string; limit?: number } = {}): Promise<{ alerts: CanAlert[] }> {
  const query = new URLSearchParams();
  if (params.runId) query.set('run_id', params.runId);
  if (params.replayId) query.set('replay_id', params.replayId);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await fetch(`${API_BASE_URL}/can/alerts?${query.toString()}`);
  return readJson(res);
}

export async function fetchCanModelInfo(): Promise<CanModelInfo> {
  const res = await fetch(`${API_BASE_URL}/can/models`);
  return readJson(res);
}

// --- 3D Bus Lab: recorded scenario clips scored by the deployed model ---

export type CanScenarioWindow = {
  features: Record<string, number>;
  attack_fraction: number;
  ground_truth_positive: boolean;
  probability: number;
  classification: string;
};

export type CanFrame = {
  t: number;
  id: string;
  dlc: number;
  data: string[];
  injected: boolean;
};

export type CanScenario = {
  key: string;
  capture_id: string;
  windows: CanScenarioWindow[];
  frames: CanFrame[];
};

export type CanScenariosResponse = {
  threshold: number;
  selected_model: string | null;
  window_ms: number;
  scenarios: CanScenario[];
};

export async function fetchCanScenarios(): Promise<CanScenariosResponse> {
  const res = await fetch(`${API_BASE_URL}/can/scenarios`);
  return readJson(res);
}
