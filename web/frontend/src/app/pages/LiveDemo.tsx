import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Panel, EmptyState } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { MetricCard } from '../components/MetricCard';
import { ConfidenceRing } from '../components/ConfidenceRing';
import { EventRaster } from '../components/EventRaster';
import { SignalTrace } from '../components/SignalTrace';
import { Play, Square, Activity, Clock, Zap, Usb, Keyboard, Mouse, AlertTriangle } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { predictWithEvents } from '../../lib/api';
import { axisProps, chartColors, gridProps, tooltipProps } from '../components/chartTheme';

type EventData = {
  timestamp: string;
  confidence: number;
};

type LiveEvent = {
  time: string;
  type: string;
  x: number;
  y: number;
};

type EventRecord = {
  event_type: string;
  timestamp: number;
  value: string;
};

export default function LiveDemo() {
  const [isRunning, setIsRunning] = useState(false);
  const [usbConnected, setUsbConnected] = useState(false);
  const [connectedDeviceName, setConnectedDeviceName] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [eventBuffer, setEventBuffer] = useState<EventRecord[]>([]);
  const [currentPrediction, setCurrentPrediction] = useState<{
    label: 'KEYBOARD' | 'MOUSE';
    confidence: number;
  } | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [eventRate, setEventRate] = useState(0);
  const [avgTimeGap, setAvgTimeGap] = useState(0);
  const [confidenceData, setConfidenceData] = useState<EventData[]>([]);
  const [recentEvents, setRecentEvents] = useState<LiveEvent[]>([]);
  const eventBufferRef = useRef<EventRecord[]>([]);
  const lastConsumedTimestampRef = useRef(0);
  const isPredictingRef = useRef(false);

  useEffect(() => {
    if (!isRunning) return;

    const appendEvent = (eventType: string, value: string, x = 0, y = 0) => {
      const nowMs = Date.now();
      const timeStr = new Date(nowMs).toLocaleTimeString('en-GB');

      setEventBuffer((prev) => {
        const next = [...prev, { event_type: eventType, timestamp: nowMs / 1000, value }].slice(-120);
        eventBufferRef.current = next;
        return next;
      });
      setEventCount((prev) => prev + 1);
      setRecentEvents((prev) => [{ time: timeStr, type: eventType, x, y }, ...prev].slice(0, 15));
    };

    const onKeyDown = (event: KeyboardEvent) => appendEvent('keydown', event.key);
    const onMouseMove = (event: MouseEvent) => appendEvent('mousemove', `${event.clientX},${event.clientY}`, event.clientX, event.clientY);
    const onClick = (event: MouseEvent) => appendEvent('click', String(event.button), event.clientX, event.clientY);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('click', onClick);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onClick);
    };
  }, [isRunning]);

  useEffect(() => {
    if (!isRunning) return;

    const interval = setInterval(async () => {
      if (isPredictingRef.current) {
        return;
      }

      const freshEvents = eventBufferRef.current.filter(
        (evt) => evt.timestamp > lastConsumedTimestampRef.current
      );
      if (freshEvents.length < 8) {
        return;
      }

      const snapshot = freshEvents.slice(-40);
      isPredictingRef.current = true;

      const gaps: number[] = [];
      for (let i = 1; i < snapshot.length; i += 1) {
        gaps.push((snapshot[i].timestamp - snapshot[i - 1].timestamp) * 1000);
      }

      const lastTs = snapshot[snapshot.length - 1].timestamp;
      const firstTs = snapshot[0].timestamp;
      const duration = Math.max(lastTs - firstTs, 0.001);
      setEventRate(snapshot.length / duration);
      setAvgTimeGap(gaps.length > 0 ? gaps.reduce((acc, value) => acc + value, 0) / gaps.length : 0);

      try {
        const payload = await predictWithEvents(snapshot);
        const confidencePct = payload.prediction.confidence * 100;
        const label = payload.prediction.device.toUpperCase().includes('KEY') ? 'KEYBOARD' : 'MOUSE';

        setCurrentPrediction({
          label,
          confidence: confidencePct,
        });
        setWarning(null);
        lastConsumedTimestampRef.current = lastTs;

        const now = new Date();
        const timeStr = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}:${String(
          now.getSeconds()
        ).padStart(2, '0')}`;

        setConfidenceData((prev) => {
          const newData = [...prev, { timestamp: timeStr, confidence: confidencePct }].slice(-20);
          return newData;
        });
      } catch (err) {
        console.error('Live prediction failed:', err);
        setWarning(err instanceof Error ? `Prediction request failed: ${err.message}` : 'Prediction request failed.');
      } finally {
        isPredictingRef.current = false;
      }
    }, 1500);

    return () => clearInterval(interval);
  }, [isRunning]);

  useEffect(() => {
    const hid = (navigator as Navigator & { hid?: HID }).hid;
    if (!hid) {
      setWarning('WebHID is not available in this browser. Live mode uses browser event stream only.');
      return;
    }

    const onConnect = (event: HIDConnectionEvent) => {
      setUsbConnected(true);
      setConnectedDeviceName(event.device.productName || 'USB HID device');
      setWarning(null);
    };
    const onDisconnect = () => {
      setUsbConnected(false);
      setConnectedDeviceName(null);
    };

    hid.addEventListener('connect', onConnect);
    hid.addEventListener('disconnect', onDisconnect);

    void hid.getDevices().then((devices) => {
      if (devices.length > 0) {
        setUsbConnected(true);
        setConnectedDeviceName(devices[0].productName || 'USB HID device');
      }
    });

    return () => {
      hid.removeEventListener('connect', onConnect);
      hid.removeEventListener('disconnect', onDisconnect);
    };
  }, []);

  const handleConnectUsb = async () => {
    const hid = (navigator as Navigator & { hid?: HID }).hid;
    if (!hid) {
      setWarning('WebHID is not available in this browser.');
      return;
    }

    try {
      const devices = await hid.requestDevice({ filters: [] });
      if (devices.length > 0) {
        setUsbConnected(true);
        setConnectedDeviceName(devices[0].productName || 'USB HID device');
        setWarning(null);
      }
    } catch {
      setWarning('USB connection permission was not granted.');
    }
  };

  const handleStart = () => {
    setIsRunning(true);
    setEventCount(0);
    setConfidenceData([]);
    setRecentEvents([]);
    eventBufferRef.current = [];
    setEventBuffer([]);
    setCurrentPrediction(null);
    lastConsumedTimestampRef.current = 0;
    isPredictingRef.current = false;
  };

  const handleStop = () => {
    setIsRunning(false);
  };

  const isKeyboard = currentPrediction?.label === 'KEYBOARD';
  const predColor = isKeyboard ? 'var(--signal)' : 'var(--info)';

  return (
    <PageContainer maxWidth="2xl">
      <PageHeader
        eyebrow="Module 01 · Real-time stream"
        title="Live Demo"
        description="Type or move your mouse — the timing of your own input stream is classified every 1.5 s."
        trace="sine"
        actions={<StatusBadge status={isRunning ? 'processing' : 'idle'} label={isRunning ? 'Streaming' : 'Stopped'} />}
      >
        <p className="mt-2 font-mono text-xs text-ink-dim">
          Classifies browser input behaviour (keystrokes, mouse movement in this tab) — not raw USB packet timing.
        </p>
        <AnimatePresence>
          {warning && (
            <motion.p
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-3 flex items-center gap-2 overflow-hidden rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn"
            >
              <AlertTriangle className="h-4 w-4 shrink-0" /> {warning}
            </motion.p>
          )}
        </AnimatePresence>
      </PageHeader>

      {/* Control deck */}
      <Panel className="mb-6" delay={0.05} brackets padded={false}>
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-4">
            <div className={`relative flex h-11 w-11 items-center justify-center rounded-lg border ${isRunning ? 'border-signal/40 bg-signal/10 text-signal' : 'border-line-strong bg-surface-2 text-ink-dim'}`}>
              <Activity className="h-5 w-5" />
              {isRunning && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-danger animate-pulse" />}
            </div>
            <div>
              <h3>Stream controls</h3>
              <p className="text-sm text-ink-muted">
                {isRunning ? 'Receiving live events from this browser tab' : 'Ready to begin live classification'}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 font-mono text-xs text-ink-dim">
                <Usb className="h-3 w-3" />
                {usbConnected ? <span className="text-ok">Connected · {connectedDeviceName}</span> : 'USB not connected'}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={handleConnectUsb} className="btn btn-secondary btn-lg">
              <Usb /> Connect USB
            </button>
            {!isRunning ? (
              <button onClick={handleStart} className="btn btn-primary btn-lg">
                <Play /> Start stream
              </button>
            ) : (
              <button onClick={handleStop} className="btn btn-danger btn-lg">
                <Square /> Stop stream
              </button>
            )}
          </div>
        </div>
        <div className="border-t border-line px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-mono">Event raster · last 12 s</span>
            <span className="readout text-xs text-ink-dim">{eventBuffer.length} buffered</span>
          </div>
          <EventRaster events={eventBuffer} running={isRunning} />
        </div>
      </Panel>

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Current classification */}
        <Panel eyebrow="Current verdict" title="Classification" delay={0.1} className="lg:col-span-1">
          <AnimatePresence mode="wait">
            {currentPrediction && isRunning ? (
              <motion.div
                key={currentPrediction.label}
                initial={{ opacity: 0, scale: 0.94 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col items-center gap-4 py-2"
              >
                <div className="flex items-center gap-2" style={{ color: predColor }}>
                  {isKeyboard ? <Keyboard className="h-6 w-6" /> : <Mouse className="h-6 w-6" />}
                  <span className="font-display text-3xl font-bold tracking-tight">{currentPrediction.label}</span>
                </div>
                <ConfidenceRing value={Math.round(currentPrediction.confidence * 10) / 10} size="md" label="Confidence" color={predColor} animated={false} />
              </motion.div>
            ) : (
              <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                {isRunning ? (
                  <div className="flex flex-col items-center gap-4 py-10 text-center">
                    <SignalTrace variant="pulse" className="h-10 w-40" speed={1.8} />
                    <p className="text-sm text-ink-muted">Listening for events…</p>
                    <p className="text-xs text-ink-dim">Need at least 8 fresh events per window</p>
                  </div>
                ) : (
                  <EmptyState icon={<Activity className="h-5 w-5" />} title="Stream stopped" hint="Start the stream to begin classifying." />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Panel>

        {/* Metrics */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:col-span-2">
          <MetricCard title="Events" value={eventCount} icon={Activity} status="neutral" delay={0.12} description="Processed this session" />
          <MetricCard title="Event rate" value={eventRate} decimals={1} suffix="/s" icon={Zap} status="success" delay={0.16} description="Latest window" />
          <MetricCard title="Avg gap" value={avgTimeGap} suffix=" ms" icon={Clock} status="neutral" delay={0.2} description="Inter-arrival time" />
        </div>
      </div>

      {/* Confidence over time */}
      <Panel eyebrow="Telemetry" title="Confidence over time" delay={0.15} className="mb-6">
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={confidenceData} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
              <CartesianGrid {...gridProps} />
              <XAxis dataKey="timestamp" {...axisProps} />
              <YAxis domain={[0, 100]} {...axisProps} tickFormatter={(v: number) => `${v}%`} />
              <Tooltip {...tooltipProps} formatter={(v: number) => [`${v.toFixed(1)}%`, 'confidence']} />
              <Area
                type="monotone"
                dataKey="confidence"
                stroke={chartColors.signal}
                strokeWidth={2}
                fill={chartColors.signal}
                fillOpacity={0.08}
                dot={{ r: 2.5, fill: chartColors.signal, strokeWidth: 0 }}
                activeDot={{ r: 5, fill: chartColors.signal, stroke: '#0B0D0F', strokeWidth: 2 }}
                animationDuration={500}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Panel>

      {/* Event stream */}
      <Panel eyebrow="stdin" title="Live event stream" delay={0.2} className="bg-bg-2" padded={false}>
        <div className="max-h-96 overflow-y-auto p-5">
          {recentEvents.length > 0 ? (
            <div className="space-y-1 font-mono text-xs">
              {recentEvents.map((event, idx) => {
                const isKey = event.type.toUpperCase().includes('KEY');
                const isClick = event.type === 'click';
                return (
                  <motion.div
                    key={`${event.time}-${eventCount - idx}`}
                    initial={{ opacity: 0, x: -8, backgroundColor: 'rgba(242,184,75,0.10)' }}
                    animate={{ opacity: 1, x: 0, backgroundColor: 'rgba(242,184,75,0)' }}
                    transition={{ duration: 0.5 }}
                    className="flex gap-4 rounded px-2 py-0.5 text-ink-muted"
                  >
                    <span className="shrink-0 text-ink-dim">{event.time}</span>
                    <span className={`w-20 shrink-0 font-semibold ${isKey ? 'text-signal' : isClick ? 'text-orange' : 'text-info'}`}>
                      {event.type}
                    </span>
                    <span className="text-ink-dim">
                      x:{event.x.toFixed(0).padStart(4, ' ')} y:{event.y.toFixed(0).padStart(4, ' ')}
                    </span>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <p className="py-10 text-center font-mono text-xs text-ink-dim">
              <span className="text-signal">❯</span> waiting for events<span className="animate-blink">_</span>
            </p>
          )}
        </div>
      </Panel>
    </PageContainer>
  );
}
