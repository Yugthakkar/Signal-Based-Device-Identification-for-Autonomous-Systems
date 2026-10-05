# Share the demo online for free: your laptop + a Cloudflare Tunnel

No hosting account, no card, no deployment. Your laptop runs the backend, and a free
**Cloudflare quick tunnel** gives it a public `https://….trycloudflare.com` link that anyone can open.

```
Professor's browser ──► https://random-words.trycloudflare.com ──► Cloudflare ──► your laptop :8000
                                                                                    └─ FastAPI serves the website + the API + both models
```

One server serves everything, so there is **one link**, no CORS setup and no Vercel.

---

## One-time setup

1. **Get cloudflared** (Cloudflare's tunnel program: one `.exe`, free, no account needed). Pick one:

   - **Download the file** (works everywhere, no winget needed): from
     https://github.com/cloudflare/cloudflared/releases/latest download **`cloudflared-windows-amd64.exe`**,
     rename it to `cloudflared.exe`, and put it in a `tools` folder inside the project
     (`D:\FY Project\Signal-Based-Device-Identification-for-Autonomous-Systems\tools\cloudflared.exe`).
     The launcher finds it there automatically.
   - **Or with winget**, if you have it: `winget install --id Cloudflare.cloudflared` (then open a new terminal).
   - **Or with conda**, since you have it: `conda install -c conda-forge cloudflared`.

2. Make sure the project already runs normally (`.venv` exists, models trained). It does if `npm run dev` works.

## Every time you want to demo

**Stop `npm run dev` first** (the demo uses the same port 8000), then from the project folder:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\start_demo.ps1
```

The script builds the website (first time only, about 30 s), starts the backend, checks both models loaded, and starts
the tunnel. Look for a line like this in the output:

```
https://quiet-river-example-words.trycloudflare.com
```

That is your public link. Open it on your phone to test, then send it to your professor.
**Keep the window open** while presenting. `Ctrl+C` stops everything.

| Option | What it does |
|---|---|
| `-Rebuild` | Rebuild the website (use after changing the frontend). |
| `-NoTunnel` | Run locally only at http://localhost:8000. No cloudflared needed. Good for a dry run. |
| `-Port 8001` | Use another port if 8000 is busy. |

## Before the viva: checklist

- [ ] Plug the laptop in and **turn off sleep** (Settings → System → Power → Screen and sleep → *Never* while plugged in).
- [ ] Run the script about 10 minutes early and open the link from your **phone on mobile data** (not the same Wi-Fi) to prove it works from outside.
- [ ] Open the **Vehicle Monitor** and **3D Bus Lab** once to warm everything up.
- [ ] Keep a screen-recording of the demo as a backup in case the Wi-Fi fails. The tunnel needs your laptop's internet.
- [ ] Don't open or share the cloudflared window's link on public channels. Anyone with the link can use the demo while it runs.

## Good to know

- **The link changes every time** you start the script. Quick tunnels have no fixed address; send the new link each session.
- **It stops when your laptop stops**: closing the lid, sleeping, losing internet or closing the window.
- **Public demo mode:** whenever the tunnel is on, the **Upload Model** and retraining endpoints are switched off
  (they have no password, so anyone with the link could otherwise overwrite your model). The Upload Model page will show
  an error through the public link. To demo model upload, do it on `http://localhost:8000` (start with `-NoTunnel`).
- **Anyone with the link can use the demo** while it runs, including starting replays and running analyses (these write alerts to your local database). Share the link only with people you trust.
- **Alerts** are stored on your laptop in `data/can/manifests/can_app.db`, so they persist between runs.
- **Streaming through the tunnel (tested):** Cloudflare quick tunnels do not deliver live streams (server-sent events). The Vehicle Monitor
  detects this and switches itself to plain polling after about 3 seconds, so the replay still works, with a short pause before the first data. The 3D Bus Lab does not use streaming at all.
- **Supabase logging** works as before if the keys are in your `.env`. The `.env` file is never served to visitors.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cloudflared not found` | Put `cloudflared.exe` in the project's `tools` folder (step 1), or use `-NoTunnel`. |
| `Port 8000 is already in use` | Stop `npm run dev` (Ctrl+C in that terminal), or use `-Port 8001`. |
| Script is blocked by Windows | Use the `-ExecutionPolicy Bypass` form shown above. |
| Link opens but the site shows **API OFFLINE** | Open `<your-link>/health`; it should return `"status":"ok"`. If not, read the log at `%TEMP%\sbdi_backend.log.err`. |
| Page looks outdated after editing the frontend | Run the script with `-Rebuild`. |
| Tunnel keeps reconnecting | Your internet is unstable; switch to a phone hotspot. |

---

## Optional: a permanent public site later

These need a card or a paid plan, so they are not part of the plan above:

- **Hugging Face Spaces (Docker)** is now a paid feature on free accounts. `deploy/` contains a ready-made bundle if you ever upgrade (`python deploy/build_hf_space.py`).
- **Vercel** can host the website for free, but the backend still has to live somewhere. A quick-tunnel link changes every
  session, so it is not a good backend for a permanent site.
- A **named Cloudflare Tunnel** gives a fixed address for free but needs a domain name you own.
