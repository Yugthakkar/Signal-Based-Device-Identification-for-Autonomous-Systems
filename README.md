# Signal-Based Device Identification for Autonomous Systems

## Overview

Modern autonomous systems (robots, vehicles, industrial automation) rely heavily on external sensing devices such as cameras and microphones. These systems usually **trust device metadata** (device name, driver, vendor ID), which can be incorrect, faulty, or even malicious.

This project proposes a **behavior-based approach** to identify the actual type of a connected device using **electrical signals and raw device communication data**, instead of trusting metadata.

Currently, the system classifies:
- 📷 Camera
- 🎤 Microphone

using a **Vanilla Neural Network**, with scope to extend to other sensors in the future.

---

## Problem Statement

Autonomous systems today:
- Assume connected devices are correct
- Do not verify sensor behavior
- Are vulnerable to wrong or spoofed hardware

There is **no standard mechanism** to identify device type based on *how it behaves physically and digitally*.

---

## Proposed Solution

We build a system that:
1. Observes **raw device behavior** (USB data patterns)
2. Observes **electrical signals** (current, voltage, power)
3. Extracts meaningful statistical features
4. Uses a **neural network** to classify device type
5. Displays results via a **web dashboard**

---

## High-Level Architecture


---

## Data Collection Strategy

### Devices Used
- 1 Camera
- 1 Microphone
- ESP32 (optional, for power data)
- Laptop (USB capture)

### Device States
Each device is captured in:
- **Idle State**
- **Active State**

### Recording Strategy
- Duration per session: **30 seconds**
- Window size: **100 ms**
- Repetitions per state: **8–10 times**

Each 100 ms window becomes **one data sample**.

---

## Signals Collected

### 1. Raw Device Data (Laptop)
- USB packet size
- Packet count
- Packet timing
- Burst behavior

### 2. Electrical Signals (ESP32)
- Average current
- Maximum current
- Current variation
- Power spikes

⚠️ No audio or video content is recorded.

---

## Feature Set

### USB Behavior Features
- `packet_count`
- `avg_packet_size`
- `packet_size_std`
- `inter_arrival_mean`
- `burst_ratio`

### Electrical Features
- `avg_current`
- `max_current`
- `current_std`
- `power_spike_count`

### Label Encoding
- `1` → Camera
- `0` → Microphone

---

## Dataset Structure


---

## Machine Learning Model

### Model Type
- Feedforward (Vanilla) Neural Network

### Architecture

### Why Vanilla NN?
- Low-dimensional tabular data
- Fast inference
- Easy to explain
- Suitable for embedded / edge systems

---

## Training Strategy

- Normalize all features
- Split data **by session**, not randomly
- Balanced classes
- Loss: Binary Cross Entropy
- Optimizer: Adam

### Expected Performance
- Accuracy: **85–95%**
- Stable generalization across sessions

---

## User Interface (Web Dashboard)

### UI Purpose
The UI is built to **demonstrate and explain** the system, not to replace it.

### Screens
1. **Overview**
   - Project description
   - Architecture diagram

2. **Live Device Detection**
   - Start scan
   - Show detected device type
   - Confidence score

3. **Signal Visualization**
   - USB traffic over time
   - Power usage over time

4. **Model Summary**
   - Features used
   - Model type
   - Accuracy

5. **Dataset Summary**
   - Number of samples
   - Devices
   - States

---

## Demo Flow (For PPT / Viva)

1. Plug in camera
2. Click "Start Scan"
3. System detects: **Camera**
4. Unplug camera
5. Plug in microphone
6. Click "Start Scan"
7. System detects: **Microphone**

---

## Real-World Use Cases

### 1. Plug-and-Play Robotics
- Multi-vendor sensors
- Automatic sensor verification

### 2. Autonomous Vehicles
- Sensor sanity checks
- Safety validation

### 3. Hardware Security
- Detect spoofed devices
- Zero-trust hardware systems

### 4. Industrial Automation
- Early fault detection
- Predictive maintenance

---

## Advantages

- Does not rely on device metadata
- Vendor-agnostic
- Behavior-based verification
- Improves safety and security
- Extensible to other sensors

---

## Limitations

- Currently supports only camera & microphone
- Requires initial data collection
- USB-based devices only (for now)

---

## Future Scope

- Add LiDAR, IMU, depth cameras
- Unknown device detection
- Edge deployment (Raspberry Pi / ESP32)
- Online learning
- Real-time monitoring

---

## Key Takeaway

> Autonomous systems should trust **behavior**, not **labels**.

This project demonstrates a practical, scalable way to achieve that.

---

## Author

Final Year Project  
Domain: Autonomous Systems | Machine Learning | Hardware Intelligence




