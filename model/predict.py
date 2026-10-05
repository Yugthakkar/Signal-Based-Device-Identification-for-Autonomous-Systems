import argparse
from pathlib import Path

import pandas as pd

import sys

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.append(str(ROOT))

from feature_engineering.extract_features import extract_features_from_csv
from ml_service.inference import InferenceEngine


def main() -> None:
    parser = argparse.ArgumentParser(description="Predict device type from feature dataset or raw event CSV.")
    parser.add_argument("--model", default="../artifacts/device_classifier.pt")
    parser.add_argument("--meta", default="../artifacts/model_metadata.json")
    parser.add_argument("--features_csv", default=None, help="CSV with feature columns (single row)")
    parser.add_argument("--raw_csv", default=None, help="Raw event CSV to be featurized")
    args = parser.parse_args()

    if not args.features_csv and not args.raw_csv:
        raise ValueError("Provide either --features_csv or --raw_csv")

    engine = InferenceEngine(Path(args.model), Path(args.meta))

    if args.raw_csv:
        fv = extract_features_from_csv(Path(args.raw_csv)).as_list()
    else:
        df = pd.read_csv(args.features_csv)
        row = df.iloc[0]
        fv = [float(row[name]) for name in engine.feature_columns]

    result = engine.predict(fv)

    print(f"[RESULT] Detected Device: {result['device']}")
    print(f"[RESULT] Confidence: {result['confidence'] * 100:.2f}%")


if __name__ == "__main__":
    main()
