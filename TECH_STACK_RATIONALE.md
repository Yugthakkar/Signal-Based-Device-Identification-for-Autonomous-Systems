# Tech Stack Rationale

## Data + Feature Engineering
| Component | Why it fits | Pros | Cons |
| --- | --- | --- | --- |
| Python 3 ecosystem | Uniform language for feature scripts, training, and tooling. | Huge library support, easy onboarding, integrates with scientific stack. | Not the fastest runtime; requires virtualenv management. |
| pandas + numpy | Tabular event manipulation and statistics. | Battle-tested APIs, vectorized math keeps feature extraction concise. | Memory-heavy on very large captures; learning curve for complex indexing. |
| Scapy/TShark pipeline (pcapng_to_csv) | Converts keyboard/mouse PCAPNG captures into model-ready CSV rows. | Direct control over packet parsing, reproducible conversions. | External Tshark dependency must be installed; CLI parsing can break if packet schema changes. |

## Modeling
| Component | Why it fits | Pros | Cons |
| --- | --- | --- | --- |
| PyTorch 2.x | Residual MLP classifier with custom training loop. | Dynamic autograd, GPU-ready, easy to export `.pt` artifacts, thriving community. | Heavier dependency; needs CUDA toolchain for GPU acceleration. |
| Weighted sampling + focal loss | Addresses class imbalance between keyboard vs mouse traces. | Stabilizes training without manual dataset rebalance. | Requires tuning; can introduce longer training time. |

## Backend Service Layer
| Component | Why it fits | Pros | Cons |
| --- | --- | --- | --- |
| FastAPI + Uvicorn | High-performance REST API for predictions, training, uploads. | Async-first, auto docs via OpenAPI/Swagger, easy dependency injection. | Requires async awareness; more moving parts than Flask for small scripts. |
| python-multipart | Handles CSV/model uploads to retrain or hot-swap artifacts. | Simple file handling with FastAPI `UploadFile`. | Adds attack surface; must validate file size/content. |
| Supabase (Postgres + Auth) | Persist prediction sessions, feedback, and upload logs. | Managed Postgres, row-level security, real-time subscriptions if needed. | Depends on external cloud; service-role keys must be protected. |
| python-dotenv | Centralized env config for local + prod parity. | Keeps secrets out of code, easy to switch environments. | Need discipline so `.env` never leaks to VCS. |

## Desktop Experience
| Component | Why it fits | Pros | Cons |
| --- | --- | --- | --- |
| Tkinter + ttk | Lightweight offline UI for technicians. | Ships with CPython, no extra runtime, quick to script. | Limited styling/theming; Windows/macOS rendering differs. |
| Matplotlib | Visualizes events/sec and timing gaps inline. | Mature plotting, integrates with Tkinter via `FigureCanvasTkAgg`. | Not interactive by default; heavier than lightweight chart libs. |

## Web Frontend
| Component | Why it fits | Pros | Cons |
| --- | --- | --- | --- |
| React 18 + TypeScript | SPA that mirrors desktop capabilities (live demo, uploads). | Component ecosystem, strong typing, easy state management with hooks. | Build size can bloat; hydration complexity for future SSR. |
| Vite 6 | Dev server + bundler for React app. | Instant HMR, opinionated but minimal config, fast builds for Vercel. | Relatively new; relies on Node 18+ support. |
| Tailwind CSS 4 + Radix UI + shadcn-inspired components | Rapidly style dashboards & forms with consistent design tokens. | Design system primitives, accessible defaults, theming via CSS vars. | Requires discipline to avoid class churn; Radix adds bundle weight. |
| Motion/Framer + Sonner + Recharts | Micro-interactions, toast UX, and analytics widgets. | Enhances perceived polish, quick charting. | Adds JS dependencies; must watch performance on low-power devices. |

## Tooling & Deployment
| Component | Why it fits | Pros | Cons |
| --- | --- | --- | --- |
| Node.js + npm workspace | Orchestrates combined `npm run dev` to boot FastAPI + Vite. | Single command for viva demos, easy scripts. | Requires both Python + Node environments installed. |
| Vercel (frontend) + custom FastAPI host | Decouples UI deploy from ML runtime. | Scales independently, CDN caching for static assets. | Need to handle CORS + HTTPS bridging manually. |

## Summary
- Python side excels at deterministic feature engineering and PyTorch training, at the cost of heavier dependencies.
- FastAPI + Supabase deliver a modern API layer with structured logging, but managing secrets and async patterns is non-trivial.
- Tkinter desktop tooling keeps offline workflows accessible, while the Vite/React frontend supplies a polished web experience backed by Tailwind/Radix.
- Overall the stack favors developer velocity and experimentation; the main trade-offs are runtime footprint (PyTorch + Node) and the need to secure cloud credentials.
