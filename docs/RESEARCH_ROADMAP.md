# SBDI Research Roadmap

**Signal-Based Device Identification for Autonomous Systems: from a two-class prototype to a research-grade final-year project.**

Prepared 2026-09-09. The project name and core idea are fixed; everything below is about making that idea carry real scientific and industrial weight with almost no budget.

---

## 0. The thesis in one paragraph

An autonomous fleet-management system that supervises devices from several vendors cannot trust the identity a device *declares*. A USB peripheral declares a vendor/product ID that any three-dollar microcontroller can forge. A warehouse robot speaking VDA 5050 or MassRobotics identifies itself by a serial number in an MQTT topic string, with no protocol security. A ROS 2 robot's DDS participant declares a `vendorId` and GUID that any process joining the domain can copy, and recent Unitree exploits show that any device on DDS domain 0 can publish. SBDI's claim is that a device's **timing signal** (inter-arrival times, message cadence, packet sizes, clock behaviour) is an identity it cannot easily forge, and that one learned pipeline can (1) identify device type, vendor and instance from timing alone, (2) reject unknown or rogue devices (open-set), (3) enrol a new vendor's device from seconds of traffic (few-shot), (4) give calibrated confidence and abstain when unsure, and (5) be trained across companies without sharing raw traffic (federated). This is exactly the "device analytics and measured deviations from observed usage" input that NIST SP 800-207 lists for a zero-trust policy engine, applied to a domain (robot middleware) where no commercial product has coverage.

---

## 1. Honest audit of the current prototype

Everything below was verified by reading the code and running it in the project's virtual environment.

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| 1 | **Label leakage in features.** `device` (USB device address) and `endpoint` are used as inputs. They are effectively the label. `packet_rate` is a cumulative packet counter (1, 2, 3, …, 126), which encodes position in the capture, not behaviour. | `data/datasets/final_device_dataset.csv`, `model/train.py` `DEFAULT_FEATURE_SETS[1]` | Any accuracy reported is leakage, not learning. An examiner who spots this will discount the whole model. |
| 2 | **Temporal leakage in the split.** Rows are individual USB packets from about four captures, shuffled and split randomly. Adjacent packets from the same capture land in train and test. | `split_train_test()` in `model/train.py` | Test accuracy is inflated; nothing is known about generalisation to a new session. |
| 3 | **Tiny, extremely imbalanced data.** 2,909 rows: 2,609 `mouse_active` (90%), 264 `keyboard_active`, 18 `keyboard_idle`, 18 `mouse_idle`. | label counts | Focal loss and weighted sampling cannot fix a dataset with four sessions. |
| 4 | **Feature-schema mismatch (bug).** The saved model was trained on the 7 USB-packet columns, but `/predict` with `events` builds the 8 behavioural features. Predicting from events raises `ValueError: operands could not be broadcast together with shapes (1,8) (7,)`. | `ml_service/main.py` `predict()`, `ml_service/inference.py` | The Live Demo and desktop windowed prediction cannot work against the shipped model. |
| 5 | **Event-name mismatch (bug).** The browser Live Demo sends `keydown` / `mousemove` / `click`; the extractor expects `key_press` / `mouse_move` / `mouse_click`. | `web/frontend/src/app/pages/LiveDemo.tsx`, `feature_engineering/extract_features.py` | `movement_speed`, `click_frequency`, `key_press_rate` are always 0 from the browser path. |
| 6 | **Evaluation is accuracy only.** No baselines, no confusion matrix, no confidence intervals, no cross-session test, no calibration. | `evaluate()` in `model/train.py` | Not publishable and not defensible in a viva. |
| 7 | **No connection to autonomous systems** beyond the name. | whole repo | The title over-promises relative to what is shown. |

**What is worth keeping.** The capture path (USBPcap → tshark → CSV), the FastAPI service and Supabase schema (sessions, windows, feedback, uploads), the React dashboard shell, the Tkinter capture tool, and the imbalance-aware training loop are all reusable scaffolding. The work is to put real science inside them.

---

## 2. Reframing the project (name unchanged)

### 2.1 Problem statement

Given only the timing and size signal of a device's traffic (no payload, no declared identifiers), decide *what* the device is, *whether* it is one of the fleet's enrolled devices, and *how sure* we are, quickly enough to gate admission to an autonomous system.

### 2.2 Threat model

- **Declared-identity spoofing.** An attacker forges the USB VID/PID, the DDS `vendorId`/GUID, the VDA 5050 serial-number topic, or the MAVLink `HEARTBEAT` system ID.
- **Keystroke injection.** A scripted HID device (Rubber Ducky, Digispark, Pico) presents as a keyboard and types commands.
- **Rogue fleet participant.** A process joins the DDS domain or MAVLink link and publishes commands or telemetry as if it were a known robot.
- **Adaptive timing mimicry.** The attacker randomises or replays human/robot timing to evade a timing fingerprint (Malboard 2019, QUACK 2026, "Cloaking the Clock" 2018).
- **Benign drift.** A legitimate device changes behaviour after a firmware update or a QoS change. The system must not raise a rogue alarm for it.

### 2.3 Three signal layers of an autonomous system

