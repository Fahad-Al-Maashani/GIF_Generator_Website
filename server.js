const express = require('express');
const puppeteer = require('puppeteer');
const GIFEncoder = require('gif-encoder-2');
const { createCanvas, loadImage } = require('canvas');
const cors = require('cors');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname)));

// ─── Session Store ────────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 min auto-cleanup

function cleanupSession(id) {
  const s = sessions.get(id);
  if (s) {
    s.browser?.close().catch(() => {});
    clearTimeout(s.timer);
    sessions.delete(id);
  }
}

function touchSession(id) {
  const s = sessions.get(id);
  if (s) {
    clearTimeout(s.timer);
    s.timer = setTimeout(() => cleanupSession(id), SESSION_TIMEOUT);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────
function ease(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function interpolate(from, to, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 1 : i / (count - 1);
    const e = ease(t);
    pts.push({
      x: Math.round(from.x + (to.x - from.x) * e),
      y: Math.round(from.y + (to.y - from.y) * e),
    });
  }
  return pts;
}

function buildWaypoints({ mode, pageWidth, pageHeight, vpWidth, vpHeight, totalFrames }) {
  const maxX = Math.max(0, pageWidth - vpWidth);
  const maxY = Math.max(0, pageHeight - vpHeight);

  if (mode === 'corners') {
    const stops = [
      { x: 0, y: 0 }, { x: maxX, y: 0 },
      { x: maxX, y: maxY }, { x: 0, y: maxY }, { x: 0, y: 0 },
    ];
    const perSeg = Math.floor(totalFrames / (stops.length - 1));
    let pts = [];
    for (let s = 0; s < stops.length - 1; s++) {
      const n = (s === stops.length - 2) ? totalFrames - pts.length : perSeg;
      pts = pts.concat(interpolate(stops[s], stops[s + 1], n));
    }
    return pts;
  }
  if (mode === 'browse') {
    const legs = [
      [{ x: 0, y: 0 }, { x: 0, y: maxY }],
      [{ x: 0, y: maxY }, { x: maxX, y: maxY }],
      [{ x: maxX, y: maxY }, { x: maxX, y: 0 }],
      [{ x: maxX, y: 0 }, { x: 0, y: 0 }],
    ];
    const perLeg = Math.floor(totalFrames / legs.length);
    let pts = [];
    for (let l = 0; l < legs.length; l++) {
      const n = (l === legs.length - 1) ? totalFrames - pts.length : perLeg;
      pts = pts.concat(interpolate(legs[l][0], legs[l][1], n));
    }
    return pts;
  }
  if (mode === 'diagonal') {
    const half = Math.floor(totalFrames / 2);
    return [
      ...interpolate({ x: 0, y: 0 }, { x: maxX, y: maxY }, half),
      ...interpolate({ x: maxX, y: maxY }, { x: 0, y: 0 }, totalFrames - half),
    ];
  }
  // Default scroll
  const downCount = Math.floor(totalFrames * 0.6);
  const dwellCount = Math.max(2, Math.floor(totalFrames * 0.1));
  const upCount = totalFrames - downCount - dwellCount;
  return [
    ...interpolate({ x: 0, y: 0 }, { x: 0, y: maxY }, downCount),
    ...Array(dwellCount).fill({ x: 0, y: maxY }),
    ...interpolate({ x: 0, y: maxY }, { x: 0, y: 0 }, upCount),
  ];
}

async function launchBrowser() {
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
}

async function getPageDimensions(page) {
  return page.evaluate(() => ({
    pageWidth: Math.max(document.body.scrollWidth, document.documentElement.scrollWidth),
    pageHeight: Math.max(document.body.scrollHeight, document.documentElement.scrollHeight),
  }));
}

async function preScrollPage(page) {
  await page.evaluate(async () => {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const maxScroll = document.body.scrollHeight;
    const step = window.innerHeight;
    for (let y = 0; y <= maxScroll; y += step) {
      window.scrollTo(0, y);
      await delay(80);
    }
    window.scrollTo(0, 0);
    await delay(200);
  });
  await new Promise(r => setTimeout(r, 500));
}

// ─── Quick Generate (auto mode) ──────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const { url, frames = 20, delay = 120, width = 1280, mode = 'scroll' } = req.body;
  const frameWidth = Math.min(Math.max(parseInt(width) || 1280, 320), 1920);
  const frameHeight = Math.round(frameWidth * (9 / 16));
  const totalFrames = Math.min(Math.max(parseInt(frames) || 20, 5), 40);
  const frameDelay = Math.min(Math.max(parseInt(delay) || 120, 50), 500);
  const scanMode = ['scroll', 'corners', 'browse', 'diagonal'].includes(mode) ? mode : 'scroll';

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Please provide a valid URL starting with http/https' });
  }

  let browser;
  try {
    browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: frameWidth, height: frameHeight });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await preScrollPage(page);

    const { pageWidth, pageHeight } = await getPageDimensions(page);
    const waypoints = buildWaypoints({
      mode: scanMode, pageWidth, pageHeight,
      vpWidth: frameWidth, vpHeight: frameHeight, totalFrames,
    });

    const encoder = new GIFEncoder(frameWidth, frameHeight);
    encoder.setDelay(frameDelay);
    encoder.setRepeat(0);
    encoder.setQuality(10);
    encoder.start();

    const canvas = createCanvas(frameWidth, frameHeight);
    const ctx = canvas.getContext('2d');

    for (let i = 0; i < waypoints.length; i++) {
      const { x, y } = waypoints[i];
      await page.evaluate((sx, sy) => window.scrollTo({ left: sx, top: sy, behavior: 'smooth' }), x, y);
      await new Promise(r => setTimeout(r, i === 0 || i === waypoints.length - 1 ? 400 : 200));
      await page.mouse.move(
        Math.floor(frameWidth * (0.2 + Math.random() * 0.6)),
        Math.floor(frameHeight * (0.2 + Math.random() * 0.6)),
        { steps: 3 }
      );
      const buf = await page.screenshot({ type: 'png' });
      const img = await loadImage(buf);
      ctx.drawImage(img, 0, 0, frameWidth, frameHeight);
      encoder.addFrame(ctx);
    }

    encoder.finish();
    res.set('Content-Type', 'image/gif');
    res.set('Content-Disposition', 'inline; filename="preview.gif"');
    res.send(encoder.out.getData());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Failed to generate GIF' });
  } finally {
    if (browser) await browser.close();
  }
});

