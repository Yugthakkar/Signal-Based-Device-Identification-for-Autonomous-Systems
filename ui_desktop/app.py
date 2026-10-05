from __future__ import annotations

from collections import deque
from datetime import datetime
from pathlib import Path
from tkinter import BOTH, END, LEFT, RIGHT, TOP, Button, Frame, Label, Text, Tk, filedialog
from tkinter import ttk

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from matplotlib.backends.backend_tkagg import FigureCanvasTkAgg

import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from feature_engineering.extract_features import extract_features_from_records
from feature_engineering.pcapng_to_csv import TsharkNotFoundError, convert_pcapng_to_csv
from ml_service.inference import InferenceEngine


class DesktopApp:
    def __init__(self, root: Tk) -> None:
        self.root = root
        self.root.title("SBDI Device Identification - Desktop")
        self.root.geometry("1200x760")

        self.loaded_events: list[dict] = []
        self.events_per_sec = deque(maxlen=120)
        self.gap_series = deque(maxlen=300)

        model_path = ROOT / "artifacts" / "device_classifier.pt"
        meta_path = ROOT / "artifacts" / "model_metadata.json"
        self.engine = InferenceEngine(model_path, meta_path) if model_path.exists() else None

        self._build_ui()

    def _build_ui(self) -> None:
        top = Frame(self.root)
        top.pack(side=TOP, fill=BOTH, expand=False, padx=12, pady=10)

        self.load_btn = Button(top, text="Load Dataset CSV", command=self.load_dataset, width=18)
        self.load_btn.pack(side=LEFT, padx=5)

        self.convert_btn = Button(top, text="Convert PCAPNG to CSV", command=self.convert_pcapng, width=20)
        self.convert_btn.pack(side=LEFT, padx=5)

        self.predict_btn = Button(top, text="Run Prediction", command=self.run_prediction, width=16)
        self.predict_btn.pack(side=LEFT, padx=5)

        self.clear_btn = Button(top, text="Clear", command=self.clear_view, width=12)
        self.clear_btn.pack(side=LEFT, padx=5)

        self.predict_label = Label(top, text="Prediction: Waiting for data", font=("Segoe UI", 12, "bold"))
        self.predict_label.pack(side=RIGHT, padx=10)

        middle = Frame(self.root)
        middle.pack(side=TOP, fill=BOTH, expand=True, padx=12, pady=8)

        log_frame = Frame(middle)
        log_frame.pack(side=LEFT, fill=BOTH, expand=True, padx=8)

        Label(log_frame, text="Event Logs", font=("Segoe UI", 11, "bold")).pack(anchor="w")
        self.log_box = Text(log_frame, height=32, width=60)
        self.log_box.pack(fill=BOTH, expand=True)

        graph_frame = Frame(middle)
        graph_frame.pack(side=RIGHT, fill=BOTH, expand=True, padx=8)

        Label(graph_frame, text="Graphs", font=("Segoe UI", 11, "bold")).pack(anchor="w")

        self.fig, (self.ax1, self.ax2) = plt.subplots(2, 1, figsize=(6, 5))
        self.fig.tight_layout(pad=2.0)

        self.canvas = FigureCanvasTkAgg(self.fig, master=graph_frame)
        self.canvas.get_tk_widget().pack(fill=BOTH, expand=True)

        bottom = Frame(self.root)
        bottom.pack(side=TOP, fill=BOTH, expand=False, padx=12, pady=6)

        self.confidence = ttk.Progressbar(bottom, orient="horizontal", length=400, mode="determinate", maximum=100)
        self.confidence.pack(side=LEFT)

        self.conf_label = Label(bottom, text="Confidence: 0.00%")
        self.conf_label.pack(side=LEFT, padx=10)

    def log(self, msg: str) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        line = f"[{ts}] {msg}\n"
        self.log_box.insert(END, line)
        self.log_box.see(END)

    def load_dataset(self) -> None:
        csv_path = filedialog.askopenfilename(
            title="Select event CSV",
            filetypes=[("CSV files", "*.csv"), ("All files", "*.*")],
        )
        if not csv_path:
            return

        df = pd.read_csv(csv_path)
        required = {"event_type", "timestamp", "value"}
        if not required.issubset(set(df.columns)):
            self.log("[WARN] CSV must contain event_type,timestamp,value columns")
            return

        df["timestamp"] = pd.to_numeric(df["timestamp"], errors="coerce")
        df = df.dropna(subset=["timestamp"]).sort_values("timestamp")

        self.loaded_events = [
            {
                "event_type": str(row.event_type),
                "timestamp": float(row.timestamp),
                "value": str(row.value),
            }
            for row in df.itertuples(index=False)
        ]

        self._rebuild_graph_series(df)
        self._draw_graphs()

        self.log(f"[INFO] Loaded dataset: {csv_path}")
        self.log(f"[INFO] Event rows: {len(self.loaded_events)}")
        self.predict_label.config(text="Prediction: Dataset loaded")

    def convert_pcapng(self) -> None:
        pcap_path = filedialog.askopenfilename(
            title="Select pcapng file",
            filetypes=[("PCAPNG files", "*.pcapng"), ("PCAP files", "*.pcap"), ("All files", "*.*")],
        )
        if not pcap_path:
            return

        default_name = Path(pcap_path).with_suffix(".csv").name
        out_path = filedialog.asksaveasfilename(
            title="Save converted CSV",
            defaultextension=".csv",
            initialfile=default_name,
            filetypes=[("CSV files", "*.csv")],
        )
        if not out_path:
            return

        try:
            self.log("[INFO] Converting pcapng to CSV...")
            saved = convert_pcapng_to_csv(Path(pcap_path), Path(out_path))
            self.log(f"[INFO] CSV saved: {saved}")
        except TsharkNotFoundError as exc:
            self.log(f"[WARN] {exc}")
        except Exception as exc:
            self.log(f"[WARN] Conversion failed: {exc}")

    def _rebuild_graph_series(self, df: pd.DataFrame) -> None:
        self.events_per_sec.clear()
        self.gap_series.clear()

        ts = df["timestamp"].to_numpy(dtype=float)
        if ts.size == 0:
            return

        for idx in range(1, len(ts)):
            self.gap_series.append(ts[idx] - ts[idx - 1])

        start = int(ts[0])
        end = int(ts[-1])
        for second in range(start, end + 1):
            count = int(((ts >= second) & (ts < second + 1)).sum())
            self.events_per_sec.append(count)

    def run_prediction(self) -> None:
        if not self.loaded_events:
            self.log("[WARN] Load a dataset first")
            return

        if self.engine is None:
            self.log("[WARN] Model not found. Train model first.")
            self.predict_label.config(text="Prediction: Model not loaded")
            return

        self.log("[INFO] Running windowed prediction (5-second windows)...")

        events = sorted(self.loaded_events, key=lambda e: float(e["timestamp"]))
        start_ts = events[0]["timestamp"]
        end_ts = events[-1]["timestamp"]

        current = start_ts
        last_result = None
        while current <= end_ts:
            next_ts = current + 5.0
            window = [e for e in events if current <= e["timestamp"] < next_ts]
            if len(window) >= 2:
                self.log("[INFO] Extracting features...")
                fv = extract_features_from_records(window).as_list()
                self.log("[INFO] Running model...")
                result = self.engine.predict(fv)
                last_result = result
                self.log(f"[RESULT] Device: {result['device']} ({result['confidence'] * 100:.2f}%)")
            current = next_ts

        if last_result is None:
            self.log("[WARN] Not enough events for prediction windows")
            return

        conf = last_result["confidence"] * 100
        self.predict_label.config(text=f"Prediction: {last_result['device']}")
        self.confidence["value"] = conf
        self.conf_label.config(text=f"Confidence: {conf:.2f}%")

    def clear_view(self) -> None:
        self.loaded_events.clear()
        self.events_per_sec.clear()
        self.gap_series.clear()
        self.log_box.delete("1.0", END)
        self.predict_label.config(text="Prediction: Waiting for data")
        self.confidence["value"] = 0
        self.conf_label.config(text="Confidence: 0.00%")
        self._draw_graphs()

    def _draw_graphs(self) -> None:
        self.ax1.clear()
        self.ax2.clear()

        x1 = np.arange(len(self.events_per_sec))
        self.ax1.plot(x1, list(self.events_per_sec), color="#1f77b4")
        self.ax1.set_title("Events per Second")
        self.ax1.set_ylabel("Count")

        x2 = np.arange(len(self.gap_series))
        self.ax2.plot(x2, list(self.gap_series), color="#d62728")
        self.ax2.set_title("Time Gaps")
        self.ax2.set_ylabel("Seconds")
        self.ax2.set_xlabel("Samples")

        self.fig.tight_layout(pad=2.0)
        self.canvas.draw_idle()


if __name__ == "__main__":
    root = Tk()
    app = DesktopApp(root)
    root.mainloop()