| Layer | Signal | Real or simulated | Why it belongs under the project name |
|---|---|---|---|
| **L1 Operator peripheral** (USB HID) | USB interrupt-transfer inter-arrival times, report sizes, key hold/flight times | Real hardware, already captured | The operator console is the entry point to the fleet; keystroke injection is 20% of ICS initial-access vectors (removable media, 2024). |
| **L2 Vehicle bus** (CAN) | Per-arbitration-ID inter-arrival times, clock offset and skew | Real, free public datasets from 3 to 4 vehicles | The autonomous vehicle's internal network; sender identification is the canonical timing-fingerprint problem (Cho & Shin 2016). |
| **L3 Fleet middleware** (ROS 2 / DDS, MAVLink) | RTPS heartbeat and ACKNACK cadence, inter-packet delay distributions, MAVLink message cadence | Simulated fleet on a laptop (Gazebo, Webots, PX4/ArduPilot SITL) plus 120k+ real PX4 flight logs | This is the "multiple companies' robots under one system" vision, made concrete and free. |

Doing all three with **one pipeline** is the unifying contribution. If time is short, L1 + L3 is the minimum that still honours the title.

### 2.4 Research questions

- **RQ1 Identifiability.** Can timing-only signals identify device type, vendor and instance at each layer, with no declared identifiers and no payload?
- **RQ2 Generalisation.** Do fingerprints survive a change of session/day, host machine, vehicle, simulator, or DDS vendor? (Published fingerprint accuracies collapse from 99% to 9–36% under such shifts; this is the known weakness.)
- **RQ3 Open-set and enrolment.** Can the system reject a device it has never seen, and enrol a new vendor's device from 5–20 windows?
- **RQ4 Adversarial robustness.** How does detection degrade as the attacker's timing mimicry gets more sophisticated (fixed delay → random → histogram-mimic → replay of real timings)?
- **RQ5 Deployability.** Can calibrated abstention, federated training and sub-millisecond edge inference make this usable as a zero-trust admission control in a multi-company fleet?

### 2.5 Contributions you can claim

1. **First physical-HID-in-the-loop keystroke-injection dataset.** The most recent work (QUACK, Padua, arXiv 2604.15845, revised 7 Sep 2026) evaluates only synthetic timings and explicitly lists USB polling, firmware and OS timing as omitted effects. You already have the capture pipeline; a Digispark closes the gap.
2. **Cross-layer consistency check.** Nobody compares bus-level USB timing with browser `event.timeStamp` for the same input. Cheap, novel, and directly reuses your two capture paths.
3. **First vendor-agnostic robot fingerprint from DDS timing**, evaluated across Fast DDS, Cyclone DDS (and Connext if licensed), across two simulators, with a released dataset. No public multi-vendor ROS 2 identification dataset exists.
4. **Open-set, timing-only CAN sender identification with cross-vehicle evaluation.** The only open-set precedent (2025) uses voltage; timing is unclaimed.
5. **A unified evaluation protocol** (session-grouped CV, cross-day/host/vehicle/vendor tests, adaptive-attacker curves, calibration and abstention) applied identically across three layers.
6. **A deployable artefact**: a fleet admission console with enrol/identify/reject/abstain, a federated training mode, and measured edge latency.

---

## 3. Literature map: what exists and what is open

### 3.1 USB / HID fingerprinting and keystroke injection

- Bates et al., *Leveraging USB to Establish Host Identity Using Commodity Devices*, NDSS 2014. Enumeration-timing fingerprints of hosts. Your project is the mirror image. https://www.cise.ufl.edu/~butler/pubs/ndss14.pdf
- Tian et al., *GoodUSB*, ACSAC 2015; *USBFILTER*, USENIX Security 2016; *SoK: Plug & Pray Today*, IEEE S&P 2018. Threat model, packet-level capture points, taxonomy for related work. https://oaklandsok.github.io/papers/tian2018.pdf
- Neuner et al., *USBlock*, IFIP DBSec 2018. Temporal characteristics of USB traffic to flag Rubber Ducky; your closest baseline. https://inria.hal.science/hal-01954405
- Kharraz et al., *USBESAFE*, RAID 2019. One-class SVM on benign USB traces. https://www.usenix.org/system/files/raid2019-kharraz_0.pdf
- Denney et al., *USB-Watch*, SecureComm 2019. Inline hardware monitor with a decision tree on HID-report timing; template for a Pico-based inline monitor. https://csl.fiu.edu/wp-content/uploads/2023/05/usb_watch_kyle.pdf
- Cronin et al., *Time-Print*, IEEE S&P 2022. Per-unit timing identity of flash drives; shows instance-level identification is achievable. https://xgao-work.github.io/paper/sp22.pdf
- Spolaor et al., *Plug and Power (PowerID)*, INFOCOM 2023, dataset of 82 peripherals. Type/model/instance hierarchy. https://zenodo.org/records/7467990
- Farhi et al., *Malboard*, Computers & Security 2019. Injector mimicking the victim's rhythm evades commercial keystroke biometrics. Your adversary model. https://www.sciencedirect.com/science/article/abs/pii/S0167404818309957
- Chillara et al., adversarial poisoning of USB-keyboard detectors (IJIS 2024), *USB-GATE* (IJIS 2025), GAN-augmented transformer defender (ICDCN 2025). Adversarial-training recipe. https://link.springer.com/article/10.1007/s10207-025-00997-2
- Lotto, Marchiori, Conti, *QUACK! Making the (Rubber) Ducky Talk*, arXiv Apr 2026 (rev. Sep 2026). Hold/flight-time detectors vs PRNG, statistical and WGAN-GP attackers; RF AUC > 0.9 at 70 keys; **no physical HID captures**. https://arxiv.org/abs/2604.15845
- Public keystroke/mouse data: CMU benchmark (51 subjects) https://www.cs.cmu.edu/~keystroke/ ; Aalto 136M keystrokes (1.4 GB) https://userinterfaces.aalto.fi/136Mkeystrokes/ ; KeyRecs (Zenodo) https://zenodo.org/records/7886743 ; Balabit mouse https://github.com/balabit/Mouse-Dynamics-Challenge ; SapiMouse/SapiAgent (human vs bot) https://github.com/margitantal68/sapimouse ; BeCAPTCHA-Mouse (licence) https://github.com/BiDAlab/BeCAPTCHA-Mouse

