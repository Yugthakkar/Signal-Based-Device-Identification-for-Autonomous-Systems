import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PageContainer } from '../components/PageContainer';
import { PageHeader } from '../components/PageHeader';
import { Panel } from '../components/Panel';
import { StatusBadge } from '../components/StatusBadge';
import { SignalTrace } from '../components/SignalTrace';
import { UploadCloud, CheckCircle2, XCircle, FileCode, Calendar, Package, Layers, GitCommitHorizontal } from 'lucide-react';
import { uploadModel } from '../../lib/api';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

type ModelMetadata = {
  version: string;
  featureCount: number;
  lastUpdated: string;
  fileName: string;
  size: string;
};

const currentModel: ModelMetadata = {
  version: 'v2.3.1',
  featureCount: 128,
  lastUpdated: '2026-03-28 14:22:15',
  fileName: 'sbdi_model_v2.3.1.pt',
  size: '43.2 MB',
};

const deployments = [
  { version: 'v2.3.1', date: '2026-03-28 14:22', message: 'Deployed successfully' },
  { version: 'v2.3.0', date: '2026-03-25 09:15', message: 'Deployed successfully' },
  { version: 'v2.2.9', date: '2026-03-22 16:43', message: 'Deployed successfully' },
];

const uploadSteps = ['Transfer', 'Validate', 'Load'];

