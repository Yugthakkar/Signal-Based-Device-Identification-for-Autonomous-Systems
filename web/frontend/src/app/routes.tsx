import { createBrowserRouter, Outlet, useLocation } from 'react-router';
import { MotionConfig, motion } from 'motion/react';
import Dashboard from './pages/Dashboard';
import RunPrediction from './pages/RunPrediction';
import LiveDemo from './pages/LiveDemo';
import UploadModel from './pages/UploadModel';
import VehicleMonitor from './pages/VehicleMonitor';
import ThreatTimeline from './pages/ThreatTimeline';
import ModelComparison from './pages/ModelComparison';
import BusLab from './pages/BusLab';
import { Navigation } from './components/Navigation';

function Layout() {
  const location = useLocation();

  return (
    <MotionConfig reducedMotion="user">
      <div className="flex min-h-screen flex-col">
        <Navigation />
        <motion.main
          key={location.pathname}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="flex-1"
        >
          <Outlet />
        </motion.main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-4 sm:px-6 lg:px-8">
            <span className="label-mono">SBDI · Signal-Based Device Identification for Autonomous Systems</span>
            <span className="label-mono">USB-HID timing · CAN bus intrusion detection</span>
          </div>
        </footer>
      </div>
    </MotionConfig>
  );
}

export const router = createBrowserRouter([
  {
    path: '/',
    Component: Layout,
    children: [
      { index: true, Component: Dashboard },
      { path: 'predict', Component: RunPrediction },
      { path: 'live-demo', Component: LiveDemo },
      { path: 'upload', Component: UploadModel },
      { path: 'vehicle-monitor', Component: VehicleMonitor },
      { path: 'bus-lab', Component: BusLab },
      { path: 'threat-timeline', Component: ThreatTimeline },
      { path: 'model-comparison', Component: ModelComparison },
    ],
  },
]);