**Open:** physical capture with real injectors; cross-layer (USB vs OS) timing; open-set device typing; cross-host transfer; adaptive-attacker curves on real hardware.

### 3.2 CAN bus sender identification

- Cho & Shin, *Fingerprinting ECUs for Vehicle Intrusion Detection (CIDS)*, USENIX Security 2016. Clock offset/skew features; the canonical timing fingerprint. https://www.usenix.org/system/files/conference/usenixsecurity16/sec16_paper_cho.pdf
- Cho & Shin, *Viden*, CCS 2017. "Identify the sender, not just detect." https://arxiv.org/abs/1708.08414
- Sagong et al., *Cloaking the Clock*, ICCPS 2018; Ying et al., *Shape of the Cloak*, TIFS 2019. Skew-emulation attacks: your robustness protocol. https://arxiv.org/abs/1710.02692
- Kulandaivel et al., *CANvas*, USENIX Security 2019 (code on GitHub). Maps arbitration IDs to physical ECUs with < $50 hardware. https://github.com/sekarity/canvas
- Kneib et al., *EASI*, NDSS 2020. < 100 µs sender ID on a microcontroller; the edge budget to beat.
- Tang et al., *ERACAN*, CCS 2024 (Distinguished Paper). Current SOTA threat model.
- Zhao et al., open-set CAN recognition via metric learning, CAEE 2025. Voltage-based; timing open-set is unclaimed.
- Liu et al., *MIDS* (bidirectional Mamba), arXiv Jun 2026. Newest masquerade baseline. https://arxiv.org/abs/2606.18599
- Datasets (all free): HCRL Car-Hacking https://ocslab.hksecurity.net/Datasets/car-hacking-dataset ; HCRL Survival (3 vehicles) https://ocslab.hksecurity.net/Datasets/survival-ids ; ORNL ROAD https://0xsam.com/road/ ; can-train-and-test (4 vehicles) https://bitbucket.org/brooke-lampe/can-train-and-test ; CAN-MIRGU (autonomous-capable car, CC BY) https://archive.ics.uci.edu/dataset/1035/can-mirgu ; GEM-CAN 2026 (autonomous EV) https://doi.org/10.5281/zenodo.19161139

**Key fact:** no free CAN dataset has true per-ECU labels; arbitration ID is the accepted proxy. State this openly.

### 3.3 IoT and robot traffic fingerprinting

- Miettinen et al., *IoT Sentinel*, ICDCS 2017 (identify-then-constrain architecture). Marchal et al., *AuDI*, JSAC 2019 (identify from periodic timing, unsupervised): the closest analogue of "identify from timing, not declared ID". https://research.aalto.fi/en/publications/audi-toward-autonomous-iot-device-type-identification-using-perio/
- Sivanathan et al., UNSW IoT traces, IEEE TMC 2019. https://www2.ee.unsw.edu.au/~hhabibi/pubs/jrnl/19TMC.pdf
- Kostas et al., *IoTDevID* (IoT-J 2022, code) and *GeMID* (2025): flow statistics encode the network, not the device, and fail to transfer across testbeds. Your argument for timing features and cross-testbed evaluation. https://arxiv.org/abs/2411.14441
- Maali et al., NDSS 2025: systematic degradation study of device-ID models. The evaluation attributes to replicate. https://www.ndss-symposium.org/wp-content/uploads/2025-118-paper.pdf
- Ciechonski et al., early-stage identification (first seconds suffice), 2026. Justifies short enrolment. https://arxiv.org/abs/2605.02449
- Tang et al., *Fingerprinting Collaborative Robot Network Traffic*, ARES 2025. The only peer-reviewed robot-traffic fingerprinting paper. https://arxiv.org/abs/2312.06802
- Gonzales et al., *Practical Zero-Trust for Mission-Critical Robotic Fleets via Hardware Attestation and Packet Timing Watermarking*, arXiv Sep 2026. Inter-packet-delay statistics as identity on a ROS 2 fleet; heterogeneous fleets and UAVs left as future work. https://arxiv.org/abs/2609.05741
- Kronauer et al., arXiv 2101.02074: ROS 2 latency differs by DDS vendor (Fast DDS, Cyclone, Connext). Evidence that timing fingerprints the vendor.
- Maggi et al., *A Security Analysis of the DDS Protocol*, Trend Micro/Alias 2022: 13 CVEs, exposed DDS on the internet; RTPS `vendorId` is declared and must not be trusted. https://documents.trendmicro.com/assets/white_papers/wp-a-security-analysis-of-the-data-distribution-service-dds-protocol.pdf
- Crnovrsanin et al., *Predicting UAV Type* from 29,362 PX4 ULogs, 2024 (data and code on OSF). A free "vehicle type from telemetry" baseline. https://arxiv.org/abs/2403.00565
- Datasets: Aalto IoT Sentinel captures ; UNSW IoT traces (MIT-0) https://iotanalytics.unsw.edu.au/iottraces.html ; ROSIDS23 (ROS 1 pcaps) DOI 10.5281/zenodo.10014434 ; ROSPaCe (ROS 2) https://github.com/TommasoPuccetti/rospace_dataset ; PX4 Flight Review logs https://logs.px4.io/browse ; UAV Attack Dataset (PX4 ULog) https://ieee-dataport.org/open-access/uav-attack-dataset ; MAVLink message-ID sequence dataset (HCRL) https://ocslab.hksecurity.net/Datasets/mavlink-message-id-sequence-dataset
- Free simulators: TurtleBot3 Gazebo (Humble/Jazzy), webots_ros2 (TurtleBot, TIAGo, UR, Mavic, Crazyflie), PX4 SITL + Gazebo, ArduPilot SITL, Open-RMF demos (multi-fleet worlds). Wireshark has a built-in RTPS dissector and an official MAVLink Lua dissector.

