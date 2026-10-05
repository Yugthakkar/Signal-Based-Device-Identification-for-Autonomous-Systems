"""Convert HCRL Car-Hacking CSV files into a stable local CAN schema.

Raw data is deliberately kept outside Git.  This adapter accepts the column
names documented by HCRL and reports malformed rows instead of silently
turning them into training examples.

Supports two HCRL formats:
  1. Headerless comma-separated CSV (attack datasets):
     timestamp,can_id_hex,dlc,d0,d1,d2,d3,d4,d5,d6,d7,flag
  2. Space-delimited log format (normal_run_data.txt):
     Timestamp: 1479121434.850202  ID: 0350  000  DLC: 8  05 28 84 66 ...
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

import pandas as pd

CANONICAL_COLUMNS = ["timestamp_s", "can_id", "dlc", *[f"data_{i}" for i in range(8)], "flag", "capture_id", "attack_type"]

# Regex for the space-delimited log format used by normal_run_data.txt
# Example line: Timestamp: 1479121434.850202        ID: 0350    000    DLC: 8    05 28 84 66 6d 00 00 a2
_LOG_PATTERN = re.compile(
    r"Timestamp:\s*(\S+)\s+ID:\s*(\S+)\s+\S+\s+DLC:\s*(\d+)\s+(.*)",
    re.IGNORECASE,
)


def _column(df: pd.DataFrame, *names: str) -> pd.Series:
    lookup = {str(col).strip().lower(): col for col in df.columns}
    for name in names:
        if name.lower() in lookup:
            return df[lookup[name.lower()]]
    return pd.Series([None] * len(df), index=df.index)


def _parse_can_id(value: object) -> int | None:
    if pd.isna(value):
        return None
    text = str(value).strip().lower().replace("0x", "")
    try:
        return int(text, 16)
    except ValueError:
        return None


def infer_attack_type(path: Path) -> str:
    name = path.stem.lower()
    for key, label in (("dos", "dos"), ("fuzzy", "fuzzy"), ("gear", "gear_spoof"), ("rpm", "rpm_spoof"), ("normal", "normal"), ("attack_free", "normal")):
        if key in name:
            return label
    return "unknown"


def sha256_file(path: Path, chunk_size: int = 1_048_576) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(chunk_size), b""):
            digest.update(block)
    return digest.hexdigest()


def _detect_format(path: Path) -> str:
    """Detect whether file is headerless CSV or space-delimited log format."""
    with path.open("r", encoding="utf-8", errors="replace") as f:
        first_line = f.readline().strip()
    if first_line.lower().startswith("timestamp:"):
        return "log"
    # Check if it looks like comma-separated data (headerless CSV)
    parts = first_line.split(",")
    if len(parts) >= 10:
        return "csv_headerless"
    # Try reading as regular CSV with header
    return "csv_header"


def _parse_log_line(line: str) -> dict | None:
    """Parse a single space-delimited HCRL log line."""
    match = _LOG_PATTERN.match(line.strip())
    if not match:
        return None
    timestamp_str, can_id_hex, dlc_str, payload_str = match.groups()
    try:
        timestamp = float(timestamp_str)
        can_id = int(can_id_hex.replace("0x", ""), 16)
        dlc = int(dlc_str)
    except (ValueError, TypeError):
        return None
    if not (0 <= dlc <= 8):
        return None
    payload_bytes = payload_str.strip().split()
    data = []
    for i in range(8):
        if i < len(payload_bytes):
            try:
                data.append(int(payload_bytes[i], 16))
            except ValueError:
                data.append(0)
        else:
            data.append(0)
    return {
        "timestamp_s": timestamp,
        "can_id": can_id,
        "dlc": dlc,
        **{f"data_{i}": data[i] for i in range(8)},
        "flag": "R",  # Normal data has no injected frames
    }


def normalise_log_file(input_path: Path, output_dir: Path, chunk_size: int = 200_000) -> dict:
    """Normalise a space-delimited HCRL log file (e.g., normal_run_data.txt)."""
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}_normalised.csv"
    capture_id = input_path.stem
    attack_type = infer_attack_type(input_path)
    total = valid = malformed = 0
    first = True
    batch: list[dict] = []

    print(f"  [ADAPTER] Parsing log file: {input_path.name} (attack_type={attack_type})")
    with input_path.open("r", encoding="utf-8", errors="replace") as f:
        for line_num, line in enumerate(f, 1):
            total += 1
            parsed = _parse_log_line(line)
            if parsed is None:
                malformed += 1
                continue
            parsed["capture_id"] = capture_id
            parsed["attack_type"] = attack_type
            batch.append(parsed)
            valid += 1
            if len(batch) >= chunk_size:
                df = pd.DataFrame(batch, columns=CANONICAL_COLUMNS).sort_values("timestamp_s")
                df.to_csv(output_path, mode="w" if first else "a", header=first, index=False)
                first = False
                batch.clear()
                print(f"    ... processed {total:,} lines ({valid:,} valid, {malformed:,} malformed)")
    if batch:
        df = pd.DataFrame(batch, columns=CANONICAL_COLUMNS).sort_values("timestamp_s")
        df.to_csv(output_path, mode="w" if first else "a", header=first, index=False)
    print(f"  [ADAPTER] Done: {total:,} lines -> {valid:,} valid, {malformed:,} malformed")

    digest = sha256_file(input_path)
    return {"source": str(input_path), "output": str(output_path), "sha256": digest, "capture_id": capture_id, "attack_type": attack_type, "rows_total": total, "rows_valid": valid, "rows_malformed": malformed}


def normalise_headerless_csv(input_path: Path, output_dir: Path, chunk_size: int = 200_000) -> dict:
    """Normalise a headerless comma-separated HCRL CSV file.
    
    Expected column order: timestamp, can_id_hex, dlc, d0..d7, flag
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{input_path.stem}_normalised.csv"
    capture_id = input_path.stem
    attack_type = infer_attack_type(input_path)
    total = valid = malformed = 0
    first = True

    col_names = ["timestamp", "can_id", "dlc", *[f"data[{i}]" for i in range(8)], "flag"]
    print(f"  [ADAPTER] Parsing headerless CSV: {input_path.name} (attack_type={attack_type})")
    for chunk in pd.read_csv(input_path, chunksize=chunk_size, dtype=str, header=None, names=col_names, skipinitialspace=True):
        total += len(chunk)
        result = pd.DataFrame()
        result["timestamp_s"] = pd.to_numeric(chunk["timestamp"], errors="coerce")
        result["can_id"] = chunk["can_id"].map(_parse_can_id)
        result["dlc"] = pd.to_numeric(chunk["dlc"], errors="coerce")
        for i in range(8):
            result[f"data_{i}"] = pd.to_numeric(chunk[f"data[{i}]"], errors="coerce")
        result["flag"] = chunk["flag"].astype(str).str.strip().str.upper()
        result["capture_id"] = capture_id
        result["attack_type"] = attack_type
        ok = result["timestamp_s"].notna() & result["can_id"].notna() & result["dlc"].between(0, 8)
        malformed += int((~ok).sum())
        result = result.loc[ok, CANONICAL_COLUMNS].sort_values("timestamp_s")
        valid += len(result)
        result.to_csv(output_path, mode="w" if first else "a", header=first, index=False)
        first = False
        print(f"    ... processed {total:,} rows ({valid:,} valid, {malformed:,} malformed)")

    print(f"  [ADAPTER] Done: {total:,} rows -> {valid:,} valid, {malformed:,} malformed")
    digest = sha256_file(input_path)
    return {"source": str(input_path), "output": str(output_path), "sha256": digest, "capture_id": capture_id, "attack_type": attack_type, "rows_total": total, "rows_valid": valid, "rows_malformed": malformed}


