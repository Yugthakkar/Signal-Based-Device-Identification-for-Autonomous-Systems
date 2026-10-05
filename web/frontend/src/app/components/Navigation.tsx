import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router';
import { motion } from 'motion/react';
import { LayoutDashboard, Zap, Activity, Upload, Radar, ListChecks, BarChart3, Keyboard, Car, Box } from 'lucide-react';
import { SignalTrace } from './SignalTrace';
import { fetchHealth } from '../../lib/api';

type ModuleKey = 'usb' | 'can';

const modules: { key: ModuleKey; label: string; shortLabel: string; icon: typeof Keyboard; defaultPath: string }[] = [
  { key: 'usb', label: 'USB Device ID', shortLabel: 'USB · HID', icon: Keyboard, defaultPath: '/' },
  { key: 'can', label: 'CAN Vehicle Security', shortLabel: 'CAN · Vehicle', icon: Car, defaultPath: '/vehicle-monitor' },
];

const navItemsByModule: Record<ModuleKey, { path: string; label: string; icon: typeof Keyboard }[]> = {
  usb: [
    { path: '/', label: 'Dashboard', icon: LayoutDashboard },
    { path: '/predict', label: 'Run Prediction', icon: Zap },
    { path: '/live-demo', label: 'Live Demo', icon: Activity },
    { path: '/upload', label: 'Upload Model', icon: Upload },
  ],
  can: [
    { path: '/vehicle-monitor', label: 'Vehicle Monitor', icon: Radar },
    { path: '/bus-lab', label: '3D Bus Lab', icon: Box },
    { path: '/threat-timeline', label: 'Threat Timeline', icon: ListChecks },
    { path: '/model-comparison', label: 'Model Comparison', icon: BarChart3 },
  ],
};

const canPaths = new Set(navItemsByModule.can.map((item) => item.path));

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

function useApiOnline() {
  const [online, setOnline] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    const check = () =>
      fetchHealth()
        .then((h) => alive && setOnline(h.status === 'ok'))
        .catch(() => alive && setOnline(false));
    void check();
    const id = setInterval(check, 10000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return online;
}

export function Navigation() {
  const location = useLocation();
  const activeModule: ModuleKey = canPaths.has(location.pathname) ? 'can' : 'usb';
  const navItems = navItemsByModule[activeModule];
  const now = useClock();
  const apiOnline = useApiOnline();

  const apiTone =
    apiOnline === null
      ? { dot: 'bg-ink-dim', text: 'text-ink-dim', label: 'LINK …' }
      : apiOnline
        ? { dot: 'bg-ok', text: 'text-ok', label: 'API ONLINE' }
        : { dot: 'bg-danger', text: 'text-danger', label: 'API OFFLINE' };

  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-bg/85 backdrop-blur-xl">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between gap-4">
          {/* Brand */}
          <Link to="/" className="group flex items-center gap-3">
            <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-signal/40 bg-signal/10">
              <SignalTrace variant="pulse" className="absolute inset-x-0 inset-y-2" speed={2.4} strokeWidth={1.6} />
            </div>
            <div className="flex flex-col">
              <span className="font-display text-[1.0625rem] font-bold leading-none tracking-tight text-ink">
                SBDI<span className="text-signal">/</span>console
              </span>
              <span className="label-mono mt-1 text-[0.625rem]">Signal-Based Device ID</span>
            </div>
          </Link>

          {/* Module switch */}
          <div className="hidden items-center gap-1 rounded-lg border border-line bg-surface p-1 sm:flex">
            {modules.map((mod) => {
              const isActive = mod.key === activeModule;
              const Icon = mod.icon;
              return (
                <Link
                  key={mod.key}
                  to={mod.defaultPath}
                  title={mod.label}
                  className={`relative flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium transition-colors duration-200 ${
                    isActive ? 'text-signal-ink' : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {isActive && (
                    <motion.span
                      layoutId="moduleTab"
                      className="absolute inset-0 rounded-md bg-signal"
                      transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                    />
                  )}
                  <Icon className="relative h-4 w-4" />
                  <span className="relative">{mod.shortLabel}</span>
                </Link>
              );
            })}
          </div>

          {/* Telemetry */}
          <div className="hidden items-center gap-4 lg:flex">
            <div className="flex items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5">
              <span className="relative flex h-2 w-2">
                <span className={`absolute inline-flex h-full w-full rounded-full ${apiTone.dot} ${apiOnline ? 'animate-ping-soft' : ''}`} />
                <span className={`relative inline-flex h-2 w-2 rounded-full ${apiTone.dot}`} />
              </span>
              <span className={`font-mono text-[0.6875rem] font-medium tracking-wider ${apiTone.text}`}>{apiTone.label}</span>
            </div>
            <span className="readout text-xs text-ink-dim">
              {now.toISOString().slice(11, 19)} <span className="text-ink-dim/60">UTC</span>
            </span>
          </div>
        </div>

        {/* Sub-navigation — desktop */}
        <div className="-mb-px hidden items-center gap-1 overflow-x-auto md:flex">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            const Icon = item.icon;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`relative flex items-center gap-2 whitespace-nowrap px-3 pb-3 pt-1 text-sm font-medium transition-colors duration-200 ${
                  isActive ? 'text-ink' : 'text-ink-dim hover:text-ink-muted'
                }`}
              >
                <Icon className={`h-4 w-4 transition-colors ${isActive ? 'text-signal' : ''}`} />
                {item.label}
                {isActive && (
                  <motion.span
                    layoutId="subTab"
                    className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-signal"
                    transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                  />
                )}
              </Link>
            );
          })}
        </div>

        {/* Mobile navigation */}
        <div className="pb-3 md:hidden">
          <div className="mb-2 flex gap-1">
            {modules.map((mod) => {
              const isActive = mod.key === activeModule;
              const Icon = mod.icon;
              return (
                <Link
                  key={mod.key}
                  to={mod.defaultPath}
                  className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-signal text-signal-ink' : 'border border-line bg-surface text-ink-muted'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {mod.shortLabel}
                </Link>
              );
            })}
          </div>
          <div className="flex gap-1 overflow-x-auto">
            {navItems.map((item) => {
              const isActive = location.pathname === item.path;
              const Icon = item.icon;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    isActive ? 'bg-signal/10 text-signal' : 'text-ink-muted hover:bg-surface'
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </nav>
  );
}