**Open:** vendor-agnostic robot fingerprint from DDS timing; cross-middleware/cross-simulator generalisation; open-set rejection of `vendorId` spoofers; few-shot vendor enrolment; a released multi-vendor dataset.

### 3.4 RF fingerprinting (optional stretch)

ORACLE (INFOCOM 2019), WiSig (2022), LoRa RFFI (JSAC 2021 / TIFS 2022, triplet-loss enrolment), and 2025–2026 cross-day and open-set work. Verdict: feasible on CPU with WiSig ManySig (1.4 GB) or the 254 MB ADS-B set; a $30 RTL-SDR cannot reach 2.4 GHz and should not be core. Treat as a stretch chapter only. https://cores.ee.ucla.edu/downloads/datasets/wisig/

### 3.5 Methods

- Sequence classification on small data: MiniRocket (KDD 2021), MultiRocket + Hydra (2022–2023), the 2024 "bake off redux" showing they match large ensembles and beat deep nets on small data; InceptionTime and TCN as deep comparators; all in the `aeon` library. https://arxiv.org/abs/2012.08791 , https://arxiv.org/abs/2304.13029
- Open-set: OpenMax (CVPR 2016), energy-based OOD (NeurIPS 2020), Mahalanobis (NeurIPS 2018); domain examples C²T-OpenMax (Sep 2026) and "From Flows to Functions" (Dec 2025).
- Few-shot enrolment: Prototypical Networks (NeurIPS 2017) and Siamese nets applied to device fingerprints.
- Federated: FL4IoT (ACM TIoT 2023), Sánchez Sánchez et al. timing-based device-model ID under FL (2021), Flower framework with FedAvg/FedProx baselines. https://arxiv.org/abs/2111.14434
- Calibration and abstention: temperature scaling and ECE (Guo 2017), deep ensembles, conformal prediction (Angelopoulos & Bates 2021). Ovadia et al. 2019 show temperature scaling degrades under shift, so ensembles are needed for cross-day.
- Evaluation rigour: Arp et al., *Dos and Don'ts of ML in Computer Security*, USENIX Security 2022; TESSERACT (2019); Kolcun et al. on fingerprint decay over weeks. https://arxiv.org/abs/2010.09470
- Edge: Hussain et al. 73 KB TFLite fingerprint model on Raspberry Pi (2024); ONNX Runtime int8 quantisation.
- Explainability: SHAP on features, Integrated Gradients and TimeSHAP on sequences.

### 3.6 Industry and standards anchors

- NIST SP 800-207 zero-trust: policy decisions use "device analytics and measured deviations from observed usage patterns". https://csrc.nist.gov/pubs/sp/800/207/final
- CISA Zero Trust Maturity Model v2, Devices pillar: Advanced = anomaly detection of unauthorised devices; Optimal = continuous, automated, correlated with identity. https://www.cisa.gov/zero-trust-maturity-model
- IEEE 802.1AR DevID, Matter attestation, NIST SP 1800-36 onboarding: all cryptographic and onboarding-time; SBDI is the continuous, behavioural complement.
- VDA 5050 v3 (MQTT topic `interfaceName/majorVersion/manufacturer/serialNumber/topic`, state every ≤ 30 s, "protocol security is not addressed") and MassRobotics AMR Interop v1.0 and Open-RMF fleet adapters: self-declared identity with no authentication. https://github.com/VDA5050/VDA5050 , https://www.open-rmf.org/
- ISO/SAE 21434 + UNECE R155 (continuous monitoring duty), IEC 62443-4-2 CR 1.2 (device identification and authentication), EU Cyber Resilience Act (applies Dec 2027), EU Machinery Regulation (Jan 2027, tamper evidence), EU AI Act logging.
- Incidents: DeMarinis et al. exposed ROS hosts (ICRA 2019); Trend Micro DDS study; UniPwn (Sep 2025) and CVE-2026-27509 (Feb 2026, any device on DDS domain 0 can publish to a Unitree Go2); CISA/FBI guidance on foreign UAS; Remote ID spoofing.
- Commercial analogues (none cover robot middleware): Armis, Forescout eyeSight, Palo Alto Device Security (instance-level profiling), Cisco ISE, Claroty, Nozomi (2–4 week passive baseline; flags "unusual timing").

---

## 4. The three tracks in detail

### Track A — Operator peripheral (USB HID). Real hardware. Extends what exists.

