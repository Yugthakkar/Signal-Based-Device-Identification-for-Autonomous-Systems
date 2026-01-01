# Signal-Based Device Identification for Autonomous Systems

## Overview

Autonomous systems such as robots, autonomous vehicles, and industrial automation platforms rely on external sensing devices like cameras and microphones. Most current systems blindly trust device metadata such as device name, vendor ID, or driver type. This approach is unsafe and unreliable because metadata can be incorrect, faulty, or maliciously spoofed.

This project proposes a behavior-based device identification system that determines the actual type of a connected device using its electrical signals and raw device communication patterns, rather than relying on metadata.

Currently, the system supports classification of:
- Camera
- Microphone

The system is built using a Vanilla Neural Network and is demonstrated using a web-based dashboard.

---

## Problem Statement

Modern autonomous systems:
- Do not verify whether a connected sensor behaves like its claimed type
- Are vulnerable to faulty or spoofed peripherals
- Lack a vendor-agnostic sensor verification layer

There is no standard mechanism to identify device type based on physical and behavioral characteristics.

---

## Proposed Solution

The proposed system works as follows:
1. Capture raw device communication behavior (USB traffic)
2. Capture electrical signals such as current and power usage
3. Extract statistical features from short time windows
4. Train a neural network to classify device type
5. Visualize predictions and signals using a web dashboard

---

## System Architecture

Camera / Microphone  
↓  
Signal Acquisition Layer  
- USB Traffic (Laptop)  
- Electrical Signals (ESP32 + current sensor)  
↓  
Feature Extraction (100 ms time windows)  
↓  
Vanilla Neural Network  
↓  
Web Dashboard (Visualization & Demo)

---

## Data Collection Setup

Hardware Used:
- 1 Camera
- 1 Microphone
- Laptop for USB data capture
- ESP32 with current sensor (optional but recommended)

Only one device is connected at a time during data collection.

---

## Data Collection Strategy

Each device is recorded in two states:
- Idle state
- Active state

Recording parameters:
- Recording duration per session: 30 seconds
- Time window size: 100 ms
- Sessions per state: 8–10

Each 100 ms window is treated as one data sample.

Total dataset size: approximately 8,000–12,000 samples.

---

## Signals Captured

Raw Device Behavior (Laptop):
- USB packet count
- Packet size
- Packet timing
- Burst behavior

Electrical Signals (ESP32):
- Average current
- Maximum current
- Current variation
- Power spikes

No audio or image content is recorded.

---

## Feature Set

USB Behavior Features:
- packet_count
- avg_packet_size
- packet_size_std
- inter_arrival_mean
- burst_ratio

Electrical Features:
- avg_current
- max_current
- current_std
- power_spike_count

Labels:
- 1 → Camera
- 0 → Microphone

---

## Dataset Structure

dataset/
raw/
usb/
camera_idle/
camera_active/
mic_idle/
mic_active/
power/
camera/
mic/
processed/
dataset.csv

---

## Machine Learning Model

Model Type:
- Feedforward (Vanilla) Neural Network

Architecture:
Input Layer (8–10 features)  
→ Dense (64) + ReLU  
→ Dense (32) + ReLU  
→ Dense (1) + Sigmoid  

Training Details:
- Feature normalization
- Session-wise train/validation/test split
- Loss function: Binary Cross Entropy
- Optimizer: Adam

Expected accuracy: 85%–95%

---

## User Interface (Web Dashboard)

The web dashboard is designed to explain and demonstrate system behavior.

Dashboard Screens:
1. Project Overview
2. Live Device Detection
3. Signal Visualization
4. Model Summary
5. Dataset Summary

Live Demo Flow:
- Plug in camera → Start Scan → Detected: Camera
- Unplug camera
- Plug in microphone → Start Scan → Detected: Microphone

---

## Real-World Use Cases

1. Plug-and-Play Robotics  
Automatic sensor verification in multi-vendor robotic systems.

2. Autonomous Vehicles  
Sensor sanity checks for safety-critical driving systems.

3. Hardware Security  
Detection of spoofed or malicious peripherals.

4. Industrial Automation  
Early fault detection and predictive maintenance.

---

## Advantages

- Vendor-agnostic approach
- Does not rely on device metadata
- Behavior-based verification
- Improves system safety and reliability
- Easily extendable to additional sensors

---

## Limitations

- Currently supports only camera and microphone
- Requires initial data collection
- Limited to USB-based devices

---

## Future Scope

- Support for LiDAR, IMU, depth cameras
- Unknown device detection
- Edge deployment on Raspberry Pi or ESP32
- Real-time continuous monitoring
- Online learning and model updates

---

## Key Insight

Autonomous systems should trust behavior, not labels.

---

## Author

Final Year Project  
Domain: Autonomous Systems, Machine Learning, Hardware Intelligence
