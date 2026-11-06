# Invisible Violence Exhibition - Project Plan

## 1) Project Vision

Build an interactive visual installation in p5.js where violent language appears as flying text moving from a projected mouth model to a projected ear model.  
The first version uses simulated random words; later versions ingest real social media content in near real time.

The installation must support projection mapping calibration so visuals align with physical 3D mouth and ear sculptures using 2D reference renderings.

---

## 2) Stage-Based Roadmap

## Stage 0 - Foundation Setup (1-2 days)
**Goal:** Create a robust p5.js project structure and baseline rendering loop.

### Deliverables
- p5.js project scaffold with modular files.
- Fullscreen renderer matching projector resolution.
- Config file for screen size, frame rate, debug flags.
- Placeholder assets folder for mouth/ear reference images.

### Acceptance Criteria
- Project runs smoothly at target resolution.
- Can toggle debug overlays on/off.

---

## Stage 1 - Projection Mapping Calibration (2-4 days)
**Goal:** Define and tune mouth/ear mapping zones on the projected surface.

### Deliverables
- Import 2D mouth and ear rendering references (PNG/SVG).
- Calibration mode UI (keyboard + optional simple panel) to:
  - Move/scale/rotate mouth zone.
  - Move/scale/rotate ear zone.
  - Adjust polygon/quad control points for finer mapping.
- Save/load calibration presets (JSON).
- Visual debug layer (wireframes, anchor points, labels).

### Acceptance Criteria
- Mouth and ear overlays align with physical sculptures within acceptable tolerance.
- Calibration can be restored from saved preset after restart.

---

## Stage 2 - Version 1 Content Simulation: Random Words Flying (2-3 days)
**Goal:** Simulate verbal violence flow from mouth to ear using synthetic words.

### Deliverables
- Word particle system:
  - Spawn origin inside mouth zone.
  - Destination bias toward ear zone.
  - Curved/organic trajectories (noise + attraction).
  - Per-word lifespan, speed, size, opacity.
- Lexicon list of aggressive/violent placeholder words.
- Rendering styles (at least 2):
  - Clean typography mode.
  - Distorted/intense mode (jitter, blur-ish trails, flicker).
- Adjustable parameters for spawn rate, velocity, density.

### Acceptance Criteria
- Stable 60fps (or target frame rate) at exhibition resolution.
- Continuous readable flow from mouth to ear with convincing motion.

---

## Stage 3 - Narrative & Atmosphere Layer (2-4 days)
**Goal:** Improve emotional impact and compositional clarity.

### Deliverables
- Time-based behavior presets (calm -> escalation -> overload).
- Background and transition effects suited for projection surface.
- Optional reactive audio layer (if sound is used) for intensity coupling.
- Scene state manager for switching visual moods.

### Acceptance Criteria
- Operator can trigger or schedule different intensity phases.
- Visual language remains legible on actual projection setup.

---

## Stage 4 - Data Pipeline for Real Posts (Backend + Safety) (4-8 days)
**Goal:** Build secure ingestion pipeline for real-time social media text.

### Deliverables
- Separate backend service (Node.js recommended) to:
  - Fetch posts from approved APIs/sources.
  - Normalize text payloads.
  - Apply filtering/scoring for verbal violence.
  - Expose sanitized stream endpoint for p5.js client.
- Moderation rules:
  - Block personal identifiers when required.
  - Remove URLs/user handles if needed by ethics policy.
  - Language detection support (initially one language, later multilingual).
- Local cache + fallback synthetic generator if API unavailable.

### Acceptance Criteria
- Frontend can consume streamed text with graceful degradation.
- Harmful content handling follows legal/ethical constraints agreed by team.

---

## Stage 5 - Version 2 Live Content Integration (3-5 days)
**Goal:** Replace synthetic words with moderated real-world text units.

### Deliverables
- Data adapter in p5.js:
  - WebSocket/SSE polling client.
  - Queue management and rate control.
- Text chunking strategy:
  - Single words for high density.
  - Short phrases for meaning emphasis.
