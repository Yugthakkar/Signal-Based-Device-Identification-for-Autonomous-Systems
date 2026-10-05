from pathlib import Path

from pcapng_to_csv import convert_pcapng_to_csv


if __name__ == "__main__":
    base = Path(__file__).resolve().parents[1]
    outputs = [
        convert_pcapng_to_csv(
            base / "data" / "raw" / "keyboard_active_01.pcapng",
            base / "data" / "raw" / "keyboard_active_01.csv",
        ),
        convert_pcapng_to_csv(
            base / "data" / "raw" / "keyboard_idle_01.pcapng",
            base / "data" / "raw" / "keyboard_idle_01.csv",
        ),
    ]

    for out in outputs:
        print(out)
