"""Explicit feature-schema contracts.

Each model artifact declares which schema it was trained against (see its
model_metadata.json `schema` field). A prediction route must only accept a
feature vector whose length and order matches the schema of the loaded model;
InferenceEngine.predict() enforces this at runtime (see ml_service/inference.py).
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class FeatureSchema:
    name: str
    version: int
    modality: str
    feature_columns: tuple[str, ...]
    window_config: str
    description: str


USB_BEHAVIOR_V1 = FeatureSchema(
    name="usb_behavior_v1",
    version=1,
    modality="browser_input_behavior",
    feature_columns=(
        "event_rate",
        "avg_time_gap",
        "std_time_gap",
        "burst_density",
        "avg_packet_size",
        "movement_speed",
        "click_frequency",
        "key_press_rate",
    ),
    window_config="one feature vector per session (elapsed-time window, no fixed event count)",
    description=(
        "Behavioral features extracted from browser keydown/mousemove/click events "
        "(feature_engineering.extract_features). Used by the Live Demo page and the "
        "active runtime model. Current artifact is trained on a synthetic, clearly "
        "labelled session dataset (see data/usb/behavior/manifest.json) pending "
        "collection of real labelled browser sessions."
    ),
)

USB_PACKET_TIMING_V1 = FeatureSchema(
    name="usb_packet_timing_v1",
    version=1,
    modality="usb_packet_capture",
    feature_columns=(
        "packet_length",
        "transfer_type",
        "endpoint",
        "device",
        "time_gap",
        "packet_rate",
        "burst_flag",
    ),
    window_config="one feature vector per captured USB packet",
    description=(
        "Legacy packet-capture features from data/datasets/final_device_dataset.csv. "
        "Retained as an exploratory/legacy demonstration only: it embeds device and "
        "endpoint identifiers as features (a prediction shortcut) and uses a cumulative "
        "packet_rate column rather than a rate measured over a fixed duration. Not used "
        "as the active runtime model for new predictions."
    ),
)

CAN_TIMING_V1 = FeatureSchema(
    name="can_timing_v1",
    version=1,
    modality="can",
    feature_columns=(
        "frames_per_second",
        "gap_mean_ms",
        "gap_std_ms",
        "gap_min_ms",
        "burst_fraction",
        "unique_id_count",
        "id_entropy",
        "dlc_mean",
        "dlc_std",
        "dominant_id_fraction",
    ),
    window_config="non-overlapping 100ms windows, causal (uses only frames at/before window end)",
    description=(
        "Timing-only CAN intrusion-detection features from feature_engineering.can_features, "
        "trained on the HCRL Car-Hacking dataset with a per-capture chronological split."
    ),
)

SCHEMAS: dict[str, FeatureSchema] = {
    schema.name: schema
    for schema in (USB_BEHAVIOR_V1, USB_PACKET_TIMING_V1, CAN_TIMING_V1)
}


def get_schema(name: str) -> FeatureSchema:
    if name not in SCHEMAS:
        raise KeyError(f"Unknown feature schema: {name}. Known schemas: {sorted(SCHEMAS)}")
    return SCHEMAS[name]