**Hardware (≈ $5).** One Digispark ATtiny85 (DigiKeyboard library) or Raspberry Pi Pico (CircuitPython `adafruit_hid`). Both present as a USB keyboard and let you script inter-keystroke delays exactly. Optional: a second cheap keyboard and mouse from friends for instance-level experiments.

**Data collection protocol.**
- Participants: at least 5 people (friends, classmates), each 2 sessions on different days. Record timings only, never key values (ethics; see §12).
- Devices: at least 3 keyboards and 3 mice (different models), on at least 2 host machines or USB hubs (cross-host test).
- Tasks per session: fixed-text typing (reuse the CMU ".tie5Roanl" style), free typing, web browsing, a short game. 3–5 minutes each.
- Capture simultaneously at two layers with a shared clock: USB layer (USBPcap → tshark; keep `frame.time_epoch`, `frame.len`, `usb.transfer_type`, `usb.endpoint_address`, `usb.data_len`; discard `usb.device_address` from features) and OS layer (browser `event.timeStamp` or `pynput`). The cross-layer comparison is Contribution 2.
- Injection sessions with attacker levels: L0 fixed delay; L1 uniform random delay; L2 delays sampled from a human hold/flight histogram fitted on Aalto/CMU data; L3 replay of a real participant's timings. Vary window sizes 10–200 keys as in QUACK.

**Tasks and labels.** (i) device type: keyboard / mouse / emulated HID; (ii) device instance among the enrolled keyboards; (iii) human vs scripted; (iv) open-set: an unseen keyboard model; (v) cross-host.

**Features and models.** Raw inter-arrival-time (IAT) sequences of interrupt-IN transfers (note the USB polling quantum: 8 ms for low-speed HID, 1 ms for full-speed, which is itself a fingerprint of the device class), report-size sequences, hold/flight from key events; windowed statistics as the tabular baseline. Models per §5.

### Track B — Vehicle bus (CAN). Real, free data. Same pipeline, new domain.

**Data.** HCRL Survival (Sonata, Soul, Spark), can-train-and-test (Forester, Silverado, Traverse, Impala), ORNL ROAD ambient captures, CAN-MIRGU.

**Task.** Predict the sender (arbitration ID as ECU proxy; cluster IDs by clock-skew similarity following CIDS/CANvas for an ECU-level label) from timing only: per-ID IAT sequences, CIDS clock offset and skew, jitter statistics. Never use the ID or payload as an input.