- Visual encoding based on toxicity/severity score:
  - Size, color, speed, turbulence, trail length.

### Acceptance Criteria
- Installation runs stably for long sessions (2-4+ hours).
- Live stream can be paused, resumed, and switched to fallback mode.

---

## Stage 6 - Exhibition Hardening & Operations (2-4 days)
**Goal:** Make the system reliable for on-site public exhibition.

### Deliverables
- Startup script / kiosk mode launch procedure.
- Auto-recovery strategy (watchdog, auto reload on error).
- Operator controls:
  - Recalibrate quickly.
  - Toggle debug.
  - Switch between synthetic/live modes.
  - Emergency content mute/blank.
- Technical runbook:
  - Setup checklist.
  - Daily start/stop process.
  - Troubleshooting guide.

### Acceptance Criteria
- Team can run installation without developer intervention.
- Recovery from common failures in <5 minutes.

---

## 3) System Architecture (Recommended)

## Frontend (p5.js)
- `CalibrationManager`: transforms and editable control points for mouth/ear mapping.
- `WordEmitter`: spawn logic and pacing.
- `WordParticle`: motion, lifecycle, rendering.
- `SceneManager`: mode transitions and overall timeline.
- `DataClient`: receives synthetic/live text feed.
- `UIControls`: keyboard shortcuts and optional debug panel.

## Backend (later stage)
- `IngestionService`: source API connectors.
- `ModerationService`: filtering/scoring/anonymization.
- `StreamServer`: WebSocket/SSE channel for frontend.
- `Cache/FallbackService`: resilient feed when source APIs fail.

---

## 4) Calibration & Projection Mapping Workflow

1. Load reference 2D mouth/ear images in calibration mode.
2. Operator aligns each reference to the physical model via transform controls.
3. If needed, switch from simple transform to corner-pin/polygon mode.
4. Save calibration profile as JSON per venue/projector setup.
5. In show mode, hide references and render word flow using calibrated zones.

**Note:** Keep multiple profiles (e.g., `studio`, `venueA`, `venueB`) since projector position changes can significantly alter alignment.

---

## 5) Data & Content Strategy

## Version 1 (synthetic)
- Start with curated vocabulary list (aggressive terms + neutral controls).
- Include weighted randomness to control frequency and intensity.

## Version 2+ (live)
- Use approved APIs and comply with Terms of Service.
- Define explicit moderation policy before public deployment.
- Decide whether to display exact text, partially obfuscated text, or transformed tokens.
- Log only what is necessary; avoid storing sensitive raw content unless required.

---

## 6) Technical Risks and Mitigation

- **Projection misalignment drift:** fast recalibration tools + profile presets.
- **Low frame rate at high resolution:** cap particle count, GPU-friendly text rendering, adaptive quality.
- **API instability/rate limits:** caching, retry logic, synthetic fallback mode.
- **Ethical/legal issues with harmful content:** moderation layer, anonymization, emergency mute.
- **Operational failure during exhibition:** watchdog restart + operator runbook.

---

## 7) Testing Plan

- **Visual Tests:** alignment checks, readability from audience distance, contrast on actual material.
- **Performance Tests:** long-run stability and frame-time profiling.
- **Data Tests:** malformed payload handling, disconnected stream recovery.
- **Operational Tests:** startup/shutdown drills and emergency fallback switch.

---

## 8) Suggested Milestones

- **M1:** Stage 0 + Stage 1 complete (calibration workflow functional).
- **M2:** Stage 2 complete (Version 1 random-word simulation ready).
- **M3:** Stage 3 complete (art direction and timeline behaviors polished).
- **M4:** Stage 4 backend pipeline prototype working.
- **M5:** Stage 5 live content end-to-end integration complete.
- **M6:** Stage 6 exhibition hardening and on-site readiness.

---

## 9) Immediate Next Step

After plan approval, implementation should begin with:
1) p5.js project scaffold,  
2) calibration mode and JSON preset save/load,  
3) initial random word emitter from mouth to ear zones.
