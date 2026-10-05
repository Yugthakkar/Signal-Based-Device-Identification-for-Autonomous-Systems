from __future__ import annotations

import csv
import shutil
import subprocess
from pathlib import Path

FIELDS = [
    "frame.time_epoch",
    "frame.len",
    "usb.transfer_type",
    "usb.endpoint_address",
    "usb.data_len",
]


class TsharkNotFoundError(RuntimeError):
    pass


def _resolve_tshark() -> str:
    tshark = shutil.which("tshark")
    if tshark:
        return tshark

    # Fallback for common Windows Wireshark install paths.
    candidates = [
        Path("C:/Program Files/Wireshark/tshark.exe"),
        Path("C:/Program Files (x86)/Wireshark/tshark.exe"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return str(candidate)

    raise TsharkNotFoundError("tshark not found in PATH. Install Wireshark/tshark first.")


def convert_pcapng_to_csv(input_path: Path, output_path: Path) -> Path:
    tshark = _resolve_tshark()
    if not input_path.exists():
        raise FileNotFoundError(f"Input file not found: {input_path}")

    output_path.parent.mkdir(parents=True, exist_ok=True)

    cmd = [tshark, "-r", str(input_path), "-T", "fields"]
    for field in FIELDS:
        cmd += ["-e", field]
    cmd += ["-E", "header=n", "-E", "separator=,", "-E", "quote=d", "-E", "occurrence=f"]

    completed = subprocess.run(cmd, capture_output=True, text=True, check=True)
    lines = completed.stdout.strip().splitlines()

    with output_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["timestamp", "packet_size", "transfer_type", "endpoint", "raw_packet_size"])

        for line in lines:
            parts = [p.strip().strip('"') for p in line.split(",")]
            if len(parts) < len(FIELDS):
                parts.extend([""] * (len(FIELDS) - len(parts)))

            ts = parts[0]
            frame_len = parts[1]
            transfer_type = parts[2]
            endpoint = parts[3]
            usb_data_len = parts[4]
            packet_size = usb_data_len if usb_data_len else frame_len

            writer.writerow([ts, packet_size, transfer_type, endpoint, frame_len])

    return output_path