def normalise_file(input_path: Path, output_dir: Path, chunk_size: int = 200_000) -> dict:
    fmt = _detect_format(input_path)
    print(f"  [ADAPTER] Detected format: {fmt} for {input_path.name}")
    if fmt == "log":
        return normalise_log_file(input_path, output_dir, chunk_size)
    elif fmt == "csv_headerless":
        return normalise_headerless_csv(input_path, output_dir, chunk_size)
    else:
        # Original CSV-with-header path
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / f"{input_path.stem}_normalised.csv"
        capture_id = input_path.stem
        attack_type = infer_attack_type(input_path)
        total = valid = malformed = 0
        first = True

        for chunk in pd.read_csv(input_path, chunksize=chunk_size, dtype=str, skipinitialspace=True):
            total += len(chunk)
            result = pd.DataFrame()
            result["timestamp_s"] = pd.to_numeric(_column(chunk, "timestamp"), errors="coerce")
            result["can_id"] = _column(chunk, "can id", "can_id").map(_parse_can_id)
            result["dlc"] = pd.to_numeric(_column(chunk, "dlc"), errors="coerce")
            for i in range(8):
                result[f"data_{i}"] = pd.to_numeric(_column(chunk, f"data[{i}]", f"data_{i}", f"data{i}"), errors="coerce")
            result["flag"] = _column(chunk, "flag").astype(str).str.strip().str.upper()
            result["capture_id"] = capture_id
            result["attack_type"] = attack_type
            ok = result["timestamp_s"].notna() & result["can_id"].notna() & result["dlc"].between(0, 8)
            malformed += int((~ok).sum())
            result = result.loc[ok, CANONICAL_COLUMNS].sort_values("timestamp_s")
            valid += len(result)
            result.to_csv(output_path, mode="w" if first else "a", header=first, index=False)
            first = False

        digest = sha256_file(input_path)
        return {"source": str(input_path), "output": str(output_path), "sha256": digest, "capture_id": capture_id, "attack_type": attack_type, "rows_total": total, "rows_valid": valid, "rows_malformed": malformed}


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalise HCRL CAN CSV files.")
    parser.add_argument("--input", nargs="+", required=True, help="One or more downloaded HCRL CSV/TXT files")
    parser.add_argument("--output_dir", default="data/can/processed")
    parser.add_argument("--manifest", default="data/can/manifests/dataset_manifest.json")
    parser.add_argument("--chunk_size", type=int, default=200_000)
    args = parser.parse_args()
    
    print(f"{'='*60}")
    print(f"  HCRL CAN Dataset Adapter")
    print(f"  Input files: {len(args.input)}")
    print(f"{'='*60}")
    
    records = []
    for raw in args.input:
        path = Path(raw)
        if not path.exists():
            print(f"  [WARN] File not found, skipping: {raw}")
            continue
        print(f"\n  Processing: {path.name} ({path.stat().st_size / 1e6:.1f} MB)")
        record = normalise_file(path, Path(args.output_dir), args.chunk_size)
        records.append(record)
    
    manifest = Path(args.manifest)
    manifest.parent.mkdir(parents=True, exist_ok=True)
    manifest.write_text(json.dumps({"format": "can_normalised_v1", "files": records}, indent=2), encoding="utf-8")
    
    print(f"\n{'='*60}")
    print(f"  Summary:")
    for r in records:
        print(f"    {Path(r['source']).name}: {r['rows_valid']:,} valid / {r['rows_total']:,} total ({r['attack_type']})")
    print(f"  Manifest: {manifest}")
    print(f"{'='*60}")


if __name__ == "__main__":
    main()