export default function UploadModelPage() {
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.name.endsWith('.pt') || file.name.endsWith('.pth')) {
        setSelectedFile(file);
      }
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploadStatus('uploading');
    setUploadProgress(0);
    setMessage(null);

    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= 90) return 90;
        return prev + 10;
      });
    }, 200);

    try {
      await uploadModel(selectedFile);
      setUploadProgress(100);
      setUploadStatus('success');
      setMessage('Model deployed successfully and loaded into runtime.');
    } catch (err) {
      setUploadStatus('error');
      setMessage(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      clearInterval(interval);
    }
  };

  const handleReset = () => {
    setUploadStatus('idle');
    setUploadProgress(0);
    setSelectedFile(null);
    setMessage(null);
  };

  const activeStep = uploadProgress < 40 ? 0 : uploadProgress < 90 ? 1 : 2;

  return (
    <PageContainer maxWidth="lg">
      <PageHeader
        eyebrow="Module 01 · Model ops"
        title="Upload Model"
        description="Hot-swap the runtime classifier with a new PyTorch artifact. The API validates and loads it in place."
        trace="can"
        actions={<StatusBadge status="success" label="Active model deployed" />}
      >
        <AnimatePresence>
          {message && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={`mt-4 rounded-lg border px-3 py-2 text-sm ${
                uploadStatus === 'error' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-ok/30 bg-ok/10 text-ok'
              }`}
            >
              {message}
            </motion.p>
          )}
        </AnimatePresence>
      </PageHeader>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Upload */}
        <Panel eyebrow=".pt / .pth" title="Model artifact upload" delay={0.05}>
          <AnimatePresence mode="wait">
            {uploadStatus === 'idle' && (
              <motion.div key="upload-area" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <div
                  onDragEnter={handleDrag}
                  onDragLeave={handleDrag}
                  onDragOver={handleDrag}
                  onDrop={handleDrop}
                  className={`relative overflow-hidden rounded-xl border border-dashed p-10 text-center transition-all duration-300 ${
                    dragActive
                      ? 'scale-[1.01] border-signal bg-signal/5'
                      : 'border-line-strong bg-surface-2/50 hover:border-ink-dim hover:bg-surface-2'
                  }`}
                >
                  <input
                    type="file"
                    id="file-upload"
                    accept=".pt,.pth"
                    onChange={handleFileSelect}
                    className="absolute inset-0 z-10 h-full w-full cursor-pointer opacity-0"
                  />
                  {dragActive && <SignalTrace variant="sine" className="absolute inset-x-0 bottom-3 h-8 opacity-40" speed={3} />}
                  <div className="pointer-events-none relative">
                    <motion.div
                      animate={dragActive ? { y: -6, scale: 1.08 } : { y: 0, scale: 1 }}
                      transition={{ type: 'spring', stiffness: 300, damping: 18 }}
                      className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border ${
                        dragActive ? 'border-signal/50 bg-signal/15 text-signal' : 'border-line-strong bg-surface-3 text-ink-muted'
                      }`}
                    >
                      <UploadCloud className="h-6 w-6" />
                    </motion.div>
                    <p className="mb-1 font-medium text-ink">
                      {selectedFile ? selectedFile.name : dragActive ? 'Release to load artifact' : 'Drop model file here'}
                    </p>
                    <p className="mb-4 text-sm text-ink-dim">or click to browse</p>
                    <p className="font-mono text-[0.6875rem] text-ink-dim">Supports .pt and .pth</p>
                  </div>
                </div>

                <AnimatePresence>
                  {selectedFile && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mb-4 mt-5 flex items-center gap-3 rounded-lg border border-signal/30 bg-signal/5 p-3">
                        <FileCode className="h-5 w-5 shrink-0 text-signal" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-mono text-sm text-ink">{selectedFile.name}</p>
                          <p className="readout text-xs text-ink-dim">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</p>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button onClick={handleUpload} className="btn btn-primary btn-lg flex-1">
                          <UploadCloud /> Deploy model
                        </button>
                        <button onClick={handleReset} className="btn btn-ghost btn-lg">
                          Cancel
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )}

            {uploadStatus === 'uploading' && (
              <motion.div key="uploading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-10">
                <SignalTrace variant="can" className="mx-auto mb-6 h-10 w-64" speed={1.4} strokeWidth={1.75} />
                <p className="mb-1 text-center font-medium text-ink">Uploading model…</p>
                <p className="mb-6 text-center text-sm text-ink-dim">Validating artifact and updating deployment</p>

                <div className="mx-auto max-w-sm">
                  <div className="mb-3 flex justify-between">
                    {uploadSteps.map((step, i) => (
                      <span key={step} className={`label-mono transition-colors ${i <= activeStep ? 'text-signal' : ''}`}>
                        {i + 1}. {step}
                      </span>
                    ))}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${uploadProgress}%` }}
                      transition={{ ease: [0.16, 1, 0.3, 1] }}
                      className="h-full bg-signal"
                    />
                  </div>
                  <p className="readout mt-2 text-right text-sm text-ink-muted">{uploadProgress}%</p>
                </div>
              </motion.div>
            )}

            {uploadStatus === 'success' && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="py-10 text-center"
              >
                <motion.div
                  initial={{ scale: 0, rotate: -30 }}
                  animate={{ scale: 1, rotate: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}
                  className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-ok/40 bg-ok/10"
                >
                  <CheckCircle2 className="h-8 w-8 text-ok" />
                </motion.div>
                <p className="mb-1 font-medium text-ink">Model deployed successfully</p>
                <p className="mb-6 text-sm text-ink-dim">New model is now active and serving predictions</p>
                <button onClick={handleReset} className="btn btn-secondary">
                  Upload another
                </button>
              </motion.div>
            )}

            {uploadStatus === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1, x: [0, -6, 6, -4, 4, 0] }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ x: { duration: 0.4 } }}
                className="py-10 text-center"
              >
                <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full border border-danger/40 bg-danger/10">
                  <XCircle className="h-8 w-8 text-danger" />
                </div>
                <p className="mb-1 font-medium text-ink">Upload failed</p>
                <p className="mb-6 text-sm text-ink-dim">Model validation failed. Check file integrity and try again.</p>
                <button onClick={handleReset} className="btn btn-danger">
                  Try again
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </Panel>

        {/* Active model */}
        <div className="flex flex-col gap-6">
          <Panel eyebrow="In service" title="Active model" delay={0.1} brackets>
            <div className="grid grid-cols-2 gap-3">
              {[
                { icon: Package, label: 'Version', value: currentModel.version, tone: 'text-signal' },
                { icon: Layers, label: 'Feature dims', value: String(currentModel.featureCount), tone: 'text-info' },
                { icon: FileCode, label: 'Artifact size', value: currentModel.size, tone: 'text-ok' },
                { icon: Calendar, label: 'Last updated', value: currentModel.lastUpdated.slice(0, 10), tone: 'text-orange' },
              ].map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * 0.05 }}
                  className="rounded-lg border border-line bg-surface-2 p-3.5"
                >
                  <div className="mb-2 flex items-center gap-2">
                    <item.icon className={`h-3.5 w-3.5 ${item.tone}`} />
                    <span className="label-mono">{item.label}</span>
                  </div>
                  <p className="readout text-lg font-semibold text-ink">{item.value}</p>
                </motion.div>
              ))}
            </div>
            <p className="mt-3 truncate rounded-md border border-line bg-bg px-3 py-2 font-mono text-xs text-ink-dim">
              <span className="text-signal">artifacts/</span>
              {currentModel.fileName}
            </p>
          </Panel>

          <Panel eyebrow="git log --deploys" title="Deployment history" delay={0.15}>
            <ol className="relative ml-2 border-l border-line">
              {deployments.map((d, idx) => (
                <motion.li
                  key={d.version}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: 0.25 + idx * 0.08 }}
                  className="relative pb-5 pl-6 last:pb-0"
                >
                  <span
                    className={`absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${idx === 0 ? 'bg-signal' : 'bg-line-strong'}`}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <GitCommitHorizontal className="h-3.5 w-3.5 text-ink-dim" />
                      <span className="readout text-sm font-medium text-ink">{d.version}</span>
                      {idx === 0 && (
                        <span className="rounded border border-signal/30 bg-signal/10 px-1.5 font-mono text-[0.625rem] text-signal">
                          CURRENT
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-ok">{d.message}</span>
                  </div>
                  <p className="readout mt-0.5 text-xs text-ink-dim">{d.date}</p>
                </motion.li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </PageContainer>
  );
}