// ─── Interactive Studio: Start Session ───────────────────────────────
app.post('/api/session/start', async (req, res) => {
  const { url, width = 1280 } = req.body;
  const vpWidth = Math.min(Math.max(parseInt(width) || 1280, 320), 1920);
  const vpHeight = Math.round(vpWidth * (9 / 16));

  if (!url || !url.startsWith('http')) {
    return res.status(400).json({ error: 'Please provide a valid URL' });
  }

  try {
    const browser = await launchBrowser();
    const page = await browser.newPage();
    await page.setViewport({ width: vpWidth, height: vpHeight });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    await preScrollPage(page);

    const { pageWidth, pageHeight } = await getPageDimensions(page);

    // Take full-page screenshot for minimap (scaled down)
    const fullPageBuf = await page.screenshot({ type: 'png', fullPage: true });
    const fullPageB64 = fullPageBuf.toString('base64');

    // Take initial viewport screenshot
    await page.evaluate(() => window.scrollTo(0, 0));
    await new Promise(r => setTimeout(r, 300));
    const viewportBuf = await page.screenshot({ type: 'png' });
    const viewportB64 = viewportBuf.toString('base64');

    const sessionId = crypto.randomUUID();
    const timer = setTimeout(() => cleanupSession(sessionId), SESSION_TIMEOUT);

    sessions.set(sessionId, {
      browser, page, timer,
      vpWidth, vpHeight, pageWidth, pageHeight,
      waypoints: [],
      scrollX: 0, scrollY: 0,
    });

    res.json({
      sessionId,
      pageWidth, pageHeight, vpWidth, vpHeight,
      fullPage: fullPageB64,
      viewport: viewportB64,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive Studio: Live Scroll Preview ─────────────────────────
app.post('/api/session/scroll', async (req, res) => {
  const { sessionId, x = 0, y = 0 } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(sessionId);

  try {
    const sx = Math.min(Math.max(parseInt(x) || 0, 0), s.pageWidth - s.vpWidth);
    const sy = Math.min(Math.max(parseInt(y) || 0, 0), s.pageHeight - s.vpHeight);

    await s.page.evaluate((px, py) => window.scrollTo(px, py), sx, sy);
    await new Promise(r => setTimeout(r, 150));

    const buf = await s.page.screenshot({ type: 'png' });
    s.scrollX = sx;
    s.scrollY = sy;

    res.json({ viewport: buf.toString('base64'), x: sx, y: sy });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive Studio: Capture Waypoint ────────────────────────────
app.post('/api/session/waypoint/add', async (req, res) => {
  const { sessionId, delay = 150, label = '' } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(sessionId);

  try {
    const buf = await s.page.screenshot({ type: 'png' });

    // Resize to small thumbnail for timeline
    const thumbCanvas = createCanvas(160, 90);
    const thumbCtx = thumbCanvas.getContext('2d');
    const img = await loadImage(buf);
    thumbCtx.drawImage(img, 0, 0, 160, 90);
    const thumbSmall = thumbCanvas.toBuffer('image/png').toString('base64');

    const wp = {
      id: crypto.randomUUID(),
      x: s.scrollX,
      y: s.scrollY,
      delay: Math.min(Math.max(parseInt(delay) || 150, 30), 2000),
      label: String(label).slice(0, 50),
      thumb: thumbSmall,
    };

    s.waypoints.push(wp);
    res.json({ waypoint: wp, total: s.waypoints.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive Studio: Update Waypoint ─────────────────────────────
app.post('/api/session/waypoint/update', async (req, res) => {
  const { sessionId, waypointId, delay, label } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(sessionId);

  const wp = s.waypoints.find(w => w.id === waypointId);
  if (!wp) return res.status(404).json({ error: 'Waypoint not found' });

  if (delay !== undefined) wp.delay = Math.min(Math.max(parseInt(delay) || 150, 30), 2000);
  if (label !== undefined) wp.label = String(label).slice(0, 50);

  res.json({ waypoint: wp });
});

// ─── Interactive Studio: Remove Waypoint ─────────────────────────────
app.post('/api/session/waypoint/remove', async (req, res) => {
  const { sessionId, waypointId } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(sessionId);

  s.waypoints = s.waypoints.filter(w => w.id !== waypointId);
  res.json({ total: s.waypoints.length });
});

// ─── Interactive Studio: Reorder Waypoints ───────────────────────────
app.post('/api/session/waypoint/reorder', async (req, res) => {
  const { sessionId, order } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(sessionId);

  if (!Array.isArray(order)) return res.status(400).json({ error: 'order must be array of ids' });

  const map = new Map(s.waypoints.map(w => [w.id, w]));
  const reordered = [];
  for (const id of order) {
    if (map.has(id)) reordered.push(map.get(id));
  }
  s.waypoints = reordered;
  res.json({ total: s.waypoints.length });
});

// ─── Interactive Studio: Get All Waypoints ───────────────────────────
app.get('/api/session/waypoints/:sessionId', (req, res) => {
  const s = sessions.get(req.params.sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(req.params.sessionId);
  res.json({ waypoints: s.waypoints });
});

// ─── Interactive Studio: Generate GIF From Waypoints ─────────────────
app.post('/api/session/generate', async (req, res) => {
  const { sessionId } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(sessionId);

  if (s.waypoints.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 waypoints to generate a GIF' });
  }

  try {
    const encoder = new GIFEncoder(s.vpWidth, s.vpHeight);
    encoder.setRepeat(0);
    encoder.setQuality(10);
    encoder.start();

    const canvas = createCanvas(s.vpWidth, s.vpHeight);
    const ctx = canvas.getContext('2d');

    for (const wp of s.waypoints) {
      encoder.setDelay(wp.delay);

      await s.page.evaluate((px, py) => window.scrollTo(px, py), wp.x, wp.y);
      await new Promise(r => setTimeout(r, 200));

      // Move mouse to center for human feel
      await s.page.mouse.move(
        Math.floor(s.vpWidth * (0.3 + Math.random() * 0.4)),
        Math.floor(s.vpHeight * (0.3 + Math.random() * 0.4)),
        { steps: 3 }
      );

      const buf = await s.page.screenshot({ type: 'png' });
      const img = await loadImage(buf);
      ctx.drawImage(img, 0, 0, s.vpWidth, s.vpHeight);
      encoder.addFrame(ctx);
    }

    encoder.finish();
    res.set('Content-Type', 'image/gif');
    res.set('Content-Disposition', 'inline; filename="preview.gif"');
    res.send(encoder.out.getData());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive Studio: Batch Capture (for recording mode) ──────────
app.post('/api/session/batch-capture', async (req, res) => {
  const { sessionId, positions } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(sessionId);

  if (!Array.isArray(positions) || positions.length === 0 || positions.length > 60) {
    return res.status(400).json({ error: 'positions must be an array of 1-60 items' });
  }

  try {
    const captured = [];
    const thumbCanvas = createCanvas(160, 90);
    const thumbCtx = thumbCanvas.getContext('2d');

    for (const pos of positions) {
      const px = Math.min(Math.max(parseInt(pos.x) || 0, 0), Math.max(0, s.pageWidth - s.vpWidth));
      const py = Math.min(Math.max(parseInt(pos.y) || 0, 0), Math.max(0, s.pageHeight - s.vpHeight));
      const delay = Math.min(Math.max(parseInt(pos.delay) || 120, 30), 2000);

      await s.page.evaluate((sx, sy) => window.scrollTo(sx, sy), px, py);
      await new Promise(r => setTimeout(r, 100));

      const buf = await s.page.screenshot({ type: 'png' });
      const img = await loadImage(buf);
      thumbCtx.drawImage(img, 0, 0, 160, 90);
      const thumbSmall = thumbCanvas.toBuffer('image/png').toString('base64');

      const wp = {
        id: crypto.randomUUID(),
        x: px, y: py, delay,
        label: '', thumb: thumbSmall,
      };
      s.waypoints.push(wp);
      captured.push(wp);
    }

    s.scrollX = captured[captured.length - 1].x;
    s.scrollY = captured[captured.length - 1].y;

    res.json({ captured, total: s.waypoints.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive Studio: Interpolate Between Waypoints ───────────────
app.post('/api/session/interpolate', async (req, res) => {
  const { sessionId, steps = 5 } = req.body;
  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session expired' });
  touchSession(sessionId);

  if (s.waypoints.length < 2) {
    return res.status(400).json({ error: 'Need at least 2 keyframes to interpolate' });
  }

  const stepsPerGap = Math.min(Math.max(parseInt(steps) || 5, 2), 15);

  try {
    const oldWaypoints = [...s.waypoints];
    const newWaypoints = [];
    const thumbCanvas = createCanvas(160, 90);
    const thumbCtx = thumbCanvas.getContext('2d');

    for (let i = 0; i < oldWaypoints.length; i++) {
      // Keep the original keyframe
      newWaypoints.push(oldWaypoints[i]);

      // Interpolate between this and the next keyframe
      if (i < oldWaypoints.length - 1) {
        const from = oldWaypoints[i];
        const to = oldWaypoints[i + 1];
        const avgDelay = Math.round((from.delay + to.delay) / 2);

        // Generate intermediate positions with easing
        for (let j = 1; j < stepsPerGap; j++) {
          const t = j / stepsPerGap;
          const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
          const ix = Math.round(from.x + (to.x - from.x) * e);
          const iy = Math.round(from.y + (to.y - from.y) * e);

          await s.page.evaluate((sx, sy) => window.scrollTo(sx, sy), ix, iy);
          await new Promise(r => setTimeout(r, 80));

          const buf = await s.page.screenshot({ type: 'png' });
          const img = await loadImage(buf);
          thumbCtx.drawImage(img, 0, 0, 160, 90);
          const thumbSmall = thumbCanvas.toBuffer('image/png').toString('base64');

          newWaypoints.push({
            id: crypto.randomUUID(),
            x: ix, y: iy,
            delay: avgDelay,
            label: '',
            thumb: thumbSmall,
          });
        }
      }
    }

    s.waypoints = newWaypoints;
    res.json({
      waypoints: newWaypoints,
      total: newWaypoints.length,
      added: newWaypoints.length - oldWaypoints.length,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Interactive Studio: Close Session ───────────────────────────────
app.post('/api/session/close', (req, res) => {
  const { sessionId } = req.body;
  cleanupSession(sessionId);
  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
