# GIFSnap

**Turn any website into a browsing GIF — instantly.**

GIFSnap launches a headless browser, navigates any public URL, and captures smooth animated GIFs showing the full page in action. Choose between one-click auto-capture or a hands-on interactive recording studio with frame-by-frame control.

---

## Features

### Quick Generate
Paste a URL, pick a scan mode, and get a GIF in seconds.

| Mode | Description |
|---|---|
| **Vertical Scroll** | Smooth scroll top-to-bottom with dwell and return |
| **4-Corner Tour** | Visits TL, TR, BR, BL corners in sequence |
| **Full Browse** | Snake pattern covering all four edges |
| **Diagonal Sweep** | Diagonal from top-left to bottom-right and back |

- Pre-scrolls the entire page to trigger lazy-loaded images before recording
- Simulates mouse movement to activate hover states
- Eased transitions for natural-feeling motion
- Configurable frame count (5–40), speed, and viewport width (mobile/tablet/desktop)

### Interactive Studio
A live recording workspace for full manual control.

- **Live minimap** — full-page thumbnail with draggable viewport overlay. Click or drag to navigate in real-time.
- **Recording mode** — hit Record, drag around the minimap, and frames are auto-captured as you browse. Subsamples long recordings to keep output smooth.
- **Manual capture** — snap individual keyframes at exact positions.
- **Smooth Fill** — auto-generates eased transition frames between keyframes (3–12 intermediate frames per gap).
- **Per-frame speed control** — set delay from 30ms to 2000ms on each frame individually via slider.
- **Drag-to-reorder** — rearrange frames in the timeline by dragging.
- **Keyboard shortcuts** — `R` record, `Space` capture, `S` smooth fill, `Enter` generate, arrow keys navigate.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Vanilla HTML / CSS / JS |
| Backend | Node.js + Express |
| Browser Automation | Puppeteer (headless Chromium) |
| GIF Encoding | gif-encoder-2 + node-canvas |

---

## Getting Started

### Prerequisites

- **Node.js** 18+
- **Native canvas dependencies:**

  **macOS** (Homebrew):
  ```bash
  brew install pkg-config cairo pango libpng jpeg giflib librsvg
  ```

  **Ubuntu / Debian**:
  ```bash
  sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
  ```

### Install

```bash
git clone https://github.com/YOUR_USERNAME/GIFSnap.git
cd GIFSnap
npm install
```

> Puppeteer automatically downloads Chromium (~170 MB) on first install.

### Run

```bash
npm start          # production — http://localhost:3000
npm run dev        # development with auto-reload (nodemon)
```

Set the `PORT` environment variable to change the default port.

---

## API Reference

### `POST /api/generate` — Quick Generate

One-shot auto-capture. Returns `image/gif` binary.

| Field | Type | Default | Description |
|---|---|---|---|
| `url` | string | *required* | Full URL (must start with `http`) |
| `mode` | string | `scroll` | `scroll`, `corners`, `browse`, or `diagonal` |
| `frames` | number | `20` | Frame count (5–40) |
| `delay` | number | `120` | Delay between frames in ms (50–500) |
| `width` | number | `1280` | Viewport width in px (320–1920) |

```bash
curl -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"url":"https://stripe.com","mode":"scroll","frames":20}' \
  -o preview.gif
```

### Interactive Studio Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/api/session/start` | POST | Open a browser session. Returns session ID, minimap image, page dimensions. |
| `/api/session/scroll` | POST | Scroll to `{x, y}` and return a live viewport screenshot. |
| `/api/session/waypoint/add` | POST | Capture current viewport as a frame with custom delay. |
| `/api/session/waypoint/update` | POST | Update delay or label on a frame. |
| `/api/session/waypoint/remove` | POST | Delete a frame. |
| `/api/session/waypoint/reorder` | POST | Reorder frames via array of IDs. |
| `/api/session/batch-capture` | POST | Capture up to 60 positions in one request (recording mode). |
| `/api/session/interpolate` | POST | Auto-generate smooth transition frames between keyframes. |
| `/api/session/generate` | POST | Build GIF from captured frames. Returns `image/gif` binary. |
| `/api/session/close` | POST | Close browser and release resources. |

Sessions auto-expire after 5 minutes of inactivity.

---

## Project Structure

```
GIFSnap/
├── server.js        # Express API + Puppeteer automation + GIF encoding + session management
├── index.html       # Frontend UI (Quick Generate + Interactive Studio)
├── package.json
├── .gitignore
└── README.md
```

---

## Deployment

### Railway
1. Push to GitHub
2. Connect repo on [railway.app](https://railway.app)
3. Railway auto-detects Node.js and runs `npm start`

### Render
1. New Web Service on [render.com](https://render.com)
2. Build command: `npm install`
3. Start command: `npm start`

### Fly.io
```bash
fly launch
fly deploy
```

---

## Limitations

- Works only on **publicly accessible** URLs (no login-gated or auth-protected pages)
- Heavy pages may hit the 30-second navigation timeout
- GIF file sizes grow with resolution and frame count — keep frames under 20 for shareable file sizes
- Some sites use bot detection that blocks headless browsers

---

## Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

MIT
# GIF_Generator_Website