**Experiments.** Closed-set sender ID; open-set (hold out IDs as "unknown"); cross-vehicle (train on N vehicles, test on an unseen one); cloaking robustness (delay spoofed frames to emulate the target's skew, per Sagong 2018 and Ying 2019, and measure the AUC drop).

### Track C — Fleet middleware (ROS 2 / DDS and MAVLink). Simulated fleet, real protocol stacks, plus real flight logs.

**Environment.** Ubuntu 22.04/24.04 in WSL2 (Gazebo runs under WSLg) or a VirtualBox VM, or the official `osrf/ros` Docker images. ROS 2 Humble or Jazzy.

**"Vendors" you can create for free.**
- RMW/DDS implementations: `rmw_fastrtps_cpp` (Fast DDS), `rmw_cyclonedds_cpp` (Cyclone DDS), and `rmw_connextdds` if a Connext evaluation licence is available. Kronauer et al. show they differ in latency behaviour.
- Robot platforms: TurtleBot3 burger and waffle (Gazebo), TIAGo / UR / Mavic 2 Pro / Crazyflie (Webots via `webots_ros2`), x500 quadcopter / VTOL / rover (PX4 SITL), copter / rover (ArduPilot SITL).
- Fleet orchestration: Open-RMF demos (office, hotel, airport worlds) to run several fleets under one manager, which is literally the original vision.
- Real telemetry: PX4 Flight Review ULogs (bulk download script in the `flight_review` repo), filtered by airframe, to replicate and extend the 2024 UAV-type baseline with open-set evaluation.

**Capture.** `tshark` on the loopback/bridge with the RTPS dissector: `frame.time_epoch`, `frame.len`, `udp.length`, `rtps.sm.id` (DATA, HEARTBEAT, ACKNACK, GAP), `rtps.guidPrefix` and `rtps.vendorId` for **labels only**. MAVLink via the official Lua dissector: message ID, sequence, length, with system ID for labels only.

**Attack scenarios.** A rogue participant joins domain 0 and publishes with a copied `vendorId`/GUID (the CVE-2026-27509 pattern); a replayed capture; a benign "firmware update" that changes publish rate or QoS (must not trigger a rogue alarm).

**Tasks.** Identify platform, instance and DDS vendor from timing; reject the rogue; enrol a new platform from 30 s of traffic; detect and adapt to benign drift.

**Release.** Package the pcaps, CSVs and capture scripts as an open dataset on Zenodo (CC BY). No such dataset exists today.

**Simulation validity (say it in the paper).** Simulated timing is not real hardware timing. Mitigate by making claims about middleware/vendor-level fingerprints, by evaluating across two simulators, and by pairing L3 with the real-hardware signals of L1 and L2.

### Track D — RF fingerprinting (stretch only)

If Tracks A–C finish early: WiSig ManySig (1.4 GB) closed-set, cross-receiver and cross-day with the ORACLE-style 76k-parameter 1D CNN. Do not buy an SDR for this.

---

## 5. One method stack for all layers

```
signal capture ──► windowing ──► two representations ──► models ──► decisions
(USB / CAN / RTPS /   (N events or   (a) tabular timing     MiniRocket+ridge   identify (closed-set)
 MAVLink / ULog)       T seconds)        features            TCN / InceptionTime reject   (open-set)
                                       (b) raw IAT + size    prototypical       enrol    (few-shot)
                                           sequences         embedding          abstain  (calibration)
```

- **Primary classifier:** MiniRocket (or MultiRocket + Hydra) features with a ridge/logistic head. Deterministic, seconds on CPU, no tuning, and the 2024 benchmark justifies it over deep nets on small data.
- **Deep comparator:** a small TCN or InceptionTime on raw IAT sequences (tens of thousands of parameters; CPU-trainable).
- **Tabular baselines:** logistic regression, random forest, gradient boosting, kNN on the windowed statistics. Your current MLP becomes one baseline among several.
- **Open-set:** train an embedding with prototypical loss; reject with Mahalanobis distance or energy score; OpenMax as the classical baseline. Report AUROC and OSCR against held-out device classes.
- **Few-shot enrolment:** prototypes from 5/10/20 windows of the new device; kNN in embedding space, no retraining.
- **Calibration and abstention:** temperature scaling on a session-disjoint calibration split; report ECE; a 5-seed ensemble for cross-day; split-conformal prediction sets, abstain when the set has more than one class.
- **Federated mode:** Flower simulation on one CPU; clients = participants (L1), vehicles (L2), or vendors/fleets (L3); FedAvg vs FedProx vs the centralised ceiling; non-IID by device; one label-flipping client to test robustness.
- **Adaptive attacker curve:** detection AUC vs attacker level L0–L3.
- **Explainability:** SHAP on tabular features; Integrated Gradients on IAT sequences; show which timing quanta drive a decision.
- **Edge:** export to ONNX, int8 quantise, report per-window latency on the laptop CPU and, if available, a Raspberry Pi; compare against VDA 5050's 30 s state cadence and EASI's 100 µs budget.

---

## 6. Evaluation protocol (non-negotiable)

1. **Splits:** `GroupKFold` by capture session, never random per-row. Held-out **cross-day**, **cross-host**, **cross-vehicle**, **cross-simulator/vendor** test sets.
2. **Metrics:** macro-F1 and balanced accuracy (imbalance), per-class confusion matrices, ROC-AUC with DeLong test, 1,000-sample bootstrap confidence intervals; AUROC/OSCR for open-set; ECE and coverage/set-size for calibration; latency percentiles.
3. **Ablations:** tabular features vs raw sequences; window length (10–200 events / 1–30 s); model family; with and without the declared-ID columns (to quantify how much the old model was cheating).
4. **Baselines:** the current MLP, the classical fingerprint features (CIDS for CAN, USBlock thresholds for HID, IoTDevID features for traffic), DuckHunt-style speed threshold for injection.
5. **Reproducibility:** fixed seeds, Hydra configs per experiment, MLflow run tracking, DVC for datasets, a single `make reproduce` target, and the NeurIPS reproducibility checklist in the appendix.

---

## 7. Target system architecture

```
sbdi/
  capture/      usbpcap.py  can_loader.py  rtps_capture.py  mavlink_capture.py  ulog_loader.py
  features/     windows.py  timing_features.py  sequences.py  schema.py   # one canonical event schema
  models/       rocket.py  tcn.py  protonet.py  baselines.py
  openset/      mahalanobis.py  energy.py  openmax.py
  calib/        temperature.py  conformal.py  ensemble.py
  fl/           flower_client.py  flower_server.py  partitions.py
  eval/         splits.py  metrics.py  attacker_curve.py  report.py
  service/      api.py  policy.py   # /enroll /identify /fleet/state /drift /federated/status
  configs/      hydra yaml per track and experiment
  scripts/      reproduce.sh  collect_hid.py  run_fleet_sim.sh
```

- **Policy engine (NIST 800-207 style):** trust score = f(identity match, calibrated confidence, drift score) → `allow` / `quarantine` / `deny`, every decision logged with the evidence (AI Act logging angle).
- **API:** keep `/predict` for the HID demo; add `/enroll` (few-shot), `/identify` (returns class, confidence, conformal set, unknown flag, abstain flag), `/fleet/state` (declared identity vs fingerprint identity per device), `/drift`, `/federated/status`.
- **Frontend:** rename the dashboard the **Fleet Admission Console**: device inventory with declared vs fingerprinted identity, live IAT raster per device, rejection and abstention events, enrolment wizard, federated round progress. Keep the Live Demo page for the HID track, with the event-name bug fixed.
- **Desktop tool:** becomes the capture and labelling app for Track A.
- **Supabase:** add `devices`, `enrollments`, `decisions` (with evidence JSON) and `audit_log` tables alongside the existing prediction tables.

---

## 8. Sixteen-week plan

Phases are a genuine sequence; tracks inside them can overlap.

| Weeks | Phase | Deliverable |
|---|---|---|
| 1–2 | **0 Foundation.** Remove leaky features; canonical event schema; fix the 7-vs-8 feature mismatch and the browser event names; session-grouped CV; baselines and full metrics; Hydra + MLflow + DVC skeleton; re-run the existing data honestly. | A short "before/after" table showing what the old model really scored. Repo restructured. |
| 2–5 | **1 Track A.** Order Digispark/Pico; write injection firmware for L0–L3; collect the participant and device sessions at both layers; closed-set, open-set, cross-host, attacker curve. | HID dataset v1; first results table; cross-layer consistency figure. |
| 5–7 | **2 Track C setup.** WSL2/VM with ROS 2; TurtleBot3 + Webots + PX4/ArduPilot SITL; three RMW implementations; tshark capture scripts; PX4 ULog bulk download. | Fleet capture pipeline; first multi-vendor pcaps. |
| 7–10 | **3 Track C experiments.** Platform/instance/vendor ID; rogue-participant open-set; few-shot enrolment; benign-drift handling; UAV-type from ULogs with open-set. | Fleet dataset v1 packaged for Zenodo; results tables. |
| 8–11 | **4 Track B (parallel).** Load HCRL Survival, can-train-and-test, ROAD; timing-only sender ID; open-set; cross-vehicle; cloaking curve. | CAN results table. |
| 9–13 | **5 Cross-cutting.** Calibration + conformal abstention; Flower federated runs; explainability figures; ONNX int8 + latency table. | Method chapter complete. |
| 11–14 | **6 System.** Policy engine; new endpoints; Fleet Admission Console; Supabase tables; live demo script for the viva. | Working system; demo video. |
| 14–16 | **7 Writing.** Report, paper draft, reproducibility package, Zenodo releases. | Submission-ready draft. |

**Compressed 10-week variant:** do Phases 0, 1, 2, 3, then calibration only from Phase 5, then Phase 6 and 7. Drop Track B and federated learning; keep them as "future work" with the pipeline already able to load the CAN CSVs.

---

## 9. Budget and compute

| Item | Cost | Needed for |
|---|---|---|
| Digispark ATtiny85 or Raspberry Pi Pico | $3–6 | Track A injection |
| Second keyboard/mouse (borrowed) | $0 | Instance-level and open-set |
| All CAN, IoT, UAV datasets | $0 | Tracks B and C |
| Simulators and ROS 2 | $0 | Track C |
| Raspberry Pi (only if already owned) | $0–35 | Edge latency table; otherwise report laptop CPU |
| RTL-SDR (not recommended) | $30 | Track D only |

Compute: a laptop CPU is enough. MiniRocket trains in seconds; the TCN in minutes; Flower simulates ten clients on one machine.

---

## 10. Paper plan

**Working title.** *Signal-Based Device Identification for Autonomous Systems: Open-Set Timing Fingerprints for Zero-Trust Admission Across Peripheral, Vehicle-Bus and Fleet-Middleware Layers.*

**Abstract skeleton.** Autonomous fleets admit devices on declared identities that are trivially forged (evidence: VDA 5050, DDS vendorId, USB VID/PID, recent Unitree CVEs). We propose SBDI, a single timing-only fingerprinting pipeline evaluated at three layers of an autonomous system on real USB HID captures with a physical injector, public multi-vehicle CAN traces, and a released multi-vendor ROS 2/MAVLink fleet dataset. SBDI identifies device type, vendor and instance (RQ1), and we quantify its degradation under session, host, vehicle and middleware-vendor shift (RQ2), its open-set rejection and few-shot enrolment (RQ3), its robustness to adaptive timing mimicry (RQ4), and its deployability with calibrated abstention, federated training and sub-millisecond edge inference (RQ5).

**Sections.** 1 Introduction and threat model; 2 Background and related work (per §3); 3 SBDI design (pipeline, open-set, enrolment, calibration, policy); 4 Datasets (A, B, C, with collection protocol and ethics); 5 Evaluation (per §6); 6 Adaptive attacker; 7 Deployment and federated results; 8 Limitations (simulation validity, ID-as-ECU proxy, participant count); 9 Conclusion. Appendix: reproducibility checklist, configs, dataset card.

**Where to send it.** Realistic targets for a final-year project: arXiv preprint immediately; workshops such as CPSIoTSec (with ACM CCS), the ESORICS workshops, IEEE WiSec or ACSAC posters, or a national conference; an IEEE Access or *Internet of Things* (Elsevier) journal submission if results are strong. A Zenodo dataset release with a DOI counts as a citable artefact on its own.

---

## 11. Risks and mitigations

| Risk | Mitigation |
|---|---|
| ROS 2 / Gazebo will not run on the Windows laptop | WSL2 with WSLg is the primary path; VirtualBox VM second; Docker `osrf/ros` third. Budget one week; Track A does not depend on it. |
| Timing in simulation is not real hardware timing | Claim middleware/vendor-level fingerprints; evaluate across two simulators; pair with real L1/L2 signals; state the limitation. |
| Too few participants or devices for Track A | Five participants and three devices are enough for a methods paper if you report confidence intervals and cross-session results; use Aalto/CMU data for pretraining human timing. |
| Sixteen weeks is too long for the deadline | Use the 10-week variant in §8. |
| CAN datasets have no ECU labels | Use arbitration ID as the proxy and cluster by clock skew; say so plainly. |
| Fingerprints decay over time (known effect) | Make drift detection and re-enrolment a feature, not a bug; report time-to-baseline as an industrial metric. |

---

## 12. Ethics and data handling

- Record keystroke **timings only**, never key codes or text, for participant sessions. Store an anonymised participant ID.
- Written consent; check whether the department requires ethics approval for human timing data (it usually does for anything you plan to publish).
- Injection experiments run only against your own machines. Keep the scripted-HID firmware to benign payloads.
- Public datasets: respect each licence (UNSW MIT-0, ROAD CC BY, CAN-MIRGU CC BY 4.0, GEM-CAN CC BY-NC, WiSig CC BY-NC-SA, PX4 logs CC BY).

---

## 13. Key references (URLs verified 2026-09-09 unless noted)

USB / HID: Bates 2014 (NDSS) https://www.cise.ufl.edu/~butler/pubs/ndss14.pdf · Tian 2018 SoK https://oaklandsok.github.io/papers/tian2018.pdf · USBlock 2018 https://inria.hal.science/hal-01954405 · USBESAFE 2019 https://www.usenix.org/system/files/raid2019-kharraz_0.pdf · USB-Watch 2019 https://csl.fiu.edu/wp-content/uploads/2023/05/usb_watch_kyle.pdf · Time-Print 2022 https://xgao-work.github.io/paper/sp22.pdf · PowerID dataset https://zenodo.org/records/7467990 · QUACK 2026 https://arxiv.org/abs/2604.15845 · USB-GATE 2025 https://link.springer.com/article/10.1007/s10207-025-00997-2 · CMU keystrokes https://www.cs.cmu.edu/~keystroke/ · Aalto 136M https://userinterfaces.aalto.fi/136Mkeystrokes/ · SapiMouse https://github.com/margitantal68/sapimouse

CAN: CIDS 2016 https://www.usenix.org/system/files/conference/usenixsecurity16/sec16_paper_cho.pdf · Viden 2017 https://arxiv.org/abs/1708.08414 · Cloaking the Clock 2018 https://arxiv.org/abs/1710.02692 · CANvas 2019 https://github.com/sekarity/canvas · MIDS 2026 https://arxiv.org/abs/2606.18599 · HCRL Survival https://ocslab.hksecurity.net/Datasets/survival-ids · ROAD https://0xsam.com/road/ · can-train-and-test https://bitbucket.org/brooke-lampe/can-train-and-test · CAN-MIRGU https://archive.ics.uci.edu/dataset/1035/can-mirgu

IoT / robots / UAV: AuDI 2019 https://research.aalto.fi/en/publications/audi-toward-autonomous-iot-device-type-identification-using-perio/ · IoTDevID https://github.com/kahramankostas/IoTDevIDv2 · GeMID 2025 https://arxiv.org/abs/2411.14441 · Maali NDSS 2025 https://www.ndss-symposium.org/wp-content/uploads/2025-118-paper.pdf · Tang ARES 2025 https://arxiv.org/abs/2312.06802 · Gonzales 2026 https://arxiv.org/abs/2609.05741 · Kronauer 2021 https://arxiv.org/abs/2101.02074 · DDS security analysis https://documents.trendmicro.com/assets/white_papers/wp-a-security-analysis-of-the-data-distribution-service-dds-protocol.pdf · UAV type 2024 https://arxiv.org/abs/2403.00565 · PX4 logs https://logs.px4.io/browse · ROSPaCe https://github.com/TommasoPuccetti/rospace_dataset · UNSW IoT https://iotanalytics.unsw.edu.au/iottraces.html · Open-RMF demos https://github.com/open-rmf/rmf_demos · webots_ros2 https://github.com/cyberbotics/webots_ros2 · PX4 SITL https://docs.px4.io/main/en/sim_gazebo_gz/ · MAVLink Wireshark https://mavlink.io/en/guide/wireshark.html

Methods: MiniRocket https://arxiv.org/abs/2012.08791 · Bake off redux 2024 https://arxiv.org/abs/2304.13029 · aeon https://arxiv.org/abs/2406.14231 · OpenMax https://arxiv.org/abs/1511.06233 · Energy OOD https://arxiv.org/abs/2010.03759 · Mahalanobis https://arxiv.org/abs/1807.03888 · Prototypical Networks https://arxiv.org/abs/1703.05175 · FL timing device ID https://arxiv.org/abs/2111.14434 · Flower https://arxiv.org/abs/2007.14390 · Temperature scaling https://arxiv.org/abs/1706.04599 · Conformal intro https://arxiv.org/abs/2107.07511 · Ovadia 2019 https://arxiv.org/abs/1906.02530 · Dos and Don'ts https://arxiv.org/abs/2010.09470 · TESSERACT https://arxiv.org/abs/1807.07838 · Edge RFF on Pi https://arxiv.org/abs/2412.10553 · SHAP https://arxiv.org/abs/1705.07874 · TimeSHAP https://arxiv.org/abs/2012.00073

Standards / industry: NIST SP 800-207 https://csrc.nist.gov/pubs/sp/800/207/final · CISA ZTMM v2 https://www.cisa.gov/zero-trust-maturity-model · NIST IR 8259A https://csrc.nist.gov/pubs/ir/8259/a/final · VDA 5050 https://github.com/VDA5050/VDA5050 · MassRobotics AMR Interop https://github.com/MassRobotics-AMR/AMR_Interop_Standard · Open-RMF https://www.open-rmf.org/ · DDS-Security https://www.omg.org/spec/DDS-SECURITY/ · SROS2 https://github.com/ros2/sros2 · EU CRA https://digital-strategy.ec.europa.eu/en/policies/cra-summary · UniPwn https://github.com/Bin4ry/UniPwn · CVE-2026-27509 write-up https://boschko.ca/unitree-go2-rce/ · DeMarinis 2019 https://arxiv.org/abs/1808.03322

RF (stretch): ORACLE https://arxiv.org/abs/1812.01124 · WiSig https://cores.ee.ucla.edu/downloads/datasets/wisig/ · LoRa RFFI code https://github.com/gxhen/LoRa_RFFI · Survey 2025 https://arxiv.org/abs/2506.09807
