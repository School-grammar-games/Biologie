"use strict";

/* Geometrie-, Habitat- und Masken-Hilfsfunktionen. */
  function clamp(v,a,b){ return Math.max(a, Math.min(b,v)); }
  function randChoice(arr){ return arr[Math.floor(Math.random()*arr.length)]; }



  // --- Bounds & Bewegung (für "nur nach rechts" + Schlangenlinien) ---
  function computeBounds(samples, W, H){
    if (!samples || !samples.length) return {minX:0, maxX:W-1, minY:0, maxY:H-1};
    let minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;
    for (const p of samples){
      const x = p[0], y = p[1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    minX = clamp(minX, 0, W-1); maxX = clamp(maxX, 0, W-1);
    minY = clamp(minY, 0, H-1); maxY = clamp(maxY, 0, H-1);
    return {minX, maxX, minY, maxY};
  }

  function habitatBounds(habitat, z){
    if (!z) return {minX:0, maxX:0, minY:0, maxY:0};
    if (z.fullHabitat) return {minX:0, maxX:z.w-1, minY:0, maxY:z.h-1};
    const useRed = (habitat==="red") || (habitat==="purple" && z.sharedHabitat);
    const b = useRed ? z.redBounds : z.purpleBounds;
    return b || {minX:0, maxX:z.w-1, minY:0, maxY:z.h-1};
  }

  function habitatCenter(habitat, z){
    if (!z) return {x:0, y:0};
    if (z.fullHabitat) return {x:(z.w-1)/2, y:(z.h-1)/2};
    const useRed = (habitat==="red") || (habitat==="purple" && z.sharedHabitat);
    const c = useRed ? z.redCenter : z.purpleCenter;
    return c || {x:(z.w-1)/2, y:(z.h-1)/2};
  }

  // Echsen-Bewegung: natürliches Muster mit Idle/Wander-Zuständen, alle Richtungen möglich.
  // Sprite-Kopf zeigt im GIF nach rechts -> wird bei Linksbewegung gespiegelt (in updateSprites).
  // (Migration nutzt weiterhin Zielpunkte und darf alle Richtungen verwenden, damit das Ereignis stabil bleibt.)
  function stepLizardWiggle(l, dt){
    const z = activeZone();
    if (!z) return;

    // Sicherheitscheck: falls Echse außerhalb ihrer Zone ist, sofort zurücksnappen
    if (!allowed(l.habitat, l.x, l.y)){
      const sp = snapToHabitat(l.habitat, l.x, l.y);
      l.x = sp.x; l.y = sp.y;
      // Nach Snap: Richtung zum Zonenzentrum, kurze Pause
      const cSnap = habitatCenter(l.habitat, z);
      l.heading = Math.atan2(cSnap.y - l.y, cSnap.x - l.x);
      l.behaviorState = "idle";
      l.stateTimer = 0.5 + Math.random();
      return;
    }

    // Init Zustandsmaschine (einmalig / Legacy-Kompatibilität)
    if (!l.behaviorState) {
      l.behaviorState = "wander";       // "idle" oder "wander"
      l.stateTimer = 1.0 + Math.random() * 2.5; // Dauer des aktuellen Zustands
      l.heading = Math.random() * Math.PI * 2;   // volle 360°
      l.turnVel = 0;
      l.facingRight = true;  // Sprite-Spiegelung
    }

    // Zustandsübergänge
    l.stateTimer -= dt;
    if (l.stateTimer <= 0) {
      if (l.behaviorState === "idle") {
        // Nach Ruhe: loswandern in neue Richtung
        l.behaviorState = "wander";
        l.stateTimer = 1.5 + Math.random() * 3.0;  // 1.5–4.5s wandern
        l.heading = Math.random() * Math.PI * 2;    // neue zufällige Richtung
        l.turnVel = (Math.random() * 2 - 1) * 0.8;
      } else {
        // Nach Wandern: Pause einlegen
        l.behaviorState = "idle";
        l.stateTimer = 0.8 + Math.random() * 2.5;  // 0.8–3.3s Pause
      }
    }

    // Im Idle-Zustand: Echse steht still
    if (l.behaviorState === "idle") {
      return;
    }

    // Wander-Zustand: sanfte Richtungsänderungen, alle Richtungen
    l.turnVel += (Math.random() * 2 - 1) * 2.0 * dt;
    l.turnVel = clamp(l.turnVel, -1.8, 1.8);
    l.heading += l.turnVel * dt;

    // Gelegentlich spontane kleine Richtungsänderung (Echsen-typisch: ruckartig)
    if (Math.random() < 0.3 * dt) {
      l.heading += (Math.random() * 2 - 1) * 0.6;
      l.turnVel *= 0.5;
    }

    // Geschwindigkeit variiert leicht (Echsen beschleunigen und bremsen)
    const speedMult = 0.6 + Math.random() * 0.8; // 60%-140% der Basisgeschwindigkeit

    // Tag/Nacht-Speed (nur Verbrannt & Geröll; rot/lila entgegengesetzt)
    const effectiveMap = (state.morphActive && state.morphTarget) ? state.morphTarget : state.mapName;
    const base = Number.isFinite(l.baseSpeed) ? l.baseSpeed : l.speed;
    const zoneTimeMul = getLizardDayNightZoneMult(effectiveMap, l.habitat, state.day);
    const curSpeed = base * zoneTimeMul * speedMult;

    const vx = Math.cos(l.heading) * curSpeed;
    const vy = Math.sin(l.heading) * curSpeed;

    let nx = l.x + vx * dt;
    let ny = l.y + vy * dt;

    // Sprite-Richtung merken (für Spiegelung)
    l.facingRight = vx >= 0;

    // Zonenbegrenzung: sanft von Rand ablenken statt harter Kollision
    const b = habitatBounds(l.habitat, z);
    const margin = Math.max(12, 20 * getDeviceLogicScaleForKind("lizard")); // Randabstand (skaliert für Tablet-Sprites)

    // Weiche Rand-Ablenkung: Heading zum Zonenzentrum drehen
    const c = habitatCenter(l.habitat, z);
    const cx = c.x;
    const cy = c.y;
    let edgePush = 0;
    if (l.x < b.minX + margin || l.x > b.maxX - margin ||
        l.y < b.minY + margin || l.y > b.maxY - margin) {
      const toCenter = Math.atan2(cy - l.y, cx - l.x);
      let diff = toCenter - l.heading;
      // Winkel normalisieren auf [-PI, PI]
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      edgePush = diff * 3.0 * dt; // sanftes Drehen Richtung Mitte
      l.heading += edgePush;
    }

    // Position clampen
    nx = clamp(nx, 0, z.w - 1);
    ny = clamp(ny, 0, z.h - 1);

    if (allowed(l.habitat, nx, ny)){
      l.x = nx; l.y = ny;
      return;
    }

    // Boundary handling: bisection along old->new
    let lo = 0, hi = 1, bx2 = l.x, by2 = l.y;
    for (let i = 0; i < 10; i++){
      const mid = (lo + hi) / 2;
      const mx = l.x + (nx - l.x) * mid;
      const my = l.y + (ny - l.y) * mid;
      if (allowed(l.habitat, mx, my)) { lo = mid; bx2 = mx; by2 = my; } else hi = mid;
    }
    if (lo > 0){
      l.x = bx2; l.y = by2;
    } else {
      const sp = snapToHabitat(l.habitat, l.x, l.y);
      l.x = sp.x; l.y = sp.y;
    }
    // Bei Kollision mit Zonenrand: Richtung umkehren + Zufalls-Versatz
    l.heading += Math.PI + (Math.random() * 2 - 1) * 0.5;
    l.turnVel *= -0.3;
  }

  function pointOnSegment(x, y, x1, y1, x2, y2, eps=0.75){
    const dx=x2-x1, dy=y2-y1;
    const px=x-x1, py=y-y1;
    const cross = dx*py - dy*px;
    if (Math.abs(cross) > eps) return false;
    const dot = px*dx + py*dy;
    if (dot < -eps) return false;
    const len2 = dx*dx + dy*dy;
    if (dot - len2 > eps) return false;
    return true;
  }

  function pointInPolyInclusive(x, y, poly){
    let inside=false;
    for (let i=0, j=poly.length-1; i<poly.length; j=i){
      const xi=poly[i][0], yi=poly[i][1];
      const xj=poly[j][0], yj=poly[j][1];
      if (pointOnSegment(x,y, xi,yi, xj,yj)) return true;
      const intersect = ((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-9) + xi);
      if (intersect) inside=!inside;
    }
    return inside;
  }

  function inAnyPoly(x,y,polys){
    for (const poly of polys) {
      if (poly && poly.length>=3 && pointInPolyInclusive(x,y,poly)) return true;
    }
    return false;
  }

  function getZone(mapName){
    const base = ZONE_DATA[mapName];
    if (!base) return null;

    // Sonderfall: Hintergrund_Trocken = gesamter Bereich ist 1 Habitat (keine Bewegungs-/Spawn-Einschränkung)
    // (du hast Spawn_Trocken entfernt; diese Karte soll vollflächig begehbar sein)
    // Hinweis: wir setzen fullHabitat=true, damit allowed/pickSpawn/snapToHabitat entsprechend reagieren.
    
    // IMPORTANT:
    // Einige Karten (z.B. Hintergrund_Trocken) besitzen keine separate lila-Zone (purplePolys leer).
    // Ohne Sonderbehandlung wären lila Echsen *nirgendwo* erlaubt -> teure snapToHabitat-Schleifen pro Frame (Freeze).
    const z = { ...base };


if (mapName==="Hintergrund_Trocken"){
  // In den Zonendaten von "Trocken" liegen häufig beide Habitate in redPolys (2 Polygone),
  // während purplePolys leer ist. Wir rekonstruieren rot/lila, damit Zonen wieder gelten.
  z.fullHabitat = false;
  z.sharedHabitat = false;

  const hasTwo = (!z.purplePolys || z.purplePolys.length===0) && (z.redPolys && z.redPolys.length>=2);
  if (hasTwo){
    const pA = z.redPolys[0], pB = z.redPolys[1];
    const cx = (poly)=> poly.reduce((s,p)=>s+p[0],0)/Math.max(1, poly.length);
    const left = (cx(pA) < cx(pB)) ? pA : pB;
    const right = (left===pA) ? pB : pA;

    z.redPolys = [left];
    z.purplePolys = [right];

    // Samples für Trocken sind in manchen Versionen nicht sauber getrennt -> neu generieren.
    const genSamples = (poly, n=2500)=>{
      let minX=1e9, minY=1e9, maxX=-1e9, maxY=-1e9;
      for (const pt of poly){
        const x = pt[0], y = pt[1];
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      minX = clamp(minX, 0, z.w-1); maxX = clamp(maxX, 0, z.w-1);
      minY = clamp(minY, 0, z.h-1); maxY = clamp(maxY, 0, z.h-1);

      const out = [];
      let guard = 0;
      const maxGuard = n * 120; // ausreichend auch bei schmalen Bereichen
      while (out.length < n && guard < maxGuard){
        guard++;
        const x = minX + Math.random()*(maxX-minX);
        const y = minY + Math.random()*(maxY-minY);
        if (pointInPolyInclusive(x, y, poly)) out.push([Math.round(x), Math.round(y)]);
      }
      if (out.length < Math.min(200, n)){
        for (const pt of poly) out.push([pt[0], pt[1]]);
      }
      return out;
    };

    z.redSamples = genSamples(left, 2500);
    z.purpleSamples = genSamples(right, 2500);
  } else {
    // Wenn wirklich nur 1 Habitat existiert, teilen beide Populationen den Lebensraum (wie rot).
    z.sharedHabitat = true;
  }
}if ((!z.purplePolys || z.purplePolys.length===0) && !z.sharedHabitat){
      // Fallback: beide Populationen teilen sich den gleichen Lebensraum (wie rot)
      z.sharedHabitat = true;
    }

    // Bounds für rechtsgerichtete Schlangenbewegung (Wrap/Clamping)
    z.redBounds = computeBounds(z.redSamples, z.w, z.h);
    const purSamples = (z.sharedHabitat ? z.redSamples : z.purpleSamples);
    z.purpleBounds = computeBounds(purSamples, z.w, z.h);

    // "Sicheres Zentrum" pro Habitat: Schwerpunkt der Samplepunkte (liegt i.d.R. in der Zone).
    const computeCenter = (samples)=>{
      if (!samples || !samples.length) return {x:(z.w-1)/2, y:(z.h-1)/2};
      let sx=0, sy=0;
      for (const p of samples){ sx += p[0]; sy += p[1]; }
      return {x: sx/samples.length, y: sy/samples.length};
    };
    z.redCenter = computeCenter(z.redSamples);
    z.purpleCenter = computeCenter(purSamples);

    
    // --- Robustere Habitat-Prüfung: Sample-basierte Masken ---
    // Die Habitat-Polygone sind bewusst grob (für geringe Dateigröße). Damit können Agenten optisch "in den Fluss" driften,
    // obwohl dort keine gültigen Spawn-Samples existieren. Deshalb nutzen wir zusätzlich eine aus Samples abgeleitete Gitter-Maske.
    // Wichtig: erst NACH eventuellen Sonderfällen (z.B. Trocken-Rekonstruktion) erzeugen.
    const CELL = 8;   // Pixel pro Gitterzelle (kleiner = genauer)
    const R = 3;      // Dilationsradius in Zellen (3 => ~24px bei CELL=8)
    const gw = Math.ceil(z.w / CELL);
    const gh = Math.ceil(z.h / CELL);

    const buildMask = (samples)=>{
      if (!samples || !samples.length) return null;
      const data = new Uint8Array(gw*gh);
      for (let i=0;i<samples.length;i++){
        const px = samples[i][0], py = samples[i][1];
        const cx = (px / CELL) | 0;
        const cy = (py / CELL) | 0;
        for (let dy=-R; dy<=R; dy++){
          const yy = cy + dy;
          if (yy < 0 || yy >= gh) continue;
          const row = yy * gw;
          for (let dx=-R; dx<=R; dx++){
            const xx = cx + dx;
            if (xx < 0 || xx >= gw) continue;
            data[row + xx] = 1;
          }
        }
      }
      return {cell:CELL, gw, gh, data};
    };

    z.redMask = buildMask(z.redSamples);
    z.purpleMask = buildMask(z.purpleSamples);
    z._maskReady = true;
return z;
  }

  function polyToSvgMask(polys, w, h){
    if (!polys || !polys.length) return null;
    const paths = polys.map(poly => {
      if (!poly || poly.length<3) return "";
      let d = `M ${poly[0][0]} ${poly[0][1]}`;
      for (let i=1;i<poly.length;i++) d += ` L ${poly[i][0]} ${poly[i][1]}`;
      return `<path d="${d} Z" />`;
    }).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">`+
                `<rect width="100%" height="100%" fill="black"/>`+
                `<g fill="white">${paths}</g></svg>`;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

/* Kernsimulation: State, Timeline, Preloading, Agenten, Diagramme, Export und Animation. */
  // ---- Simulation State ----
  const state = {
    running:false,
    paused:false,
    mapName:"Hintergrund_Trocken",
    bgImg:null,
    zone:null,
    agents:[],
    nextId:1,
    t:0,
    day:true,
    phaseLen:18, // Sekunden (Tag/Nacht)
    lastFrame:0,
    history:[], // {t, red, pur}
    historyAll:[], // vollständiger Verlauf für Export
    typeHistoryRed: [],   // [{cycle, counts:{morph:n}}]
    typeHistoryPurple: [], // [{cycle, counts:{morph:n}}]
    
    events:[], // {t, kind}
    eventsAll:[], // vollständiger Ereignisverlauf für Export
effectTimer:null,
    morphActive:false,
    morphFrom:null,
    morphTo:null,
    morphT:0,
    morphTarget:null,

    // View / Performance
    viewRect:null,
    scaleX:1,
    scaleY:1,
    bgDirty:true,

    // Transition / Logic zone override
    logicZone:null,        // when set, movement/spawn restrictions use this zone instead of state.zone
    transition:null,       // {kind, fromMap, toMap, startT, dur, migrateAt, migrated, endT}
    ambientTimer:0,
    // getrennte Jäger-Speed-Multiplikatoren (nur im Code ändern – keine UI-Regler)
    predSpeedMulWeasel: 2.1125,
    predSpeedMulFox: 1.56,

    // Fester Story-Zeitplan (Zyklen = Tag+Nacht)
    timelineEnabled: true,
    lastCycleIndex: 0,
    cycleCount: 0,
    timelineStage: 0,        // 0:Start, 1:Regen->Überschwemmung, 2:Normal, 3:Wahl-Popup, 4:Branch1, 5:Branch2, 6:Ende
    timelineBranch: null,    // "fire" | "storm"
    timelineChoiceCycle: 0,
    timelinePending: null,
    choiceOpen: false,
    rainIntroOpen: false,
    redLowFoxFreezeLatched: false,
    redLowFoxFreezeAt: null,
    redLowFoxFreezeIdCutoff: null,
    redLowFoxFrozenIds: new Set(),
    
    purpleLowWeaselFreezeLatched: false,
    purpleLowWeaselFreezeAt: null,
    purpleLowWeaselFreezeIdCutoff: null,
    purpleLowWeaselFrozenIds: new Set(),
    weatherFxCompletedCount: 0,
    lizardDistanceTrackActive: false,
    lizardDist: { red:{day:0, night:0}, purple:{day:0, night:0} },

    // Device-Profil (Tablet): Sprite- und Logik-Skalierung für Jäger/Echsen
    isTablet:false,
    deviceSpriteScale:1,
    deviceLogicScale:1,
};

  // ---- Device profile (Tablet-spezifische Skalierung) ----
  // Nur für Tablets: Jäger- und Echsen-GIFs um 25% verkleinern (Skalierung 0.75).
  const TABLET_AGENT_SCALE = 0.75;

  function detectTabletDevice(){
    const ua = (navigator && navigator.userAgent) ? navigator.userAgent : "";
    const isAndroidTablet = /\bAndroid\b/i.test(ua) && !/\bMobile\b/i.test(ua);
    const isiPad = /\biPad\b/i.test(ua);
    const isIPadOS = /\bMacintosh\b/i.test(ua) && (navigator && (navigator.maxTouchPoints||0) > 1);

    const coarse = !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches);
    const w = Math.max(0, window.innerWidth || 0);
    const h = Math.max(0, window.innerHeight || 0);
    const minSide = Math.min(w, h);
    const maxSide = Math.max(w, h);

    // Heuristik: Touch/Coarse + typische Tablet-Dimensionen (vermeidet Phones <600px).
    const sizeHeuristic = coarse && (minSide >= 600) && (maxSide <= 1366);

    return !!(isiPad || isIPadOS || isAndroidTablet || sizeHeuristic);
  }

  function applyDeviceProfile(){
    const isTab = detectTabletDevice();
    state.isTablet = isTab;
    state.deviceSpriteScale = isTab ? TABLET_AGENT_SCALE : 1;
    // Logik-Skalierung: Radii/Margins an die visuelle Sprite-Größe koppeln (nur für Tablet relevant)
    state.deviceLogicScale = state.deviceSpriteScale;

    document.documentElement.classList.toggle("tabletDevice", isTab);
  }

  function getDeviceSpriteScaleForAgent(a){
    const s = (state && Number.isFinite(state.deviceSpriteScale)) ? state.deviceSpriteScale : 1;
    if (s === 1) return 1;
    if (!a) return 1;
    if (a.kind === "pred" || a.kind === "lizard" || a.kind === "ambient") return s;
    return 1;
  }

  function getDeviceLogicScaleForKind(kind){
    const s = (state && Number.isFinite(state.deviceLogicScale)) ? state.deviceLogicScale : 1;
    if (s === 1) return 1;
    if (kind === "pred" || kind === "lizard" || kind === "ambient") return s;
    return 1;
  }

  const simWrap = document.getElementById("simWrap");
  const simCanvas = document.getElementById("simCanvas");
  const ctx = simCanvas.getContext("2d");
  const spriteLayer = document.getElementById("spriteLayer");
  const zoneTintRed = document.getElementById("zoneTintRed");
  const zoneTintPurple = document.getElementById("zoneTintPurple");
  const rainOverlay = document.getElementById("rainOverlay");
  const fireOverlay = document.getElementById("fireOverlay");
  const firePatchLayer = document.getElementById("firePatchLayer");
  const lightningOverlay = document.getElementById("lightningOverlay");

  const chartHiddenPopulation = document.getElementById("chartHiddenPopulation");
  const chartHiddenTypesRed = document.getElementById("chartHiddenTypesRed");
  const chartHiddenTypesPurple = document.getElementById("chartHiddenTypesPurple");

  const btnExportEnd = document.getElementById("btnExportEnd");
  const btnDisplayEnd = document.getElementById("btnDisplayEnd");
  const inlineExportResult = document.getElementById("inlineExportResult");
  const inlineExportPreview = document.getElementById("inlineExportPreview");
  const inlineExportCloseBtn = document.getElementById("inlineExportCloseBtn");
  const exportBackdrop = document.getElementById("exportBackdrop");
  const exportPreview = document.getElementById("exportPreview");
  const exportCloseBtn = document.getElementById("exportCloseBtn");
  const exportDownloadBtn = document.getElementById("exportDownloadBtn");

  if (btnExportEnd) btnExportEnd.addEventListener("click", ()=>{ exportEndChartsToClipboard(); });
  if (btnDisplayEnd) btnDisplayEnd.addEventListener("click", ()=>{ showEndChartsInline(); });

  // Blitz-GIF: nur vorhandene Dateien referenzieren, damit die Browser-Console nicht mit 404-Fallbacks geflutet wird.
  function setGifSrcWithFallback(imgEl, candidates){
    let i = 0;
    const trySet = ()=>{
      imgEl.src = candidates[i];
    };
    imgEl.onerror = ()=>{
      i++;
      if (i < candidates.length){
        trySet();
      } else {
        console.warn("Kein gültiges Blitz-GIF gefunden. Erwartet eine der Dateien:", candidates);
      }
    };
    trySet();
  }
  setGifSrcWithFallback(lightningOverlay, [
    "GIFs/Gewitter.gif",
    "GIFs/Gewitter.GIF"
  ]);


// --- Story-Zeitplan + Entscheidungspopup ---
const introBackdrop = document.getElementById("introBackdrop");
const introStartBtn = document.getElementById("introStartBtn");
const choiceBackdrop = document.getElementById("choiceBackdrop");
const choiceStormBtn = document.getElementById("choiceStormBtn");
const choiceFireBtn  = document.getElementById("choiceFireBtn");
const rainIntroBackdrop = document.getElementById("rainIntroBackdrop");
const rainIntroStartBtn = document.getElementById("rainIntroStartBtn");
const endRunBackdrop = document.getElementById("endRunBackdrop");
const endRunExportBtn = document.getElementById("endRunExportBtn");
const endRunDisplayBtn = document.getElementById("endRunDisplayBtn");
const endRunCloseBtn = document.getElementById("endRunCloseBtn");
const endRunStory = document.getElementById("endRunStory");

function openIntroModal(){
  if (!introBackdrop) return;
  introBackdrop.style.display = "flex";
}
function closeIntroModal(){
  if (!introBackdrop) return;
  introBackdrop.style.display = "none";
}
if (introStartBtn) introStartBtn.addEventListener("click", ()=>{
  closeIntroModal();
  const btnStart = document.getElementById("btnStart");
  if (btnStart && !btnStart.disabled) btnStart.click();
});

function openEndRunModal(){
  if (!endRunBackdrop) return;
  const chosen = (state.timelineBranch === "fire") ? "Waldbrand" : (state.timelineBranch === "storm") ? "Gewitter" : null;
  if (endRunStory){
    endRunStory.innerHTML = chosen
      ? `Du kannst jetzt die Ergebnisse exportieren oder direkt unterhalb der Simulation anzeigen. In Durchlauf&nbsp;1 wurde das Wettereignis <strong>${chosen}</strong> gewählt. Starte danach einen weiteren Durchlauf mit dem <strong>anderen</strong> Wettereignis und vergleiche anschließend die Ergebnisse beider Durchläufe.`
      : 'Du kannst jetzt die Ergebnisse exportieren oder direkt unterhalb der Simulation anzeigen. Starte danach einen weiteren Durchlauf mit einem anderen Wettereignis als in Durchlauf&nbsp;1 und vergleiche anschließend die Ergebnisse beider Durchläufe.';
  }
  endRunBackdrop.style.display = "flex";
}
function closeEndRunModal(){
  if (!endRunBackdrop) return;
  endRunBackdrop.style.display = "none";
}
if (endRunExportBtn) endRunExportBtn.addEventListener("click", ()=>{ exportEndChartsToClipboard(); });
if (endRunDisplayBtn) endRunDisplayBtn.addEventListener("click", ()=>{ closeEndRunModal(); showEndChartsInline(); });
if (endRunCloseBtn) endRunCloseBtn.addEventListener("click", closeEndRunModal);

function openChoiceModal(){
  if (!choiceBackdrop) return;
  // Branch-Ziele vorladen, damit der Morph auf Tablets sofort mit dem GIF startet.
  preloadBackgrounds(["Hintergrund_Geroell2", "Hintergrund_Verbrannt1"]);
  state.choiceOpen = true;
  choiceBackdrop.style.display = "flex";
}
function closeChoiceModal(){
  if (!choiceBackdrop) return;
  state.choiceOpen = false;
  choiceBackdrop.style.display = "none";
}

function openRainIntroModal(){
  if (!rainIntroBackdrop) return;
  // Erstes Wetterziel vorladen, damit Regen + Hintergrundwechsel synchron sichtbar sind.
  preloadBackgrounds(["Hintergrund_Ueberschwemmung"]);
  state.rainIntroOpen = true;
  rainIntroBackdrop.style.display = "flex";
}
function closeRainIntroModal(){
  if (!rainIntroBackdrop) return;
  state.rainIntroOpen = false;
  rainIntroBackdrop.style.display = "none";
}
if (rainIntroStartBtn) rainIntroStartBtn.addEventListener("click", async ()=>{
  closeRainIntroModal();
  // Falls das Preloading auf dem Tablet noch nicht fertig ist, hier kurz absichern.
  await preloadBackgrounds(["Hintergrund_Ueberschwemmung"]);
  startEffect("rain");
});

function queueTimelineAction(fn){ state.timelinePending = fn; }
function runTimelinePending(){
  if (!state.timelinePending) return;
  if (state.morphActive) return; // keine Stage-Aktion während Morph
  const fn = state.timelinePending;
  state.timelinePending = null;
  try { fn(); } catch(e) { console.warn(e); }
}

function endSimulation(message){
  state.running = false;
  setStatus("Simulation beendet");
  const hint = document.getElementById("kHint");
  if (hint) hint.textContent = message || "Simulation beendet. Bitte Reset, um neu zu starten.";
  if (btnExportEnd) btnExportEnd.style.display = "block";
    if (btnDisplayEnd) btnDisplayEnd.style.display = "block";
  openEndRunModal();
}

// --- Hintergrund-Tracking: Echsentypen über Zyklen (unsichtbare Liniendiagramme) ---
function countLizardsByType(habitat){
  const counts = {};
  for (const m of LIZARD_GIFS) counts[m] = 0;
  for (const a of state.agents){
    if (!a || !a.alive) continue;
    if (a.kind !== "lizard") continue; // keine ambient crossers
    if ((a.habitat || "red") !== habitat) continue;
    const m = a.morph || "Echse_Base";
    if (counts[m] == null) counts[m] = 0;
    counts[m] += 1;
  }
  return counts;
}

function initTypeTracking(){
  state.typeHistoryRed = [];
  state.typeHistoryPurple = [];
  recordTypeHistory(true);
}

function recordTypeHistory(force=false){
  const c = (state.cycleCount ?? 0) | 0;

  // keine Duplikate pro Zyklus
  if (!force){
    const last = state.typeHistoryRed.length ? state.typeHistoryRed[state.typeHistoryRed.length-1].cycle : null;
    if (last === c) return;
  }

  state.typeHistoryRed.push({ cycle: c, counts: countLizardsByType("red") });
  state.typeHistoryPurple.push({ cycle: c, counts: countLizardsByType("purple") });

  drawHiddenTypeCharts();
}

function niceCeil(v){
  const x = Math.max(0, v || 0);
  if (x <= 10) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(x)));
  const n = x / pow;
  let m = 10;
  if (n <= 1) m = 1;
  else if (n <= 2) m = 2;
  else if (n <= 5) m = 5;
  else m = 10;
  return m * pow;
}

function drawTypeHistoryChart(canvas, series, title){
  if (!canvas) return;
  const cssW = 1400, cssH = 520;
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  if (canvas.width !== Math.floor(cssW*dpr) || canvas.height !== Math.floor(cssH*dpr)){
    canvas.width = Math.floor(cssW*dpr);
    canvas.height = Math.floor(cssH*dpr);
  }
  const cctx = canvas.getContext("2d");
  cctx.setTransform(dpr,0,0,dpr,0,0);

  // Background
  cctx.clearRect(0,0,cssW,cssH);
  cctx.fillStyle = "#ffffff";
  cctx.fillRect(0,0,cssW,cssH);

  // Title
  cctx.fillStyle = "#111827";
  cctx.font = "800 18px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  cctx.fillText(title, 18, 28);

  const padL = 70, padR = 26, padT = 54, padB = 54;
  const x0 = padL, y0 = padT;
  const w = cssW - padL - padR;
  const h = cssH - padT - padB;

  // Frame
  cctx.fillStyle = "#ffffff";
  cctx.fillRect(x0, y0, w, h);
  cctx.strokeStyle = "rgba(100,116,139,.38)";
  cctx.lineWidth = 1;
  cctx.strokeRect(x0 + 0.5, y0 + 0.5, w - 1, h - 1);

  const N = series ? series.length : 0;

  // Determine which types are present at least once (reduziert visuelles Rauschen)
  const used = [];
  for (const m of LIZARD_GIFS){
    let any = false;
    for (const s of series){
      if ((s?.counts?.[m] || 0) > 0){ any = true; break; }
    }
    if (any) used.push(m);
  }

  const legendBox = 10;
  const legendColW = 160;
  const legendPerCol = 4;
  const legendRowH = 18;
  const legendTopPad = 12;
  const legendBottomPad = 12;
  const legendRows = Math.max(1, Math.min(legendPerCol, used.length || 1));
  const legendBandH = legendTopPad + legendRows * legendRowH + legendBottomPad;
  const plotY0 = y0 + legendBandH;
  const plotH = Math.max(120, h - legendBandH - 8);

  let maxY = 0;
  if (N){
    for (const s of series){
      const cc = s && s.counts ? s.counts : {};
      for (const m of LIZARD_GIFS) maxY = Math.max(maxY, cc[m] || 0);
    }
  }
  const yMax = niceCeil(Math.max(5, maxY));

  // Grid + y labels
  const yTicks = 5;
  cctx.font = "12px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  for (let i=0;i<=yTicks;i++){
    const t = i / yTicks;
    const yy = plotY0 + plotH - t*plotH;
    cctx.strokeStyle = "rgba(148,163,184,.24)";
    cctx.beginPath();
    cctx.moveTo(x0, yy);
    cctx.lineTo(x0 + w, yy);
    cctx.stroke();

    const val = Math.round(t * yMax);
    cctx.fillStyle = "#000000";
    cctx.fillText(String(val), 16, yy + 4);
  }

  // Vertical cycle grid
  if (N >= 2){
    for (let i=0;i<N;i++){
      const xx = x0 + (i/(N-1))*w;
      cctx.strokeStyle = "rgba(148,163,184,.18)";
      cctx.beginPath();
      cctx.moveTo(xx, plotY0);
      cctx.lineTo(xx, plotY0 + plotH);
      cctx.stroke();
    }
  }

  // Axis labels
    cctx.fillStyle = "#000000";
  cctx.fillText("Zyklus", x0 + w - 44, plotY0 + plotH + 36);

  // Lines
  const xAt = (i)=>{
    if (N <= 1) return x0 + w*0.5;
    return x0 + (i/(N-1))*w;
  };
  const yAt = (val)=>{
    const t = clamp(val / yMax, 0, 1);
    return plotY0 + plotH - t*plotH;
  };

  for (const m of used){
    cctx.strokeStyle = LIZARD_COLOR[m] || "#ffffff";
    cctx.lineWidth = 2;
    cctx.beginPath();
    for (let i=0;i<N;i++){
      const v = series[i]?.counts?.[m] || 0;
      const xx = xAt(i);
      const yy = yAt(v);
      if (i === 0) cctx.moveTo(xx, yy); else cctx.lineTo(xx, yy);
    }
    cctx.stroke();

    // markers
    cctx.fillStyle = LIZARD_COLOR[m] || "#ffffff";
    for (let i=0;i<N;i++){
      const v = series[i]?.counts?.[m] || 0;
      const xx = xAt(i);
      const yy = yAt(v);
      cctx.beginPath();
      cctx.arc(xx, yy, 2.5, 0, Math.PI*2);
      cctx.fill();
    }
  }

  // X tick labels (Zyklusnummern)
  if (N){
    const step = (N <= 14) ? 1 : Math.ceil(N/14);
    for (let i=0;i<N;i+=step){
      const cyc = series[i]?.cycle ?? i;
      const xx = xAt(i);
      cctx.fillStyle = "#000000";
      cctx.fillText(String(cyc), xx - 5, plotY0 + plotH + 20);
    }
  }

  // Legend (innerhalb des Diagrammrahmens mit Abstand zur Überschrift)
  const legX = x0 + 10;
  const legY = y0 + legendTopPad;
  used.slice(0, 8).forEach((m, idx)=>{
    const col = Math.floor(idx / legendPerCol);
    const row = idx % legendPerCol;
    const lx = legX + col * legendColW;
    const ly = legY + row * legendRowH;
    cctx.fillStyle = LIZARD_COLOR[m] || "#fff";
    cctx.fillRect(lx, ly, legendBox, legendBox);
    cctx.fillStyle = "#111827";
    cctx.fillText(LIZARD_LABEL[m] || m, lx + legendBox + 8, ly + 10);
  });
}

function drawHiddenTypeCharts(){
  // Nur rendern, wenn Daten vorhanden sind (und Canvas existiert)
  if (state.typeHistoryRed && state.typeHistoryRed.length){
    drawTypeHistoryChart(chartHiddenTypesRed, state.typeHistoryRed, "Habitat (links): Echsentypen über Zyklen");
  }
  if (state.typeHistoryPurple && state.typeHistoryPurple.length){
    drawTypeHistoryChart(chartHiddenTypesPurple, state.typeHistoryPurple, "Habitat (rechts): Echsentypen über Zyklen");
  }
}

// --- Export am Spielende: Populationsdiagramm + beide Tracking-Diagramme -> Zwischenablage ---
function openExportModal(dataUrl){
  if (!exportBackdrop || !exportPreview) return;
  exportPreview.src = dataUrl;
  exportBackdrop.style.display = "flex";
  if (exportDownloadBtn){
    exportDownloadBtn.dataset.downloadUrl = dataUrl;
  }
}
function closeExportModal(){
  if (!exportBackdrop) return;
  exportBackdrop.style.display = "none";
}
if (exportCloseBtn) exportCloseBtn.addEventListener("click", closeExportModal);
if (exportDownloadBtn) {
  exportDownloadBtn.addEventListener("click", () => {
    const dataUrl = exportDownloadBtn.dataset.downloadUrl;
    if (!dataUrl) return;
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = "diagramme.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  });
}

async function copyPngToClipboard(blob){
  if (!blob) throw new Error("Kein Bild-Blob erzeugt.");
  if (!navigator.clipboard || !window.ClipboardItem) throw new Error("Clipboard API nicht verfügbar.");
  const item = new ClipboardItem({ "image/png": blob });
  await navigator.clipboard.write([item]);
}

function getDistanceExportRows(){
  const rows = [
    ["Links tagsüber", document.getElementById("kDistRedDay")?.textContent || "-"],
    ["Links nachts", document.getElementById("kDistRedNight")?.textContent || "-"],
    ["Rechts tagsüber", document.getElementById("kDistPurpleDay")?.textContent || "-"],
    ["Rechts nachts", document.getElementById("kDistPurpleNight")?.textContent || "-"]
  ];
  return rows.map(([k,v])=>[String(k||""), String(v||"-").trim() || "-"]);
}

async function createEndChartsExportImage(){
  // sicherstellen, dass die versteckten Charts aktuell sind
  drawHiddenTypeCharts();

  const pop = chartHiddenPopulation || document.getElementById("chartLine");
  if (!pop || !chartHiddenTypesRed || !chartHiddenTypesPurple){
    setStatus("Export nicht möglich");
    const hint = document.getElementById("kHint");
    if (hint) hint.textContent = "Export fehlgeschlagen: Diagramm-Canvas fehlt.";
    return;
  }

  // Populationsdiagramm zuerst mit Spawn-Icons rendern; bei file:// / Canvas-Security robust auf Fallback ohne Bild-Icons wechseln
  let popExportUsesIcons = true;
  drawPopulationChartFullForExport({ useSpawnImageIcons:true });
  try {
    // reine Taint-Prüfung (wirft SecurityError, wenn Bild-Icons das Canvas export-untauglich machen)
    pop.toDataURL("image/png");
  } catch (_e){
    popExportUsesIcons = false;
    drawPopulationChartFullForExport({ useSpawnImageIcons:false });
  }

  let bmp1, bmp2, bmp3;
  try {
    bmp1 = await createImageBitmap(pop);
    bmp2 = await createImageBitmap(chartHiddenTypesRed);
    bmp3 = await createImageBitmap(chartHiddenTypesPurple);
  } catch (e){
    // letzter Fallback: Populationsdiagramm sicher ohne Bild-Icons neu rendern und erneut versuchen
    if (popExportUsesIcons){
      try {
        popExportUsesIcons = false;
        drawPopulationChartFullForExport({ useSpawnImageIcons:false });
        bmp1 = await createImageBitmap(pop);
        bmp2 = await createImageBitmap(chartHiddenTypesRed);
        bmp3 = await createImageBitmap(chartHiddenTypesPurple);
      } catch (_e2){
        setStatus("Exportfehler");
        const hint = document.getElementById("kHint");
        if (hint) hint.textContent = "Export fehlgeschlagen (Canvas-Bild konnte nicht erzeugt werden).";
        return;
      }
    } else {
      setStatus("Exportfehler");
      const hint = document.getElementById("kHint");
      if (hint) hint.textContent = "Export fehlgeschlagen (Canvas-Bild konnte nicht erzeugt werden).";
      return;
    }
  }

  // Output (ein Bild: Arbeitsauftrag + Diagramme + Distanzangaben)
  const outCssW = 1600;
  const pad = 42;
  const titleH = 34;
  const gap = 26;
  const chartW = outCssW - pad*2;
  const taskText = "Arbeitsauftrag: Beobachte die Entwicklung der Echsenpopulation im Verlauf der Simulation. Achte darauf, wie sich Jäger, Tageszeiten und Wetterereignisse auf die beiden Habitate und auf die Zusammensetzung der Population auswirken. Exportiere hierzu am Ende das Ergebnis der Simulation und Werte die Diagramme aus.";
  const taskPadX = 18;
  const taskPadY = 18;
  const taskLineH = 24;
  const distRows = getDistanceExportRows();
  const distTitleH = 34;
  const distRowH = 36;
  const distPad = 16;
  const distBlockH = distTitleH + distPad + distRows.length * distRowH + 12;

  function scaledH(bmp){
    const s = chartW / bmp.width;
    return Math.max(1, Math.round(bmp.height * s));
  }
  function wrapCanvasText(ctx, text, maxWidth){
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let current = "";
    for (const word of words){
      const candidate = current ? current + " " + word : word;
      if (current && ctx.measureText(candidate).width > maxWidth){
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
    return lines.length ? lines : [String(text || "")];
  }

  const h1 = scaledH(bmp1);
  const h2 = scaledH(bmp2);
  const h3 = scaledH(bmp3);

  const measureCanvas = document.createElement("canvas");
  const measureCtx = measureCanvas.getContext("2d");
  measureCtx.font = "600 15px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  const taskLines = wrapCanvasText(measureCtx, taskText, chartW - taskPadX*2);
  const taskBlockH = taskPadY*2 + taskLines.length * taskLineH;

  const outCssH = pad + taskBlockH + gap + (titleH + h1) + gap + (titleH + h2) + gap + (titleH + h3) + gap + distBlockH + pad;

  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const out = document.createElement("canvas");
  out.width = Math.floor(outCssW*dpr);
  out.height = Math.floor(outCssH*dpr);
  const octx = out.getContext("2d");
  octx.setTransform(dpr,0,0,dpr,0,0);

  // Background
  octx.fillStyle = "#ffffff";
  octx.fillRect(0,0,outCssW,outCssH);

  octx.fillStyle = "#111827";
  octx.font = "800 18px system-ui,-apple-system,Segoe UI,Roboto,Arial";

  let y = pad;

  const drawTaskBlock = ()=>{
    const cardX = pad;
    const cardY = y;
    const cardW = chartW;
    const cardH = taskBlockH;
    octx.fillStyle = "#f8fafc";
    octx.strokeStyle = "rgba(100,116,139,.35)";
    octx.lineWidth = 1;
    if (octx.roundRect){
      octx.beginPath();
      octx.roundRect(cardX, cardY, cardW, cardH, 14);
      octx.fill();
      octx.stroke();
    } else {
      octx.fillRect(cardX, cardY, cardW, cardH);
      octx.strokeRect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1);
    }

    octx.fillStyle = "#111827";
    octx.font = "600 15px system-ui,-apple-system,Segoe UI,Roboto,Arial";
    taskLines.forEach((line, idx)=>{
      octx.fillText(line, cardX + taskPadX, cardY + taskPadY + idx * taskLineH + 14);
    });
    y += cardH;
  };

  const drawBlock = (title, bmp, h)=>{
    octx.fillText(title, pad, y);
    y += titleH;
    // frame
    octx.strokeStyle = "rgba(100,116,139,.35)";
    octx.lineWidth = 1;
    octx.strokeRect(pad + 0.5, y + 0.5, chartW - 1, h - 1);
    octx.drawImage(bmp, pad, y, chartW, h);
    y += h;
  };

  drawTaskBlock(); y += gap;

  drawBlock("Population (gesamter zeitlicher Verlauf; Habitat links = rot; Habitat rechts = lila)", bmp1, h1); y += gap;
  drawBlock("Habitat (links): Echsentypen über Zyklen", bmp2, h2); y += gap;
  drawBlock("Habitat (rechts): Echsentypen über Zyklen", bmp3, h3); y += gap;

  // Distanzangaben (aus der linken Infobox)
  octx.fillStyle = "#111827";
  octx.font = "800 18px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  octx.fillText("Zurückgelegte Distanz (Echsen)", pad, y);
  y += distTitleH;

  const cardX = pad;
  const cardY = y;
  const cardW = chartW;
  const cardH = distBlockH - distTitleH;
  octx.fillStyle = "#f8fafc";
  octx.strokeStyle = "rgba(100,116,139,.35)";
  octx.lineWidth = 1;
  if (octx.roundRect){
    octx.beginPath();
    octx.roundRect(cardX, cardY, cardW, cardH, 14);
    octx.fill();
    octx.stroke();
  } else {
    octx.fillRect(cardX, cardY, cardW, cardH);
    octx.strokeRect(cardX + 0.5, cardY + 0.5, cardW - 1, cardH - 1);
  }

  const innerX = cardX + distPad;
  const innerY = cardY + distPad;
  const innerW = cardW - distPad*2;
  const colGap = 22;
  const leftColW = Math.max(220, Math.floor(innerW * 0.62));
  const rightColX = innerX + leftColW + colGap;

  distRows.forEach((row, i)=>{
    const ry = innerY + i * distRowH;
    if (i > 0){
      octx.strokeStyle = "rgba(148,163,184,.32)";
      octx.beginPath();
      octx.moveTo(innerX, ry - 8);
      octx.lineTo(cardX + cardW - distPad, ry - 8);
      octx.stroke();
    }
  octx.fillStyle = "#000000";
    octx.font = "13px system-ui,-apple-system,Segoe UI,Roboto,Arial";
    octx.fillText(row[0], innerX, ry + 14);
    octx.fillStyle = "#111827";
    octx.font = "700 13px system-ui,-apple-system,Segoe UI,Roboto,Arial";
    const v = row[1];
    const maxW = cardX + cardW - distPad - rightColX;
    // Rechtsbündig zeichnen (mit Fallback bei sehr langem Text)
    let valText = v;
    let tw = octx.measureText(valText).width;
    while (tw > maxW && valText.length > 4){
      valText = valText.slice(0, -2).trimEnd() + "…";
      tw = octx.measureText(valText).width;
    }
    octx.fillText(valText, cardX + cardW - distPad - tw, ry + 14);
  });

  y += cardH;

  // Footer (optional)
  octx.fillStyle = "#000000";
  octx.font = "12px system-ui,-apple-system,Segoe UI,Roboto,Arial";
  const branch = state.timelineBranch ? ` · Branch: ${state.timelineBranch}` : "";
  octx.fillText(`Zyklen: ${state.cycleCount ?? 0}${branch}`, pad, outCssH - 16);

  const blob = await new Promise(res=>out.toBlob(res, "image/png", 0.95));
  const dataUrl = out.toDataURL("image/png");
  return { blob, dataUrl, popExportUsesIcons };
}

function showInlineExportResult(dataUrl, popExportUsesIcons){
  if (!dataUrl) return;
  if (!inlineExportResult || !inlineExportPreview){
    openExportModal(dataUrl);
    return;
  }
  inlineExportPreview.src = dataUrl;
  inlineExportResult.hidden = false;
  inlineExportResult.style.display = "block";
  document.documentElement.classList.add("inline-export-open");
  document.body.classList.add("inline-export-open");
  setStatus("Angezeigt");
  const hint = document.getElementById("kHint");
  if (hint) hint.textContent = popExportUsesIcons ? "Exportergebnis wird unterhalb der Simulation angezeigt." : "Exportergebnis wird unterhalb der Simulation angezeigt (Fallback ohne Spawn-Icons im Populationsdiagramm).";
  requestAnimationFrame(()=>{
    inlineExportResult.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function hideInlineExportResult(){
  if (!inlineExportResult) return;
  inlineExportResult.hidden = true;
  inlineExportResult.style.display = "none";
  if (inlineExportPreview) inlineExportPreview.removeAttribute("src");
  document.documentElement.classList.remove("inline-export-open");
  document.body.classList.remove("inline-export-open");
}
if (inlineExportCloseBtn) inlineExportCloseBtn.addEventListener("click", hideInlineExportResult);

async function exportEndChartsToClipboard(){
  const result = await createEndChartsExportImage();
  if (!result) return;
  const { blob, dataUrl, popExportUsesIcons } = result;
  try {
    await copyPngToClipboard(blob);
    setStatus("Exportiert");
    const hint = document.getElementById("kHint");
    if (hint) hint.textContent = popExportUsesIcons ? "Diagramme wurden als Bild in die Zwischenablage kopiert." : "Diagramme wurden als Bild in die Zwischenablage kopiert (Export-Fallback ohne Spawn-Icons im Populationsdiagramm).";
  } catch (e){
    // Fallback (typisch bei file://): Vorschau anzeigen, damit man manuell kopieren/herunterladen kann
    setStatus("Export (Fallback)");
    const hint = document.getElementById("kHint");
    if (hint) hint.textContent = popExportUsesIcons ? "Kopieren in die Zwischenablage wurde vom Browser blockiert. Vorschau geöffnet (manuell kopieren oder PNG herunterladen)." : "Kopieren in die Zwischenablage wurde vom Browser blockiert. Vorschau geöffnet (manuell kopieren oder PNG herunterladen). Hinweis: Export-Fallback ohne Spawn-Icons im Populationsdiagramm wurde verwendet.";
    openExportModal(dataUrl);
  }
}

async function showEndChartsInline(){
  const result = await createEndChartsExportImage();
  if (!result) return;
  showInlineExportResult(result.dataUrl, result.popExportUsesIcons);
}

function chooseBranch(branch){
  if (choiceStormBtn) choiceStormBtn.disabled = true;
  if (choiceFireBtn)  choiceFireBtn.disabled = true;
  closeChoiceModal();

  state.timelineBranch = branch;
  state.timelineChoiceCycle = state.cycleCount;
  state.timelineStage = 4;

  if (branch === "fire"){
    queueTimelineAction(async ()=>{
      // Auf Tablets/file:// kann das Zielbild sonst erst zu spät laden -> GIF läuft ohne sichtbaren Morph.
      await preloadBackgrounds(["Hintergrund_Verbrannt1"]);
      startEffect("fire"); // Morph -> Verbrannt1 (5s)
    });
  } else {
    queueTimelineAction(async ()=>{
      // Zielbild vorab sicher laden, damit Gewitter + Morph wirklich gleichzeitig starten.
      await preloadBackgrounds(["Hintergrund_Geroell2"]);
      startStormEffect();                      // Regen+Blitze (5s)
      beginMorph("Hintergrund_Geroell2", 5); // Morph synchron zum Effekt
    });
  }
}
if (choiceStormBtn) choiceStormBtn.addEventListener("click", ()=>chooseBranch("storm"));
if (choiceFireBtn)  choiceFireBtn.addEventListener("click", ()=>chooseBranch("fire"));

function getCycleLen(){ return state.phaseLen * 2; } // Tag+Nacht

function timelineOnCycle(){
  if (!state.timelineEnabled) return;

  // A) Nach 1 Zyklus: Regen + Morph -> Überschwemmung
  if (state.timelineStage === 0 && state.cycleCount >= 1){
    state.timelineStage = 1;
    queueTimelineAction(()=>openRainIntroModal());
    return;
  }

  // B) Nach 1 weiterem Zyklus: Morph -> Normal
  if (state.timelineStage === 1 && state.cycleCount >= 2){
    state.timelineStage = 2;
    queueTimelineAction(()=>beginMorph("Hintergrund_Normal", 5));
    return;
  }

  // C) Nach 1 weiterem Zyklus: Entscheidung (Popup)
  if (state.timelineStage === 2 && state.cycleCount >= 3){
    state.timelineStage = 3;
    queueTimelineAction(()=>{
      if (choiceStormBtn) choiceStormBtn.disabled = false;
      if (choiceFireBtn)  choiceFireBtn.disabled = false;
      openChoiceModal();
    });
    return;
  }

  // D/E) Branch: nach 3 Zyklen nächster Hintergrund, nach 2 weiteren Ende
  if (state.timelineStage === 4){
    const baseC = state.timelineChoiceCycle || 0;

    if (state.timelineBranch === "fire" && state.cycleCount >= baseC + 3){
      state.timelineStage = 5;
      queueTimelineAction(()=>beginMorph("Hintergrund_Verbrannt2", 5));
      return;
    }

    if (state.timelineBranch === "storm" && state.cycleCount >= baseC + 3){
      state.timelineStage = 5;
      queueTimelineAction(()=>beginMorph("Hintergrund_Geroell3", 5));
      return;
    }
  }

  if (state.timelineStage === 5){
    const baseC = state.timelineChoiceCycle || 0;
    if (state.cycleCount >= baseC + 5){
      state.timelineStage = 6;
      queueTimelineAction(()=>{
        const msg = (state.timelineBranch === "fire")
          ? "Ende: Nach dem Waldbrand bleibt die Umgebung dauerhaft verbrannt. (Reset, um neu zu starten.)"
          : "Ende: Nach dem Gewitter bleibt die Umgebung in Geroell3. (Reset, um neu zu starten.)";
        endSimulation(msg);
      });
    }
  }
}



  function updateViewScale(){
    const r = simWrap.getBoundingClientRect();
    state.viewRect = r;
    if (state.zone){
      state.scaleX = r.width / state.zone.w;
      state.scaleY = r.height / state.zone.h;
    }
    return r;
  }

  function resize(){
    applyDeviceProfile();
    const r = updateViewScale();
    simCanvas.width = Math.max(2, Math.floor(r.width*devicePixelRatio));
    simCanvas.height = Math.max(2, Math.floor(r.height*devicePixelRatio));
    resizeCharts();
    state.bgDirty = true;
    // Canvas wurde neu skaliert -> Hintergrund einmal neu zeichnen
    if (state.bgImg) drawBackground();
    state.bgDirty = false;
    updateFirePatchPosition();
  }
  window.addEventListener("resize", resize);

  function worldToScreenScaled(x,y,scaleX,scaleY){
    return { sx: x * scaleX, sy: y * scaleY };
  }

  function setStatus(msg){ const el = document.getElementById("kStatus"); if (el) el.textContent = msg; }

  // --- Utilities ---
  function shuffleInPlace(arr){
    for (let i=arr.length-1;i>0;i--){
      const j = (Math.random()*(i+1))|0;
      const t = arr[i]; arr[i]=arr[j]; arr[j]=t;
    }
    return arr;
  }

  function killAgent(a){
    a.alive = false;
    if (a.el && a.el.parentNode) a.el.parentNode.removeChild(a.el);
  }

  function preyAcceptProb(predType, morph){
    const map = PRED_PREY_PROB[predType] || null;
    if (map && Object.prototype.hasOwnProperty.call(map, morph)) return map[morph];
    return 0.15;
  }
// --- Beute-Prioritäten (deterministisch; Ansteuern = Töten) ---
// Rang: 0 = höchste Priorität (wird zuerst gejagt)
const PREY_PRIORITY_RED_ORDER = ["Echse_Dunkel","Echse_Grau","Echse_Hellgrau","Echse_Hellbraun","Echse_Sandfarben","Echse_Base","Echse_Gruen2","Echse_Gruen1"];
const PREY_PRIORITY_PURPLE_NORMAL_ORDER = ["Echse_Dunkel","Echse_Grau","Echse_Hellgrau","Echse_Hellbraun","Echse_Sandfarben","Echse_Base","Echse_Gruen2","Echse_Gruen1"];
const PREY_PRIORITY_PURPLE_BURN_ORDER = ["Echse_Gruen2","Echse_Hellgrau","Echse_Gruen1","Echse_Sandfarben","Echse_Base","Echse_Hellbraun","Echse_Grau","Echse_Dunkel"];
const PREY_PRIORITY_PURPLE_GEROELL_ORDER = ["Echse_Gruen2","Echse_Dunkel","Echse_Gruen1","Echse_Base","Echse_Grau","Echse_Hellbraun","Echse_Sandfarben","Echse_Hellgrau"];

function makeRankMap(order){
  const m = Object.create(null);
  for (let i=0;i<order.length;i++) m[order[i]] = i;
  return m;
}
const PREY_RANK_RED = makeRankMap(PREY_PRIORITY_RED_ORDER);
const PREY_RANK_PURPLE_NORMAL = makeRankMap(PREY_PRIORITY_PURPLE_NORMAL_ORDER);
const PREY_RANK_PURPLE_BURN = makeRankMap(PREY_PRIORITY_PURPLE_BURN_ORDER);
const PREY_RANK_PURPLE_GEROELL = makeRankMap(PREY_PRIORITY_PURPLE_GEROELL_ORDER);

function preyRankMapFor(habitat, mapName){
  if (habitat === "red") return PREY_RANK_RED;

  // lila Zone: je nach aktivem Hintergrundbild unterschiedliche Rangfolgen
  if (mapName === "Hintergrund_Verbrannt1" || mapName === "Hintergrund_Verbrannt2") return PREY_RANK_PURPLE_BURN;
  if (mapName === "Hintergrund_Geroell1" || mapName === "Hintergrund_Geroell2" || mapName === "Hintergrund_Geroell3") return PREY_RANK_PURPLE_GEROELL;

  // Standard: Hintergrund_Normal und Hintergrund_Ueberschwemmung (und ggf. weitere) -> wie Rot
  return PREY_RANK_PURPLE_NORMAL;
}

function preyPriorityRank(habitat, morph, mapName){
  const rankMap = preyRankMapFor(habitat, mapName);
  const r = rankMap[morph];
  return (typeof r === "number") ? r : 9999;
}


  // --- Rain transition: Trocken -> Ueberschwemmung ---
  function beginFloodTransition(durSec){
    const delay = MIGRATION_DELAY_MIN + Math.random()*(MIGRATION_DELAY_MAX - MIGRATION_DELAY_MIN);
    state.transition = {
      kind: "rain",
      fromMap: state.mapName,
      toMap: "Hintergrund_Ueberschwemmung",
      startT: state.t,
      dur: durSec,
      migrateAt: state.t + delay,
      migrated: false,
      endT: state.t + durSec
    };
    // Während der ersten 1–2s bleibt die Logik-Zone unverändert (optisch realistischer).
    // Danach schalten wir auf die Ueberschwemmung-Logik um und starten die Migration.
    state.logicZone = null;

    // Trocken-Querläufer beim Übergang ausblenden (Despawn am Morph-Ende)
    beginAmbientFadeOut(durSec);
  }

  function startFloodMigration(){
    // Schalte Restriktionen bereits während des Übergangs auf die Ueberschwemmung um.
    const z = getZone("Hintergrund_Ueberschwemmung");
    if (!z) return;
    state.logicZone = z;

    const lizards = state.agents.filter(a=>a.alive && a.kind==="lizard");
    if (!lizards.length) return;

    // Keine 50/50-Aufteilung mehr: Echsen behalten ihr Habitat und laufen (beschleunigt) in die passenden neuen Zonen.
    const tr = state.transition;
    const deadline = tr ? (tr.startT + tr.dur - 0.05) : (state.t + 3.0);

    for (let i=0;i<lizards.length;i++){
      const l = lizards[i];
      const dest = (l.habitat==="purple") ? "purple" : "red"; // normalisieren
      l.habitat = dest;
      l.migrating = true;
      l.migrateUntil = deadline;
      if (!Number.isFinite(l.baseSpeed)) l.baseSpeed = l.speed;
      l.speed = l.baseSpeed * MIGRATION_SPEED_MULT;
      l.target = pickNearestTarget(dest, l.x, l.y) || pickTarget(dest);
    }

    // Jäger: in Nicht-Trocken Karten feste Reviere (Fuchs=Rot, Wiesel=Lila). Während Übergang bereits anwenden.
    for (const p of state.agents){
      if (!p.alive || p.kind!=="pred") continue;
      p.habitat = (p.predatorType==="weasel") ? "purple" : "red";
      if (!allowed(p.habitat, p.x, p.y)){
        const sp = snapToHabitat(p.habitat, p.x, p.y);
        p.x = sp.x; p.y = sp.y;
      }
      p.targetId = null;
      p.target = null;
      p.wander = null;
    }
  }

  function updateTransition(dt){
    const tr = state.transition;
    if (!tr) return;
    if (tr.kind === "rain"){
      if (!tr.migrated && state.t >= tr.migrateAt){
        tr.migrated = true;
        startFloodMigration();
      }
    }
  }

  function finalizeFloodTransition(){
    const tr = state.transition;
    if (!tr || tr.kind !== "rain") { state.logicZone = null; state.transition = null; return; }

    // Keine Snaps am Ende: wer es nicht ins Habitat schafft, wird entfernt.
    const lizards = state.agents.filter(a=>a.alive && a.kind==="lizard");
    for (const l of lizards){
      // Tod nur, wenn die Echse am Ende des Regen-GIFs noch außerhalb ALLER Zonen ist
      if (!inAnyHabitat(l.x, l.y)){
        killAgent(l);
        continue;
      }
      if (l.migrating){
        l.migrating = false;
        if (Number.isFinite(l.baseSpeed)) l.speed = l.baseSpeed;

        l.migrateUntil = null;
        l.target = null;
      }
      // Echse in ihre Zone snappen falls sie knapp außerhalb gelandet ist
      if (!allowed(l.habitat, l.x, l.y)){
        const sp = snapToHabitat(l.habitat, l.x, l.y);
        l.x = sp.x; l.y = sp.y;
      }
      // Nach Migration/Übergang: normales Verhalten zurücksetzen
      l.behaviorState = "idle";
      l.stateTimer = 0.5 + Math.random() * 1.5;
      l.heading = Math.random() * Math.PI * 2;
      l.turnVel = 0;
    }

    state.logicZone = null;
    state.transition = null;

    // Sicherheitsnetz: alle Agenten nochmals in ihre Zonen zwingen
    enforceAgentsToZone(false);
  }

  const RHYTHM_LABELS = ["Morgen","Tag","Abend","Nacht"];

  // Echsen-Speed-Anpassung nach Hintergrund + Tag/Nacht (nur Verbrannt1/2 und Geröll1/2/3)
  const LIZARD_SPEED_DAYNIGHT_MAPS = new Set([
    "Hintergrund_Verbrannt1","Hintergrund_Verbrannt2",
    "Hintergrund_Geroell1","Hintergrund_Geroell2","Hintergrund_Geroell3"
  ]);

  function getLizardDayNightZoneMult(mapName, habitat, isDay){
    if (!LIZARD_SPEED_DAYNIGHT_MAPS.has(mapName)) return 1.0;
    if (habitat === "red")    return isDay ? 1.25 : 0.25;
    if (habitat === "purple") return isDay ? 0.25 : 1.25;
    return 1.0;
  }


  // Rhythmus-Visual (Bilder/Rythmus.png)
  function updateRhythmBar(){
    const wrap = document.getElementById("rhythmWrap");
    const bright = document.getElementById("rhythmBright");
    const ind = document.getElementById("rhythmIndicator");
    if (!wrap || !bright) return;

    const rect = wrap.getBoundingClientRect();
    const w = Math.max(1, rect.width);

    const cycLen = state.phaseLen * 2; // Tag+Nacht
    const p = (((state.t % cycLen) + cycLen) % cycLen) / cycLen; // 0..1

    const padX = 6;
    const padY = 0;
    const effW = Math.max(1, w - 2 * padX);

    // Normalbreite des "Fensters"
    let spotW = Math.min(260, Math.max(140, w * 0.22));
    spotW = Math.min(spotW, effW);

    // Position (0..effW). Am Anfang/Ende wächst/schrumpft die Breite,
    // statt dass das Rechteck an der Grenze "stehen bleibt".
    const cx = p * effW;
    const half = spotW * 0.5;

    let leftIn, widthIn;
    if (cx < half){
      // Start: Breite wächst (0 .. spotW), linke Kante bleibt am Anfang
      widthIn = Math.max(0, cx * 2);
      leftIn = 0;
    } else if (cx > effW - half){
      // Ende: Breite schrumpft (spotW .. 0), rechte Kante bleibt am Ende
      widthIn = Math.max(0, (effW - cx) * 2);
      leftIn = effW - widthIn;
    } else {
      widthIn = spotW;
      leftIn = cx - half;
    }

    // Sehr kleine Breite macht clip-path / Border manchmal unschön -> minimale Sichtbarkeit
    const minVis = Math.min(28, spotW);
    if (widthIn > 0 && widthIn < minVis){
      if (cx < half){
        widthIn = minVis;
        leftIn = 0;
      } else if (cx > effW - half){
        widthIn = minVis;
        leftIn = effW - minVis;
      }
    }

    const left = padX + leftIn;
    const width = Math.max(0, Math.min(effW, widthIn));
    const right = Math.max(0, w - (left + width));

    bright.style.clipPath = `inset(${padY}px ${right.toFixed(2)}px ${padY}px ${left.toFixed(2)}px round 12px)`;

    if (ind){
      ind.style.left = `${left.toFixed(2)}px`;
      ind.style.width = `${width.toFixed(2)}px`;
    }
  }

  // Robustheit: wenn Bilder/Rythmus.png nicht existiert, versuche lokale Datei Rythmus.png (für beide Layer)
(function(){
  const base = document.getElementById("rhythmImage");
  const bright = document.getElementById("rhythmBright");
  const wrap = document.getElementById("rhythmWrap");
  if (!base || !bright || !wrap) return;

  function applyFallback(){
    if (wrap.dataset.fallback) return;
    wrap.dataset.fallback = "1";
    base.src = "Rythmus.png";
    bright.src = "Rythmus.png";
  }

  base.addEventListener("error", applyFallback);
  bright.addEventListener("error", applyFallback);
})();

function updateTopBar(){
    const mm = Math.floor(state.t/60).toString().padStart(2,"0");
    const ss = Math.floor(state.t%60).toString().padStart(2,"0");
    const timeEl = document.getElementById("kTime");
    if (timeEl) timeEl.textContent = `${state.day ? "Tag" : "Nacht"} · ${mm}:${ss}`;
    const cycEl = document.getElementById("kCycles");
    if (cycEl) cycEl.textContent = String(state.cycleCount ?? 0);
  }

  function updateFireButton(){
    const btn = document.getElementById("btnFire");
    if (!btn) return;
    const enabled = !!(state.zone && state.zone.fireEnabled);
    btn.disabled = !enabled;
    btn.title = enabled ? "" : "Feuer ist auf dieser Karte deaktiviert.";
  }

  // Hintergrund-Cache (wichtig auf Tablets/file://, damit Morph-Zielbilder vorab geladen sind)
  const bgImageCache = new Map();      // mapName -> HTMLImageElement
  const bgImagePromiseCache = new Map(); // mapName -> Promise<HTMLImageElement>

  async function loadBackground(mapName){
    if (bgImageCache.has(mapName)) return bgImageCache.get(mapName);
    if (bgImagePromiseCache.has(mapName)) return bgImagePromiseCache.get(mapName);

    const exts = ["png","PNG","jpg","JPG","jpeg","JPEG","webp","WEBP"];
    const prom = new Promise((resolve,reject)=>{
      let i = 0;
      const img = new Image();
      // Browser darf früh decodieren; hilft bei ruckelfreien Morphs auf schwächeren Geräten.
      try { img.decoding = "async"; } catch(_) {}

      const tryNext = ()=>{
        if (i >= exts.length){
          bgImagePromiseCache.delete(mapName);
          reject(new Error("Konnte Bild nicht laden: Map/" + mapName + ".(png|jpg|jpeg|webp)"));
          return;
        }
        img.src = `Map/${mapName}.${exts[i++]}`;
      };

      img.onload = ()=>{
        bgImageCache.set(mapName, img);
        bgImagePromiseCache.delete(mapName);
        resolve(img);
      };
      img.onerror = ()=>tryNext();

      tryNext();
    });

    bgImagePromiseCache.set(mapName, prom);
    return prom;
  }

  function preloadBackgrounds(list){
    if (!Array.isArray(list) || !list.length) return Promise.resolve();
    return Promise.allSettled(list.map(name=>loadBackground(name)));
  }

  // Allgemeiner Asset-Preload (hilft auf Tablets/file:// gegen spätes Erstladen von Sprites)
  const assetPreloadCache = new Map(); // src -> Promise<HTMLImageElement>
  function preloadAsset(src){
    if (!src) return Promise.resolve(null);
    if (assetPreloadCache.has(src)) return assetPreloadCache.get(src);
    const p = new Promise((resolve,reject)=>{
      const img = new Image();
      try { img.decoding = "async"; } catch(_) {}
      try { img.loading = "eager"; } catch(_) {}
      try { img.fetchPriority = "high"; } catch(_) {}
      img.onload = async ()=>{
        try { if (typeof img.decode === "function") await img.decode(); } catch(_) {}
        resolve(img);
      };
      img.onerror = ()=>reject(new Error("Asset-Preload fehlgeschlagen: " + src));
      img.src = src;
    });
    // Fehler nicht global cachen (bei erneutem Versuch neu probieren dürfen)
    p.catch(()=>{ try{ if (assetPreloadCache.get(src) === p) assetPreloadCache.delete(src); }catch(_){} });
    assetPreloadCache.set(src, p);
    return p;
  }
  function preloadAssets(list){
    if (!Array.isArray(list) || !list.length) return Promise.resolve();
    return Promise.allSettled(list.map(preloadAsset));
  }
  function preloadPredatorAssets(){
    // Jäger-Sprites + Spawn-Icons früh laden (Tablet: verhindert spätes Nachladen beim ersten Spawn)
    preloadAssets([
      `GIFs/${PRED_GIFS.fox}.gif`,
      `GIFs/${PRED_GIFS.weasel}.gif`
    ]);
    // Chart-Spawnmarker ebenfalls vorwärmen
    try { getPredatorSpawnIconAsset("foxSpawn"); } catch(_) {}
    try { getPredatorSpawnIconAsset("weaselSpawn"); } catch(_) {}
  }

  // --- Start-Preloader mit Ladebalken (wichtige Maps/GIFs/Sprites vorpuffern) ---
  let startupPreloadDone = false;
  let startupPreloadInFlight = null;
  let startupPreloadUI = null;
  let startupPreloadLikelyWarm = false;
  const STARTUP_PRELOAD_WARM_KEY = "geogra_startup_preload_warm_v2026_02_22_1";

  function readStartupPreloadWarmFlag(){
    try { return localStorage.getItem(STARTUP_PRELOAD_WARM_KEY) === "1"; }
    catch(_) { return false; }
  }
  function writeStartupPreloadWarmFlag(){
    try { localStorage.setItem(STARTUP_PRELOAD_WARM_KEY, "1"); } catch(_) {}
  }
  startupPreloadLikelyWarm = readStartupPreloadWarmFlag();

  function ensureStartupPreloadUI(){
    if (startupPreloadUI) return startupPreloadUI;
    // Buchner-Standard: Preloader-CSS liegt in Artbildung.css; keine CSS-Injektion per JavaScript.

    const backdrop = document.createElement("div");
    backdrop.className = "startupPreloadBackdrop";
    backdrop.id = "startupPreloadBackdrop";
    backdrop.innerHTML = `
      <div class="startupPreloadCard" role="status" aria-live="polite" aria-atomic="true">
        <div class="startupPreloadTitle">Simulation wird vorbereitet…</div>
        <div class="startupPreloadText" id="startupPreloadText">Wichtige Karten, GIFs und Sprites werden vorgeladen.</div>
        <div class="startupPreloadBarWrap"><div class="startupPreloadBar" id="startupPreloadBar"></div></div>
        <div class="startupPreloadMeta" id="startupPreloadMeta">0%</div>
      </div>
    `;
    document.body.appendChild(backdrop);

    startupPreloadUI = {
      backdrop,
      bar: backdrop.querySelector("#startupPreloadBar"),
      text: backdrop.querySelector("#startupPreloadText"),
      meta: backdrop.querySelector("#startupPreloadMeta")
    };
    return startupPreloadUI;
  }

  function showStartupPreloadOverlay(){
    const ui = ensureStartupPreloadUI();
    ui.backdrop.style.display = "flex";
    return ui;
  }

  function hideStartupPreloadOverlay(){
    if (!startupPreloadUI) return;
    startupPreloadUI.backdrop.style.display = "none";
  }

  function updateStartupPreloadOverlay(done, total, label){
    const ui = ensureStartupPreloadUI();
    const pct = total > 0 ? Math.round((done / total) * 100) : 100;
    ui.bar.style.width = `${pct}%`;
    ui.meta.textContent = `${pct}% (${done}/${total})`;
    if (label) ui.text.textContent = label;
  }

  function waitForSpawnIconWarm(kind, timeoutMs=5000){
    return new Promise((resolve)=>{
      let asset = null;
      try { asset = getPredatorSpawnIconAsset(kind); } catch(_) {}
      if (!asset) return resolve();
      if (asset.ready || asset.failed) return resolve();
      const start = performance.now();
      const poll = ()=>{
        if (asset.ready || asset.failed) return resolve();
        if ((performance.now() - start) >= timeoutMs) return resolve();
        requestAnimationFrame(poll);
      };
      poll();
    });
  }

  function buildStartupPreloadTaskList(){
    const tasks = [];
    const addTask = (label, fn)=>tasks.push({ label, fn });

    const allMaps = [
      "Hintergrund_Trocken",
      "Hintergrund_Ueberschwemmung",
      "Hintergrund_Normal",
      "Hintergrund_Geroell1",
      "Hintergrund_Geroell2",
      "Hintergrund_Geroell3",
      "Hintergrund_Verbrannt1",
      "Hintergrund_Verbrannt2",
      ];

    for (const mapName of allMaps){
      addTask(`Karte laden: ${mapName.replace("Hintergrund_","")}`, ()=>loadBackground(mapName));
    }

    // Dekor-/Popupbilder
    for (const src of [
      "Bilder/Rand.png",
      "Bilder/Regen.png",
      "Bilder/Gewitter.png",
      "Bilder/Feuer.png"
    ]){
      addTask(`Bild puffern: ${src.split("/").pop()}`, ()=>preloadAsset(src));
    }

    // Effekt-GIFs (inkl. Blitz-Fallback-Kandidaten)
    for (const src of [
      "GIFs/Regen.gif",
      "GIFs/Feuer.gif",
      "GIFs/Gewitter.gif"
    ]){
      addTask(`Effekt puffern: ${src.split("/").pop()}`, ()=>preloadAsset(src));
    }

    // Echsen- und Jäger-Sprites
    for (const morph of LIZARD_GIFS){
      addTask(`Echsen-Sprite puffern: ${morph}`, ()=>preloadAsset(`GIFs/${morph}.gif`));
    }
    addTask(`Jäger-Sprite puffern: ${PRED_GIFS.fox}`, ()=>preloadAsset(`GIFs/${PRED_GIFS.fox}.gif`));
    addTask(`Jäger-Sprite puffern: ${PRED_GIFS.weasel}`, ()=>preloadAsset(`GIFs/${PRED_GIFS.weasel}.gif`));

    // Spawn-Icons (Diagramm)
    addTask("Spawn-Icon puffern: Fuchs", ()=>waitForSpawnIconWarm("foxSpawn"));
    addTask("Spawn-Icon puffern: Wiesel", ()=>waitForSpawnIconWarm("weaselSpawn"));

    return tasks;
  }

  async function runStartupPreloadWithProgress(opts={}){
    if (startupPreloadDone) return { done:true, cached:true };
    if (startupPreloadInFlight) return startupPreloadInFlight;

    const tasks = buildStartupPreloadTaskList();
    const total = tasks.length || 1;
    let done = 0;

    const allowWarmFastPath = opts && opts.allowWarmFastPath !== false;
    const likelyWarm = !!(allowWarmFastPath && startupPreloadLikelyWarm);
    let overlayShown = false;
    let overlayTimer = null;

    const showOverlayNow = (label)=>{
      if (overlayShown) return;
      overlayShown = true;
      showStartupPreloadOverlay();
      updateStartupPreloadOverlay(done, total, label || (likelyWarm ? "Assets bereits geladen – kurzer Check…" : "Vorbereitung startet…"));
    };

    if (likelyWarm){
      // Bei wahrscheinlichem Warm-Cache Overlay nur zeigen, wenn das Prüfen spürbar länger dauert.
      overlayTimer = setTimeout(()=>showOverlayNow("Assets bereits geladen – kurzer Check…"), 220);
    } else {
      showOverlayNow("Vorbereitung startet…");
    }

    // Progress aktualisieren (auch wenn Overlay noch nicht sichtbar ist, bleibt die UI konsistent).
    updateStartupPreloadOverlay(0, total, likelyWarm ? "Assets bereits geladen – kurzer Check…" : "Vorbereitung startet…");

    startupPreloadInFlight = (async ()=>{
      const concurrency = 6;
      let idx = 0;
      let active = 0;

      await new Promise((resolve)=>{
        const launch = ()=>{
          while (active < concurrency && idx < tasks.length){
            const task = tasks[idx++];
            active++;
            Promise.resolve()
              .then(()=>task.fn())
              .catch((err)=>{
                // Fehler tolerieren (z. B. alternative GIF-/Icon-Dateien nicht vorhanden)
                try { console.warn("Startup-Preload:", task.label, err && err.message ? err.message : err); } catch(_) {}
              })
              .finally(()=>{
                done++;
                updateStartupPreloadOverlay(done, total, task.label);
                active--;
                if (done >= total && active === 0 && idx >= tasks.length){
                  resolve();
                } else {
                  launch();
                }
              });
          }
          if (tasks.length === 0) resolve();
        };
        launch();
      });

      // Kurzer Yield, damit Browser dekodierte Assets im Cache stabilisiert.
      await new Promise(r=>setTimeout(r, 60));
      startupPreloadDone = true;
      startupPreloadLikelyWarm = true;
      writeStartupPreloadWarmFlag();
      return { done:true, cached:likelyWarm };

    })();

    try {
      return await startupPreloadInFlight;
    } finally {
      if (overlayTimer){
        try { clearTimeout(overlayTimer); } catch(_) {}
        overlayTimer = null;
      }
      startupPreloadInFlight = null;
      if (overlayShown) hideStartupPreloadOverlay();
    }
  }

  async function setMap(mapName, opts={}){
    state.mapName = mapName;
    state.zone = getZone(mapName);
    if (!state.zone) throw new Error("Keine Zone für "+mapName);
    state.bgImg = await loadBackground(mapName);
    // Fallback: CSS-Hintergrund setzen (falls Canvas aus irgendeinem Grund leer bleibt)
    simWrap.style.backgroundImage = `url("${state.bgImg.src}")`;
    updateViewScale();
    state.bgDirty = true;
    drawBackground();
    state.bgDirty = false;

    // Feuer-Maske (nur lila Zone)
    fireOverlay.style.display = "none"; // Legacy: nicht mehr als Fullscreen-Overlay verwenden
    firePatchLayer.style.webkitMaskImage = "none";
    firePatchLayer.style.maskImage = "none";
    if (state.zone.fireEnabled && state.zone.purplePolys && state.zone.purplePolys.length){
      const url = polyToSvgMask(state.zone.purplePolys, state.zone.w, state.zone.h);
      if (url){
        firePatchLayer.style.webkitMaskImage = `url("${url}")`;
        firePatchLayer.style.maskImage = `url("${url}")`;
        firePatchLayer.style.webkitMaskRepeat = "no-repeat";
        firePatchLayer.style.maskRepeat = "no-repeat";
        firePatchLayer.style.webkitMaskSize = "100% 100%";
        firePatchLayer.style.maskSize = "100% 100%";
        firePatchLayer.style.webkitMaskPosition = "center";
        firePatchLayer.style.maskPosition = "center";
      }
    }
    updateFireButton();
    updateTopBar();

    // Hintergrundwechsel: neue Spawn-/Bewegungszonen auf alle existierenden Agenten anwenden
    // (gilt für alle aktuell aktiven Objekte sowie künftige Spawns/Targets)
    if (!opts || opts.enforce !== false){
      enforceAgentsToZone(true);
    }
    updateSprites();
    updateFirePatchPosition();
    updateZoneTintMasks();
    applyZoneTimeTint(true);
  }



  // --- Zonen-Tint (Tag/Nacht) ---
  let _lastDayMix = null;

  function applySvgMask(el, url){
    if (!el) return;
    if (!url){
      el.style.webkitMaskImage = "none";
      el.style.maskImage = "none";
      return;
    }
    el.style.webkitMaskImage = `url("${url}")`;
    el.style.maskImage = `url("${url}")`;
    el.style.webkitMaskRepeat = "no-repeat";
    el.style.maskRepeat = "no-repeat";
    el.style.webkitMaskSize = "100% 100%";
    el.style.maskSize = "100% 100%";
    el.style.webkitMaskPosition = "center";
    el.style.maskPosition = "center";
  }

  function updateZoneTintMasks(){
    const z = state.zone;
    if (!z) return;

    // Rot
    if (zoneTintRed){
      if (z.fullHabitat){
        zoneTintRed.style.display = "block";
        applySvgMask(zoneTintRed, null);
      } else if (z.redPolys && z.redPolys.length){
        zoneTintRed.style.display = "block";
        applySvgMask(zoneTintRed, polyToSvgMask(z.redPolys, z.w, z.h));
      } else {
        zoneTintRed.style.display = "none";
      }
    }

    // Lila
    if (zoneTintPurple){
      if (z.fullHabitat || z.sharedHabitat){
        zoneTintPurple.style.display = "none";
      } else if (z.purplePolys && z.purplePolys.length){
        zoneTintPurple.style.display = "block";
        applySvgMask(zoneTintPurple, polyToSvgMask(z.purplePolys, z.w, z.h));
      } else {
        zoneTintPurple.style.display = "none";
      }
    }
  }

  function applyZoneTimeTint(force=false){
    // Flüssiger Verlauf: Morgen (Aufhellen), Tag (hell), Abend (Abdunkeln), Nacht (dunkel)
    const cycLen = getCycleLen();
    if (!cycLen) return;

    const tmod = (((state.t % cycLen) + cycLen) % cycLen);
    const p = tmod / cycLen; // 0..1

    const smooth = (x)=>{ x = Math.max(0, Math.min(1, x)); return x*x*(3-2*x); };

    let dayMix;
    if (p < 0.25){
      dayMix = smooth(p / 0.25);             // 0 -> 1
    } else if (p < 0.5){
      dayMix = 1;                             // Tag
    } else if (p < 0.75){
      dayMix = 1 - smooth((p - 0.5) / 0.25);  // 1 -> 0
    } else {
      dayMix = 0;                             // Nacht
    }

    if (!force && _lastDayMix != null && Math.abs(dayMix - _lastDayMix) < 0.003) return;
    _lastDayMix = dayMix;

    const lightMax = 0.12; // Tag: leicht heller
    const darkMax  = 0.28; // Nacht: deutlich dunkler

    const light = dayMix * lightMax;
    const dark  = (1 - dayMix) * darkMax;

    const apply = (el)=>{
      if (!el || el.style.display === "none") return;
      el.style.setProperty("--zlight", light.toFixed(3));
      el.style.setProperty("--zdark", dark.toFixed(3));
    };

    apply(zoneTintRed);
    apply(zoneTintPurple);
  }



  // Active zone: during transitions we may use a temporary logic zone (movement/spawn restrictions)
  function activeZone(){
    return state.logicZone || state.zone;
  }

  // --- Agents ---
  function allowed(habitat, x, y){
    const z = activeZone();
    const xx = clamp(x,0,z.w-1), yy=clamp(y,0,z.h-1);
    if (z.fullHabitat) return true;

    // Sample-Maske (schnell & robust)
    if (z._maskReady){
      const useRed = (habitat==="red") || (habitat==="purple" && z.sharedHabitat);
      const m = useRed ? z.redMask : (z.sharedHabitat ? z.redMask : z.purpleMask);
      if (m && m.data){
        const cx = clamp((xx / m.cell) | 0, 0, m.gw-1);
        const cy = clamp((yy / m.cell) | 0, 0, m.gh-1);
        if (m.data[cy*m.gw + cx]) return true;
        return false;
      }
    }

    // Fallback: Polygone
    if (habitat==="red") return inAnyPoly(xx,yy,z.redPolys);
    if (z.sharedHabitat) return inAnyPoly(xx,yy,z.redPolys);
    return inAnyPoly(xx,yy,z.purplePolys);
  }

  // In "Sicherheitszonen" (rot ODER lila) – genutzt für Tod/Überleben am Ende des Regen-GIFs.
  function inAnyHabitat(x, y){
    const z = activeZone();
    const xx = clamp(x,0,z.w-1), yy=clamp(y,0,z.h-1);
    if (z.fullHabitat) return true;

    // Sample-Maske (schnell & robust)
    if (z._maskReady){
      const rM = z.redMask;
      const pM = z.sharedHabitat ? z.redMask : z.purpleMask;
      const test = (m)=>{
        if (!m || !m.data) return false;
        const cx = clamp((xx / m.cell) | 0, 0, m.gw-1);
        const cy = clamp((yy / m.cell) | 0, 0, m.gh-1);
        return !!m.data[cy*m.gw + cx];
      };
      if (z.sharedHabitat) return test(rM);
      return test(rM) || test(pM);
    }

    // Fallback: Polygone
    if (z.sharedHabitat) return inAnyPoly(xx,yy,z.redPolys);
    return inAnyPoly(xx,yy,z.redPolys) || inAnyPoly(xx,yy,z.purplePolys);
  }

  
  function snapToHabitat(habitat, x, y){
    const z = activeZone();
    if (!z) return {x: (x||0), y: (y||0)};

    const W = z.w, H = z.h;
    const xx = Number.isFinite(x) ? x : (W*0.5);
    const yy = Number.isFinite(y) ? y : (H*0.5);

    if (z.fullHabitat){
      return {x: clamp(xx,0,W-1), y: clamp(yy,0,H-1)};
    }

    // Schneller: nutze vorkompilierte Samplepunkte (sind per Definition gültig)
    const useRed = (habitat==="red") || (habitat==="purple" && z.sharedHabitat);
    const samples = useRed ? z.redSamples : z.purpleSamples;

    if (samples && samples.length){
      let best = samples[0], bestD = 1e18;
      const tries = Math.min(200, samples.length); // 200 Zufallssamples für zuverlässiges Snapping
      for (let i=0;i<tries;i++){
        const p = samples[(Math.random()*samples.length)|0];
        const dx = p[0]-xx, dy=p[1]-yy;
        const d = dx*dx + dy*dy;
        if (d < bestD){ bestD=d; best=p; }
      }
      return {x: best[0], y: best[1]};
    }

    // Fallback (sollte praktisch nie passieren)
    let best = null, bestD = 1e18;
    for (let i=0;i<250;i++){
      const px = Math.random()*W;
      const py = Math.random()*H;
      if (!allowed(habitat, px, py)) continue;
      const dx = px - xx;
      const dy = py - yy;
      const d = dx*dx + dy*dy;
      if (d < bestD){ bestD=d; best=[px,py]; }
    }
    if (!best) best = [W*0.5, H*0.5];
    return {x: best[0], y: best[1]};
  }

  // Nach Zonenwechsel: bestehende Agenten in gültige Bereiche "zurückholen"
  function enforceAgentsToZone(resetTargets=true){
    const all = state.agents;
    for (const a of all){
      if (!a || !a.alive) continue;

      // Querläufer (dekorative Echsen) werden NICHT in Zonen gesnapt.
      if (a.kind==="ambient") continue;

      // Falls noch ein alter Migrationsmodus aktiv ist (z.B. durch Kartenwechsel),
      // dann sofort beenden – Migration ignoriert sonst Zonenbegrenzungen.
      if (a.kind==="lizard" && a.migrating){
        a.migrating = false;
        if (Number.isFinite(a.baseSpeed)) a.speed = a.baseSpeed;
        a.migrateUntil = null;
        a.target = null;
      }

      const hab = a.habitat || "red";
      if (!allowed(hab, a.x, a.y)){
        const snapped = snapToHabitat(hab, a.x, a.y);
        a.x = snapped.x;
        a.y = snapped.y;
      }

      if (resetTargets){
        if (a.kind==="pred"){
          a.targetId = null;
          a.target = null;
          a.wander = null;
        } else if (a.kind==="lizard"){
          // Nach Zonenwechsel: normales Bewegungsverhalten sauber zurücksetzen
          a.target = null;
          a.behaviorState = "idle";
          a.stateTimer = 0.2 + Math.random()*0.6;
          a.turnVel = 0;
        }
      }
    }
  }
function pickSpawn(habitat){
    const z = activeZone();
    if (z.fullHabitat) return {x: Math.random()*z.w, y: Math.random()*z.h};
    const useRed = (habitat==="red") || (habitat==="purple" && z.sharedHabitat);
    const edge = useRed ? z.redEdge : z.purpleEdge;
    const samples = useRed ? z.redSamples : z.purpleSamples;
    if (edge && edge.length) {
      const p = randChoice(edge);
      return {x:p[0], y:p[1]};
    }
    const p = randChoice(samples);
    return {x:p[0], y:p[1]};
  }

  function pickTarget(habitat){
    const z = activeZone();
    if (z.fullHabitat) return {x: Math.random()*z.w, y: Math.random()*z.h};
    const useRed = (habitat==="red") || (habitat==="purple" && z.sharedHabitat);
    const samples = useRed ? z.redSamples : z.purpleSamples;
    if (!samples || !samples.length) return null;
    const p = randChoice(samples);
    return {x:p[0], y:p[1]};
  }

  function pickNearestTarget(habitat, x, y){
    const z = activeZone();
    if (!z) return {x: x||0, y: y||0};
    if (z.fullHabitat){
      return {x: clamp(x, 0, z.w-1), y: clamp(y, 0, z.h-1)};
    }
    const useRed = (habitat==="red") || (habitat==="purple" && z.sharedHabitat);
    const samples = useRed ? z.redSamples : z.purpleSamples;
    if (!samples || !samples.length) return pickTarget(habitat);

    let best = samples[0];
    let bestD = 1e18;
    const xx = Number.isFinite(x) ? x : (z.w*0.5);
    const yy = Number.isFinite(y) ? y : (z.h*0.5);
    const tries = Math.min(220, samples.length);
    for (let i=0;i<tries;i++){
      const p = samples[(Math.random()*samples.length)|0];
      const dx = p[0]-xx, dy = p[1]-yy;
      const d = dx*dx + dy*dy;
      if (d < bestD){ bestD = d; best = p; }
    }
    return {x: best[0], y: best[1]};
  }


  function newSprite(src, cls){
    const img = document.createElement("img");
    img.className = "sprite " + (cls||"");
    try { img.loading = "eager"; } catch(_) {}
    try { img.decoding = "async"; } catch(_) {}
    img.src = src;
    img.alt = "";
    spriteLayer.appendChild(img);
    return img;
  }

  function createLizard(habitat, morphOverride=null){
    const p = pickSpawn(habitat);
    const sp = snapToHabitat(habitat, p.x, p.y);
    const morph = morphOverride || randChoice(LIZARD_GIFS);
    const el = newSprite(`GIFs/${morph}.gif`, "lizard");

    // Natürliches Bewegungsmuster: Idle/Wander-Zustandsmaschine, alle Richtungen
    const heading = Math.random() * Math.PI * 2; // volle 360°
    
     const baseSpeed = 50 + Math.random()*25;return {
      id: state.nextId++,
      kind:"lizard",
      habitat,
      morph,
      x: sp.x,
      y: sp.y,
      speed: baseSpeed,
       baseSpeed: baseSpeed,
      // Bewegungsparameter (natürliches Muster)
      heading,
      turnVel: (Math.random()*2 - 1) * 0.5,
      behaviorState: Math.random() < 0.5 ? "idle" : "wander",
      stateTimer: 1.0 + Math.random() * 2.5,
      facingRight: Math.cos(heading) >= 0,
      // Ziel wird nur während Migration verwendet
      target: null,
      alive:true,
      el
    };
  }

  function createPred(type){
    const habitat = (type==="weasel") ? "purple" : "red";

    // Mindestabstand zu bereits existierenden Jägern (gegen Spawn-Cluster)
    const minDist = predSpawnMinDist(type);
    const minDist2 = minDist * minDist;

    let best = null;
    let bestScore = -1;

    const tries = PRED_SPAWN_TRIES;
    for (let i=0;i<tries;i++){
      const p0 = pickSpawn(habitat);
      const sp0 = snapToHabitat(habitat, p0.x, p0.y);

      // minimaler Abstand zu allen existierenden Jägern
      let ok = true;
      let localMin = 1e18;
      for (const a of state.agents){
        if (!a.alive || a.kind!=="pred" || a.habitat!==habitat) continue;
        const dx = a.x - sp0.x, dy = a.y - sp0.y;
        const d2 = dx*dx + dy*dy;
        if (d2 < localMin) localMin = d2;
        if (d2 < minDist2) { ok = false; break; }
      }
      if (ok){
        best = sp0;
        bestScore = localMin;
        break;
      }
      if (localMin > bestScore){
        best = sp0;
        bestScore = localMin;
      }
    }

    // Fallback: wenn die Zone zu klein ist, nehmen wir den "besten" Kandidaten (max. Abstand),
    // um dennoch zu spawnen.
    let sp = best;
    if (!sp){
      const p1 = pickSpawn(habitat);
      sp = snapToHabitat(habitat, p1.x, p1.y);
    }

    const el = newSprite(`GIFs/${PRED_GIFS[type]}.gif`, "pred");
    el.classList.add(type);
    const baseSpeed = 75 + Math.random()*25;
    const speedMul = (type==="fox") ? state.predSpeedMulFox : state.predSpeedMulWeasel;
    return {
      id: state.nextId++,
      kind:"pred",
      predatorType:type,
      bornAt: (typeof state.t === "number" ? state.t : 0),
      foxNoKill:false,
      weaselNoKill:false,
      _lowPreyFreezeTagged:false,
      _lowPreyFreezeBlocked:false,
      _spawnedAfterLowPreyFreeze: false,
      spawnMarkerPending:true,
      habitat,
      x:sp.x, y:sp.y,
      baseSpeed,
      speed: baseSpeed * speedMul,
      heading: Math.random()*Math.PI*2,
      noiseSeed: Math.random()*1000,
      noiseT: Math.random()*1000,
      cooldownUntil: 0,
      targetId:null,
      target:null,
      wander:null,
      aimX: sp.x, aimY: sp.y,
      alive:true,
      el
    };
  }
function clearAgents(){
    for (const a of state.agents) {
      if (a.el && a.el.parentNode) a.el.parentNode.removeChild(a.el);
    }
    state.agents.length=0;
  }

  function spawnInitial(){
    clearAgents();
    state.ambientTimer = 0;
    state.redLowFoxFreezeLatched = false;
    state.redLowFoxFreezeAt = null;
    state.redLowFoxFreezeIdCutoff = null;
    state.redLowFoxFrozenIds = new Set();
    state.purpleLowWeaselFreezeLatched = false;
    state.purpleLowWeaselFreezeAt = null;
    state.purpleLowWeaselFreezeIdCutoff = null;
    state.purpleLowWeaselFrozenIds = new Set();
    // Startbestand:
    // - links (rot): 10× Base + 10× Gruen1
    // - rechts (lila): maximales Habitat-Limit (maxPerHab), 50/50 verteilt auf Base/Gruen1
    const maxPerHab = parseInt(document.getElementById("maxPerHab").value,10) || 40;

    const leftComp = [
      ["Echse_Base", 10],
      ["Echse_Gruen1", 10],
    ];
    for (const [morph, n] of leftComp){
      for (let i=0;i<n;i++) state.agents.push(createLizard("red", morph));
    }

    const nBase = Math.floor(maxPerHab/2);
    const nG1 = maxPerHab - nBase;
    for (let i=0;i<nBase;i++) state.agents.push(createLizard("purple", "Echse_Base"));
    for (let i=0;i<nG1;i++) state.agents.push(createLizard("purple", "Echse_Gruen1"));

    // Jäger
    const nPred = parseInt(document.getElementById("predCount").value,10)||0;
    const nW = Math.floor(nPred/2);
    const nF = nPred - nW;
    for (let i=0;i<nW;i++) state.agents.push(createPred("weasel"));
    for (let i=0;i<nF;i++) state.agents.push(createPred("fox"));
  }



  // --- Trocken-Querläufer (dekorative Echsen; nicht jagdbar, nicht in Diagrammen) ---
  // Spawnen nur auf Hintergrund_Trocken (alle 4s: 5 Stück), laufen geradlinig von Rand zu Rand
  // und despawnen erst am gegenüberliegenden Rand. Während Regen-Übergang (Trocken -> Ueberschwemmung)
  // wird das Spawning deaktiviert; bereits gespawnte Querläufer laufen noch aus.
  const AMBIENT_POOL = ["Echse_Base","Echse_Gruen1","Echse_Gruen2"];
  const AMBIENT_SPAWN_INTERVAL = 4; // s
  const AMBIENT_SPAWN_BATCH = 5;
  const AMBIENT_SPEED_MIN = 90; // px/s
  const AMBIENT_SPEED_MAX = 125; // px/s
  const AMBIENT_DESPAWN_MARGIN = 36; // px außerhalb des Bildrands
  const AMBIENT_WIGGLE_AMP_MIN = 14; // px
  const AMBIENT_WIGGLE_AMP_MAX = 28; // px
  const AMBIENT_WIGGLE_FREQ_MIN = 0.18; // Hz
  const AMBIENT_WIGGLE_FREQ_MAX = 0.32; // Hz

  function createAmbientCrosser(){
    const z = activeZone();
    if (!z) return null;

    const fromLeft = Math.random() < 0.5;
    const x = fromLeft ? 0 : (z.w-1);
    const y = 40 + Math.random() * (Math.max(0, z.h - 80));
    const vx = (fromLeft ? 1 : -1) * (AMBIENT_SPEED_MIN + Math.random() * (AMBIENT_SPEED_MAX - AMBIENT_SPEED_MIN));
    const morph = randChoice(AMBIENT_POOL);
    const el = newSprite(`GIFs/${morph}.gif`, "lizard");

    return {
      id: state.nextId++,
      kind: "ambient",
      morph,
      x, y,
      vx,
      vy: 0,
      baseY: y,
      wiggleT: 0,
      wigglePhase: Math.random()*Math.PI*2,
      wiggleAmp: (AMBIENT_WIGGLE_AMP_MIN + Math.random()*(AMBIENT_WIGGLE_AMP_MAX - AMBIENT_WIGGLE_AMP_MIN)) * getDeviceLogicScaleForKind("lizard"),
      wiggleOmega: 2*Math.PI*(AMBIENT_WIGGLE_FREQ_MIN + Math.random()*(AMBIENT_WIGGLE_FREQ_MAX - AMBIENT_WIGGLE_FREQ_MIN)),
      alpha: 1,
      fadeStart: null,
      fadeDur: null,
      alive: true,
      el
    };
  }

  function updateAmbientCrossers(dt){
    // Nur auf Trocken und NICHT während Morph/Transition zu Ueberschwemmung.
    const enabled = (state.mapName === "Hintergrund_Trocken") &&
                    !(state.transition && state.transition.kind === "rain") &&
                    !state.morphActive;

    if (!enabled){
      state.ambientTimer = 0;
      return;
    }

    state.ambientTimer = (state.ambientTimer || 0) + dt;
    while (state.ambientTimer >= AMBIENT_SPAWN_INTERVAL){
      state.ambientTimer -= AMBIENT_SPAWN_INTERVAL;
      for (let i=0;i<AMBIENT_SPAWN_BATCH;i++){
        const a = createAmbientCrosser();
        if (a) state.agents.push(a);
      }
    }
  }

  function beginAmbientFadeOut(durSec){
    state.ambientFadeActive = true;
    state.ambientFadeStart = state.t;
    state.ambientFadeDur = durSec;

    for (const a of state.agents){
      if (!a || !a.alive || a.kind!=="ambient") continue;
      a.fadeStart = state.t;
      a.fadeDur = durSec;
      a.alpha = 1;
    }
  }

  function purgeAmbientCrossers(){
    for (const a of state.agents){
      if (!a || !a.alive || a.kind!=="ambient") continue;
      killAgent(a);
    }
    state.ambientFadeActive = false;
    state.ambientFadeStart = null;
    state.ambientFadeDur = null;
  }

  function stepAmbientCrossers(dt){
    const z = activeZone();
    if (!z) return;
    const margin = AMBIENT_DESPAWN_MARGIN * getDeviceLogicScaleForKind("lizard");

    const fadeActive = !!state.ambientFadeActive;
    const fadeStart = state.ambientFadeStart || state.t;
    const fadeDur = state.ambientFadeDur || 5.0;

    for (const a of state.agents){
      if (!a || !a.alive || a.kind !== "ambient") continue;

      // Horizontal motion (slower) + snakelike wiggle
      a.x += (a.vx || 0) * dt;

      if (!Number.isFinite(a.wiggleT)) a.wiggleT = 0;
      if (!Number.isFinite(a.baseY)) a.baseY = a.y;
      if (!Number.isFinite(a.wiggleAmp)) a.wiggleAmp = 20;
      if (!Number.isFinite(a.wiggleOmega)) a.wiggleOmega = 2*Math.PI*0.25;
      if (!Number.isFinite(a.wigglePhase)) a.wigglePhase = 0;

      a.wiggleT += dt;
      a.y = a.baseY + a.wiggleAmp * Math.sin(a.wiggleT * a.wiggleOmega + a.wigglePhase);

      // Keep within bounds (center-based)
      a.y = clamp(a.y, 0, z.h-1);
      if (a.y === 0 || a.y === z.h-1) a.baseY = a.y;

      if (fadeActive){
        const u = clamp((state.t - (a.fadeStart || fadeStart)) / (a.fadeDur || fadeDur), 0, 1);
        a.alpha = 1 - u;
        // Während Fade-Out NICHT am Rand despawnen (Despawn erfolgt am Morph-Ende).
        a.x = clamp(a.x, 0, z.w-1);
      } else {
        a.alpha = 1;
        // Normal: despawn, sobald gegenüberliegender Bildschirmrand erreicht ist
        if ((a.vx > 0 && a.x >= z.w + margin) || (a.vx < 0 && a.x <= -margin)){
          killAgent(a);
        }
      }
    }
  }

function updateSprites(){
  if (!state.zone) return;
  const scaleX = state.scaleX || 1;
  const scaleY = state.scaleY || 1;

  for (const a of state.agents) {
    if (!a.alive) continue;
    const p = worldToScreenScaled(a.x, a.y, scaleX, scaleY);

    // Sprite-Rotation: rechte GIF-Seite = Kopf (0 rad zeigt nach rechts)
    const px0 = (typeof a.prevX === "number") ? a.prevX : a.x;
    const py0 = (typeof a.prevY === "number") ? a.prevY : a.y;
    const dx = a.x - px0;
    const dy = a.y - py0;

    // Bei Stillstand letzte Rotation beibehalten
    if (Math.abs(dx) + Math.abs(dy) > 0.001){
      a.rot = Math.atan2(dy, dx);
    }
    const rot = (typeof a.rot === "number") ? a.rot : 0;

    // Performance: transform statt left/top (vermeidet Layout-Thrashing)
    const baseSc = predVisualScale(a);
    const devSc = getDeviceSpriteScaleForAgent(a);
    const src = a.el ? (a.el.getAttribute("src") || a.el.currentSrc || "") : "";
    const isGifSprite = /\.gif(?:$|\?)/i.test(src);
    const mobileGifScale = (
      isGifSprite &&
      window.matchMedia &&
      window.matchMedia("(max-width: 900px) and (orientation: landscape)").matches
    ) ? 0.75 : 1;
    const sc = baseSc * devSc * mobileGifScale;
    a.el.style.transform = `translate3d(${p.sx}px, ${p.sy}px, 0) translate(-50%,-50%) rotate(${rot}rad) scale(${sc})`;

    if (a.kind==="pred"){
      const active = (a.predatorType==="weasel") ? state.day : !state.day;
      a.el.style.display = active ? "block" : "none";
      a.el.style.opacity = "1";
    } else {
      a.el.style.display = "block";
      if (a.kind==="ambient" && typeof a.alpha === "number") {
        a.el.style.opacity = String(clamp(a.alpha, 0, 1));
      } else {
        a.el.style.opacity = "1";
      }
    }
  }
}

function drawBackground(){
    if (!state.bgImg) return;
    const cw = simCanvas.width, ch = simCanvas.height;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.clearRect(0,0,cw,ch);
    ctx.drawImage(state.bgImg, 0,0, cw, ch);
  }

  function stepAgents(dt){
    const z = activeZone();
    if (!z) return;

    // Dekorative Trocken-Querläufer (laufen frei über die Karte; despawn am Rand)
    stepAmbientCrossers(dt);

    // Lizard targets
    for (const a of state.agents){
      if (!a.alive) continue;
      if (a.kind==="lizard"){
        if (a.migrating){
          if (!a.target || (Math.hypot(a.target.x-a.x, a.target.y-a.y) < 27)){
            a.target = pickNearestTarget(a.habitat, a.x, a.y) || pickTarget(a.habitat);
          }
        } else {
          a.target = null;
        }
      } else if (a.kind==="pred"){
        if (a.wander && (Math.hypot(a.wander.x-a.x, a.wander.y-a.y) < predWanderArriveRadius(a))){
          a.wander = null;
        }
      }
    }

    const lizards = state.agents.filter(a=>a.alive && a.kind==="lizard");
    const lizardById = new Map();
    for (const l of lizards) lizardById.set(l.id, l);    // Sonderregel (beide Habitate): Fällt die Anzahl der Echsen in einem Habitat unter 15,
    // verlieren die zu DIESEM Zeitpunkt bereits gespawnten Jäger dieses Habitats ihre Kill-Fähigkeit.
    // Neu gespawnte Jäger bleiben jagdaktiv. Die Regel wird pro Habitat nur einmal pro Durchlauf ausgelöst.
    const redLizardCount = lizards.reduce((n,l)=> n + (l.habitat==="red" ? 1 : 0), 0);
    const purpleLizardCount = lizards.reduce((n,l)=> n + (l.habitat==="purple" ? 1 : 0), 0);

    const redBelow15 = redLizardCount < 15;
    const purpleBelow15 = purpleLizardCount < 15;

    // Edge-Trigger statt globaler Dauer-Sperre:
    // Nur beim Übergang >=15 -> <15 werden die *aktuell vorhandenen* Jäger markiert.
    // Neu gespawnte Jäger bleiben jagdaktiv, selbst wenn die Echsenzahl weiter <15 bleibt.
    if (redBelow15 && !state.redLowFoxFreezeLatched){
      state.redLowFoxFreezeAt = state.t;
      for (const p of state.agents){
        if (!p.alive || p.kind!=="pred" || p.predatorType!=="fox") continue;
        p._lowPreyFreezeTagged = true;
        p._lowPreyFreezeBlocked = true;
        applyPredLowPreyFreezeFlags(p);
        p.targetId = null;
        p.target = null;
      }
    }
    if (purpleBelow15 && !state.purpleLowWeaselFreezeLatched){
      state.purpleLowWeaselFreezeAt = state.t;
      for (const p of state.agents){
        if (!p.alive || p.kind!=="pred" || p.predatorType!=="weasel") continue;
        p._lowPreyFreezeTagged = true;
        p._lowPreyFreezeBlocked = true;
        applyPredLowPreyFreezeFlags(p);
        p.targetId = null;
        p.target = null;
      }
    }
    // Hier dienen die Latched-Flags nur noch als Edge-Merker (previous below threshold),
    // nicht mehr als globale Jagd-Sperre.
    state.redLowFoxFreezeLatched = redBelow15;
    state.purpleLowWeaselFreezeLatched = purpleBelow15;

    // Predators choose/track target if active (Wiesel: Tag, Fuchs: Nacht)
    // 1) Aktivität + Habitat zuweisen + inaktive resetten
    const activePreds = [];
    for (const p of state.agents){
      if (!p.alive || p.kind!=="pred") continue;

      // noKill-Status pro Tick rein aus Objekt-Markierung ableiten (kein globaler Jagdstopp).
      applyPredLowPreyFreezeFlags(p);

      const active = (p.predatorType==="weasel") ? state.day : !state.day;
      if (!active){
        // WICHTIG: Jäger werden hier nicht despawned, sondern nur deaktiviert.
        // Damit ein Low-Prey-Jagdstopp nicht dauerhaft über spätere Aktivierungen weiterwirkt,
        // wird die Blockierung beim Verlassen der aktiven Phase wieder entfernt.
        if (p._lowPreyFreezeBlocked || p._lowPreyFreezeTagged){
          p._lowPreyFreezeBlocked = false;
          p._lowPreyFreezeTagged = false;
          applyPredLowPreyFreezeFlags(p);
        }
        p.targetId = null;
        p.target = null;
        p.wander = null;
        continue;
      }

      // Revier-Regel: Trocken = gesamte Fläche; alle anderen Hintergründe = Fuchs Rot, Wiesel Lila.
      // Während des Übergangs gilt die Regel bereits ab der Logik-Zonen-Umschaltung.
      if (!(state.mapName==="Hintergrund_Trocken" && !state.logicZone)){
        p.habitat = (p.predatorType==="weasel") ? "purple" : "red";
      }
      activePreds.push(p);
    }

    // 2) Validate existing targets + handle cooldown
    for (const p of activePreds){
      if (p.cooldownUntil && state.t < p.cooldownUntil){
        p.targetId = null;
        p.target = null;
        if (!p.wander) p.wander = pickWanderLocal(p.habitat, p.x, p.y);
        continue;
      }

      if (p.targetId){
        const prey = lizardById.get(p.targetId);
        if (!prey || !prey.alive || !allowed(p.habitat, prey.x, prey.y)){
          p.targetId = null;
          p.target = null;
        } else {
          p.target = {x: prey.x, y: prey.y};
        }
      }
    }

    // 3) Enforce unique prey assignments (keine zwei Jäger dürfen dieselbe Beute gleichzeitig haben)
    //    + speichert Distanz & Priorität für spätere Übernahmen (Takeover)
    const claim = new Map(); // preyId -> {p, d2, rank}
    for (const p of activePreds){
      if (p.cooldownUntil && state.t < p.cooldownUntil) continue;
      if (predBlockedByLowPreyFreeze(p)) continue;
      if (!p.targetId) continue;

      const prey = lizardById.get(p.targetId);
      if (!prey || !prey.alive){
        p.targetId = null;
        p.target = null;
        continue;
      }
      const dx = prey.x - p.x, dy = prey.y - p.y;
      const d2 = dx*dx + dy*dy;
      const rank = preyPriorityRank(p.habitat, prey.morph, state.mapName);

      const prev = claim.get(prey.id);
      if (!prev || d2 < prev.d2){
        if (prev){
          prev.p.targetId = null;
          prev.p.target = null;
        }
        claim.set(prey.id, {p, d2, rank});
      } else {
        p.targetId = null;
        p.target = null;
      }
    }

    // 4) Rebalance + Acquire targets (Priorität, dann Distanz)
    //    Wenn ein näherer Jäger ein (bereits belegtes) Ziel mit hoher Priorität besser erreichen kann,
    //    übernimmt er es; der entfernte Jäger sucht im selben Tick ein neues Ziel.
    const maxAssignPasses = Math.min(4, Math.max(1, activePreds.length));
    for (let pass=0; pass<maxAssignPasses; pass++){
      let changed = false;

      for (const p of activePreds){
        if (p.cooldownUntil && state.t < p.cooldownUntil) continue;
        if (predBlockedByLowPreyFreeze(p)){
          if (p.targetId){
            const oldClaim = claim.get(p.targetId);
            if (oldClaim && oldClaim.p === p) claim.delete(p.targetId);
          }
          p.targetId = null;
          p.target = null;
          if (!p.wander) p.wander = pickWanderLocal(p.habitat, p.x, p.y);
          continue;
        }

        // Aktuelles Ziel als Start-Benchmark (damit nur echte Verbesserungen wechseln)
        let chosen = null;
        let bestRank = 9999;
        let bestD = 1e30;
        let takeoverFrom = null;

        if (p.targetId){
          const prey = lizardById.get(p.targetId);
          const ownClaim = claim.get(p.targetId);
          if (prey && prey.alive && ownClaim && ownClaim.p === p && allowed(p.habitat, prey.x, prey.y)){
            chosen = prey;
            bestRank = ownClaim.rank;
            bestD = ownClaim.d2;
          } else {
            p.targetId = null;
            p.target = null;
          }
        }

        for (const l of lizards){
          if (!l.alive) continue;
          if (!allowed(p.habitat, l.x, l.y)) continue; // Revier

          const dx = l.x - p.x, dy = l.y - p.y;
          const d = dx*dx + dy*dy;
          const rank = preyPriorityRank(p.habitat, l.morph, state.mapName);
          const occ = claim.get(l.id);

          // Belegte Ziele dürfen nur übernommen werden, wenn dieser Jäger tatsächlich näher ist.
          if (occ && occ.p !== p && !(d < occ.d2)) continue;

          // Zielwechsel nur bei Verbesserung: zuerst Priorität, dann Distanz.
          if (!(rank < bestRank || (rank === bestRank && d < bestD))) continue;

          chosen = l;
          bestRank = rank;
          bestD = d;
          takeoverFrom = (occ && occ.p !== p) ? occ : null;
        }

        if (chosen){
          const sameTarget = (p.targetId === chosen.id);

          if (!sameTarget){
            // Altes Claim freigeben
            if (p.targetId){
              const oldClaim = claim.get(p.targetId);
              if (oldClaim && oldClaim.p === p) claim.delete(p.targetId);
            }

            // Zielübernahme: bisherigen Jäger freigeben, damit er im selben Tick neu wählen kann
            if (takeoverFrom && takeoverFrom.p && takeoverFrom.p !== p){
              takeoverFrom.p.targetId = null;
              takeoverFrom.p.target = null;
              takeoverFrom.p.wander = null;
            }

            p.targetId = chosen.id;
            p.wander = null;
            changed = true;
          }

          p.target = {x: chosen.x, y: chosen.y};
          claim.set(chosen.id, {p, d2: bestD, rank: bestRank});
        } else {
          if (p.targetId){
            const oldClaim = claim.get(p.targetId);
            if (oldClaim && oldClaim.p === p) claim.delete(p.targetId);
          }
          if (!p.wander) p.wander = pickWanderLocal(p.habitat, p.x, p.y);
          p.targetId = null;
          p.target = null;
        }
      }

      if (!changed) break;
    }

// Integrate movement
    for (const a of state.agents){
      if (!a.alive) continue;

      // Echsen: im Normalbetrieb natürliches Idle/Wander-Muster (ohne Zielpunkte)
      if (a.kind==="lizard" && !a.migrating){
        const ox = a.x, oy = a.y;
        stepLizardWiggle(a, dt);
        if (state.lizardDistanceTrackActive){
          const dd = Math.hypot(a.x-ox, a.y-oy);
          if (dd > 0 && Number.isFinite(dd)){
            const hb = (a.habitat === "purple") ? "purple" : "red";
            const phase = state.day ? "day" : "night";
            state.lizardDist[hb][phase] += dd;
          }
        }
        continue;
      }

      const _lx0 = (a.kind==="lizard") ? a.x : 0;
      const _ly0 = (a.kind==="lizard") ? a.y : 0;
      let tx = null, ty = null;

      if (a.kind==="lizard" && a.target){
        tx = a.target.x; ty = a.target.y;
      } else if (a.kind==="pred"){
        if (a.targetId){
          const prey = lizardById.get(a.targetId);
          if (prey && prey.alive){
            tx = prey.x; ty = prey.y;
          } else {
            a.targetId = null;
            a.target = null;
          }
        }
        if (tx===null && a.wander){
          tx = a.wander.x; ty = a.wander.y;
        }
      }

      if (tx===null) continue;
      // Predator: Zielpunkt weich filtern, um harte Richtungswechsel ("Snappen") zu vermeiden
      if (a.kind==="pred"){
        if (!Number.isFinite(a.aimX) || !Number.isFinite(a.aimY)){
          a.aimX = tx; a.aimY = ty;
        } else {
          const alpha = 1 - Math.exp(-PRED_TARGET_SMOOTH_K * Math.max(0, dt));
          a.aimX += (tx - a.aimX) * alpha;
          a.aimY += (ty - a.aimY) * alpha;
        }
        tx = a.aimX; ty = a.aimY;
      }


      let dx = tx - a.x, dy = ty - a.y;
      let dist = Math.hypot(dx,dy) || 1;


      if (a.kind==="lizard" && a.migrating && Number.isFinite(a.migrateUntil)){
        const remain = Math.max(0.05, a.migrateUntil - state.t);
        const base = Number.isFinite(a.baseSpeed) ? a.baseSpeed : a.speed;
        const need = dist / remain;
        a.speed = Math.max(base * MIGRATION_SPEED_MULT, need * 1.25);
      }
      const step = Math.min(a.speed * dt, dist);

      let nx, ny;

      // Predator: sowohl Wander- als auch Beuteziel mit Heading/Turn-Rate steuern (flüssiger Übergang, kein "Snappen")
      if (a.kind==="pred" && (a.targetId || a.wander)){
        const desired = Math.atan2(dy, dx);
        if (!Number.isFinite(a.heading)) a.heading = desired;
        if (!Number.isFinite(a.noiseT)) a.noiseT = Math.random()*1000;
        if (!Number.isFinite(a.noiseSeed)) a.noiseSeed = Math.random()*1000;

        const isWander = (!a.targetId && a.wander);
        if (isWander) a.noiseT += dt;

        const noise = isWander
          ? (Math.sin(a.noiseT * PRED_WANDER_NOISE_FREQ + a.noiseSeed) * PRED_WANDER_NOISE_AMP)
          : 0;

        const goal = desired + noise;
        const turnRate = isWander ? PRED_WANDER_TURN_RATE : PRED_CHASE_TURN_RATE;

        a.heading = turnTowardAngle(a.heading, goal, turnRate * dt);
        nx = a.x + Math.cos(a.heading) * step;
        ny = a.y + Math.sin(a.heading) * step;
      } else {
        // Default: geradlinig zum Ziel
        nx = a.x + (dx/dist) * step;
        ny = a.y + (dy/dist) * step;
      }

      // Sprite-Richtung aktualisieren (auch bei Migration und Raubtier-Verfolgung)
      if (a.kind === "lizard") a.facingRight = dx >= 0;

      if (a.kind==="lizard"){
        if (a.migrating){
          // während Migration KEINE Bewegungsbegrenzung (kein Snap), nur innerhalb der Kartenbounds clampen
          a.x = clamp(nx, 0, z.w-1);
          a.y = clamp(ny, 0, z.h-1);

          // angekommen?
          if (allowed(a.habitat, a.x, a.y)){
            a.migrating = false;
            if (Number.isFinite(a.baseSpeed)) a.speed = a.baseSpeed;

            a.migrateUntil = null;
            a.target = null;
            // Nach Migration: kurze Ruhepause, dann normales Verhalten
            a.behaviorState = "idle";
            a.stateTimer = 1.0 + Math.random() * 1.5;
            a.heading = Math.random() * Math.PI * 2;
            a.turnVel = 0;
          }
        } else {
          if (allowed(a.habitat, nx, ny)){
            a.x = nx; a.y = ny;
          } else {
            // bisection along old->new
            let lo=0, hi=1, bx=a.x, by=a.y;
            for (let i=0;i<10;i++){
              const mid=(lo+hi)/2;
              const mx=a.x + (nx-a.x)*mid;
              const my=a.y + (ny-a.y)*mid;
              if (allowed(a.habitat, mx, my)) { lo=mid; bx=mx; by=my; } else hi=mid;
            }
            if (lo>0) { a.x=bx; a.y=by; }
            else {
              const sp = snapToHabitat(a.habitat, a.x, a.y);
              a.x=sp.x; a.y=sp.y;
            }
          }
        }
      } else if (a.kind==="pred"){
        const hab = a.habitat || ((a.predatorType==="weasel") ? "purple" : "red");
        const zoneTol = predZoneTolForAgent(a);
        if (allowedWithTol(hab, nx, ny, zoneTol)){
          a.x = nx; a.y = ny;
        } else {
          let lo=0, hi=1, bx=a.x, by=a.y;
          for (let i=0;i<10;i++){
            const mid=(lo+hi)/2;
            const mx=a.x + (nx-a.x)*mid;
            const my=a.y + (ny-a.y)*mid;
            if (allowedWithTol(hab, mx, my, zoneTol)) { lo=mid; bx=mx; by=my; } else hi=mid;
          }
          if (lo>0) { a.x=bx; a.y=by; }
          else {
            const sp = snapToHabitat(hab, a.x, a.y);
            a.x=sp.x; a.y=sp.y;
          }
        }
      } else {
        a.x = clamp(nx, 0, z.w-1);
        a.y = clamp(ny, 0, z.h-1);
      }

      if (a.kind==="lizard" && state.lizardDistanceTrackActive){
        const dd = Math.hypot(a.x-_lx0, a.y-_ly0);
        if (dd > 0 && Number.isFinite(dd)){
          const hb = (a.habitat === "purple") ? "purple" : "red";
          const phase = state.day ? "day" : "night";
          state.lizardDist[hb][phase] += dd;
        }
      }
    }

    // Predation: nur das aktuell verfolgte Ziel (kein Massaker im Radius)
    const killCooldownFox = 2.0;   // s (Fuchs)
    const killCooldownWeasel = 2.0; // s (Wiesel)
    for (const p of state.agents){
      if (!p.alive || p.kind!=="pred") continue;
      const active = (p.predatorType==="weasel") ? state.day : !state.day;
      if (!active) continue;
      if (p.cooldownUntil && state.t < p.cooldownUntil) continue;
      if (predBlockedByLowPreyFreeze(p)) continue;
      if (!p.targetId) continue;

      const prey = lizardById.get(p.targetId);
      if (!prey || !prey.alive){
        p.targetId = null;
        p.target = null;
        continue;
      }

      const ddx = prey.x - p.x, ddy = prey.y - p.y;
const killR = predKillRadius(p);
if ((ddx*ddx + ddy*ddy) < killR*killR){
  // deterministisch: sobald ein Ziel angesteuert ist und im Kill-Radius liegt -> 100% Kill
  killAgent(prey);
  p.cooldownUntil = state.t + ((p.predatorType === "fox") ? killCooldownFox : killCooldownWeasel);
  p.targetId = null;
  p.target = null;
}

    }
  }

  function reproduction(dt){

    const perMin = parseFloat(document.getElementById("reproPerMin").value)||0;
    const maxPerHab = parseInt(document.getElementById("maxPerHab").value,10)||999999;
    const dtMin = dt/60;

    const lizards = state.agents.filter(a=>a.alive && a.kind==="lizard");
    let redCount = lizards.filter(a=>a.habitat==="red").length;
    let purCount = lizards.filter(a=>a.habitat==="purple").length;

    for (const l of lizards) {
      if (Math.random() < perMin*dtMin) {
        if (l.habitat==="red" && redCount>=maxPerHab) continue;
        if (l.habitat==="purple" && purCount>=maxPerHab) continue;
        let childMorph = l.morph;
        if (Math.random() < MUTATION_RATE) {
          const opts = MUTATION_MAP[l.morph] || [];
          if (opts.length){
            childMorph = randChoice(opts);
          } else {
            // Fallback (sollte praktisch nie passieren): irgendein anderer Morph
            const fb = LIZARD_GIFS.filter(k => k !== l.morph);
            childMorph = fb.length ? randChoice(fb) : l.morph;
          }
        }
        const baby = createLizard(l.habitat, childMorph);
        baby.x = l.x + (Math.random()*12-6);
        baby.y = l.y + (Math.random()*12-6);

        // während Flut-Übergang: Spawn-/Bewegungszone der Ueberschwemmung anwenden, aber kein Snap
        const z = activeZone();
        baby.x = clamp(baby.x, 0, z.w-1);
        baby.y = clamp(baby.y, 0, z.h-1);

        const inFloodMigration = !!(state.transition && state.transition.kind==="rain" && state.transition.migrated && state.logicZone);
        if (inFloodMigration){
          baby.migrating = true;
          baby.baseSpeed = baby.speed;
          baby.speed = baby.baseSpeed * MIGRATION_SPEED_MULT;
          baby.target = pickTarget(baby.habitat);
        } else {
          const sp = snapToHabitat(baby.habitat, baby.x, baby.y);
          baby.x = sp.x; baby.y = sp.y;
        }
        state.agents.push(baby);
        if (l.habitat==="red") redCount++; else purCount++;
      }
    }
  }

  function updateKPIs(){
    const lizards = state.agents.filter(a=>a.alive && a.kind==="lizard");
    const red = lizards.filter(a=>a.habitat==="red").length;
    const pur = lizards.filter(a=>a.habitat==="purple").length;
    const weasel = state.agents.filter(a=>a.alive && a.kind==="pred" && a.predatorType==="weasel").length;
    const fox = state.agents.filter(a=>a.alive && a.kind==="pred" && a.predatorType==="fox").length;
    document.getElementById("kRed").textContent = red;
    document.getElementById("kPurple").textContent = pur;
    document.getElementById("kPred").textContent = `${weasel} / ${fox}`;

    const d = state.lizardDist || { red:{day:0,night:0}, purple:{day:0,night:0} };
    const active = !!state.lizardDistanceTrackActive;
    const waiting = "ab 2. Wetterereignis";
    const elRD = document.getElementById("kDistRedDay");
    const elRN = document.getElementById("kDistRedNight");
    const elPD = document.getElementById("kDistPurpleDay");
    const elPN = document.getElementById("kDistPurpleNight");
    if (elRD) elRD.textContent = active ? formatDistPx(d.red.day) : waiting;
    if (elRN) elRN.textContent = active ? formatDistPx(d.red.night) : waiting;
    if (elPD) elPD.textContent = active ? formatDistPx(d.purple.day) : waiting;
    if (elPN) elPN.textContent = active ? formatDistPx(d.purple.night) : waiting;
  }

  function pushHistory(){
    const lizards = state.agents.filter(a=>a.alive && a.kind==="lizard");
    const red = lizards.filter(a=>a.habitat==="red").length;
    const pur = lizards.filter(a=>a.habitat==="purple").length;
    const point = {t:state.t, red, pur};
    state.history.push(point);
    state.historyAll.push(point);
    if (state.history.length > 240) state.history.shift();

    // Events im gleichen Fenster halten
    if (state.events && state.history.length){
      const minT = state.history[0].t - 2;
      while (state.events.length && state.events[0].t < minT) state.events.shift();
    }
  }

  // --- Charts ---
  function resizeCanvasToDisplaySize(c){
    const r = c.getBoundingClientRect();
    const w = Math.max(2, Math.floor(r.width * devicePixelRatio));
    const h = Math.max(2, Math.floor(r.height * devicePixelRatio));
    if (c.width !== w || c.height !== h){
      c.width = w;
      c.height = h;
    }
  }

  function resizeCharts(){
    const ids = ["chartLine","chartZoneTypesRed","chartZoneTypesPurple"];
    for (const id of ids){
      const c = document.getElementById(id);
      if (c) resizeCanvasToDisplaySize(c);
    }
  }

  // Spawn-Icons für Populationsdiagramm (Fuchs/Wiesel) mit robustem Datei-Fallback
  const _predSpawnIconAsset = Object.create(null);
  function getPredatorSpawnIconAsset(kind){
    const key = (kind === "foxSpawn") ? "foxSpawn" : (kind === "weaselSpawn" ? "weaselSpawn" : "");
    if (!key) return null;
    if (_predSpawnIconAsset[key]) return _predSpawnIconAsset[key];

    const candidates = [
      (key === "foxSpawn") ? "Bilder/Fuchsicon.png" : "Bilder/Wieselicon.png"
    ];

    const asset = { img:new Image(), ready:false, failed:false, src:"" };
    _predSpawnIconAsset[key] = asset;
    let idx = 0;

    const tryNext = ()=>{
      if (idx >= candidates.length){
        asset.failed = true;
        return;
      }
      asset.src = candidates[idx++];
      asset.img.src = asset.src;
    };

    asset.img.onload = ()=>{
      asset.ready = true;
      asset.failed = false;
      try {
        const iw = asset.img.naturalWidth || asset.img.width || 0;
        const ih = asset.img.naturalHeight || asset.img.height || 0;
        if (iw > 0 && ih > 0){
          const oc = document.createElement("canvas");
          oc.width = iw; oc.height = ih;
          const og = oc.getContext("2d", { willReadFrequently:true });
          og.drawImage(asset.img, 0, 0);
          const imgd = og.getImageData(0, 0, iw, ih).data;
          let minX = iw, minY = ih, maxX = -1, maxY = -1;
          for (let y=0; y<ih; y++){
            for (let x=0; x<iw; x++){
              const a = imgd[(y*iw + x)*4 + 3];
              if (a > 8){
                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
              }
            }
          }
          if (maxX >= minX && maxY >= minY){
            asset.trim = { sx:minX, sy:minY, sw:(maxX-minX+1), sh:(maxY-minY+1) };
          } else {
            asset.trim = { sx:0, sy:0, sw:iw, sh:ih };
          }
        }
      } catch(_trimErr){
        asset.trim = null;
      }
      try {
        requestAnimationFrame(()=>{ try{ drawLineChart(); }catch(_e){} });
      } catch(_e) {}
    };
    asset.img.onerror = ()=>{
      tryNext();
    };

    tryNext();
    return asset;
  }

  function drawLineChartCore(c, hist, evs, opts){
    if (!c) return;
    const g = c.getContext("2d");
    const W = c.width, H = c.height;
    const DPR = (devicePixelRatio || 1);
    opts = opts || {};
    const useSpawnImageIcons = (opts.useSpawnImageIcons !== false);
    const isExportLight = opts.theme !== "dark";
    const chartColors = isExportLight ? {
      bg: "#ffffff",
      axis: "rgba(100,116,139,.55)",
      grid: "rgba(148,163,184,.32)",
      tick: "#000000",
      eventLine: "rgba(100,116,139,.35)",
      band: "rgba(226,232,240,.55)",
      cycleLine: "rgba(100,116,139,.52)",
      cycleLabelBg: "rgba(255,255,255,.86)",
      cycleLabel: "#000000",
      spawnCount: "#000000"
    } : {
      bg: "rgba(2,6,23,.35)",
      axis: "rgba(148,163,184,.25)",
      grid: "rgba(148,163,184,.18)",
      tick: "rgba(203,213,225,.75)",
      eventLine: "rgba(148,163,184,.18)",
      band: "rgba(148,163,184,.045)",
      cycleLine: "rgba(148,163,184,.32)",
      cycleLabelBg: "rgba(2,6,23,.78)",
      cycleLabel: "rgba(226,232,240,.85)",
      spawnCount: "rgba(226,232,240,.95)"
    };

    g.clearRect(0,0,W,H);
    g.fillStyle = chartColors.bg;
    g.fillRect(0,0,W,H);

    if (!hist || hist.length < 2) return;

    const minX = hist[0].t, maxX = hist[hist.length-1].t;
    const span = Math.max(1e-6, maxX - minX);

    const maxY = Math.max(10, ...hist.map(h=>Math.max(h.red,h.pur)));

    const padL = 38*DPR, padR = 18*DPR, padT = 20*DPR, padB = 28*DPR;

    const yTop = Math.max(40, Math.ceil(maxY / 10) * 10);
    const xScale = (t)=> padL + (t-minX)/span * (W - padL - padR);
    const yScale = (v)=> (H - padB) - (v/yTop) * (H - padT - padB);

    const sampleSeriesAt = (key, t)=>{
      if (!hist || !hist.length) return 0;
      if (t <= hist[0].t) return hist[0][key] || 0;
      const last = hist[hist.length-1];
      if (t >= last.t) return last[key] || 0;
      for (let i=1;i<hist.length;i++){
        const b = hist[i];
        if (b.t < t) continue;
        const a = hist[i-1];
        const dt = (b.t - a.t) || 1;
        const u = Math.max(0, Math.min(1, (t - a.t) / dt));
        return (a[key] || 0) + ((b[key] || 0) - (a[key] || 0)) * u;
      }
      return last[key] || 0;
    };

    // Achsen
    g.strokeStyle = chartColors.axis;
    g.lineWidth = 1.2*DPR;

    g.beginPath();
    g.moveTo(padL, padT);
    g.lineTo(padL, H-padB);
    g.lineTo(W-padR, H-padB);
    g.stroke();

    // Y-Ticks + Beschriftungen (immer in 10er-Schritten, damit 10 und 30 sichtbar sind)
    const yTicks = [];
    for (let val = 0; val <= yTop; val += 10) yTicks.push(val);
    g.font = `${10*DPR}px Arial, Helvetica, sans-serif`;
    g.fillStyle = chartColors.tick;
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const val of yTicks){
      const y = yScale(val);
      g.strokeStyle = chartColors.grid;
      g.lineWidth = 1*DPR;
      g.beginPath();
      g.moveTo(padL - 4*DPR, y);
      g.lineTo(W - padR, y);
      g.stroke();
      g.fillText(String(val), padL - 7*DPR, y);
    }

    // X-Ticks + Zeitlabels (mm:ss)
    let step = 10;
    if (span > 60) step = 20;
    if (span > 120) step = 30;
    if (span > 240) step = 60;
    if (span > 600) step = 120;

    const fmt = (t)=>{
      const mm = Math.floor(t/60).toString().padStart(2,"0");
      const ss = Math.floor(t%60).toString().padStart(2,"0");
      return `${mm}:${ss}`;
    };

    g.font = `${10*DPR}px Arial, Helvetica, sans-serif`;
    g.fillStyle = chartColors.tick;
    g.textAlign = "center";
    g.textBaseline = "top";

    const tickSet = new Set([Math.round(minX)]);
    const first = Math.ceil(minX/step)*step;
    for (let tt = first; tt <= maxX + 1e-6; tt += step) tickSet.add(Math.round(tt));
    tickSet.add(Math.round(maxX));
    const ticks = Array.from(tickSet).sort((a,b)=>a-b);
    for (const tt of ticks){
      const x = xScale(tt);
      g.strokeStyle = chartColors.grid;
      g.lineWidth = 1*DPR;
      g.beginPath();
      g.moveTo(x, H-padB); g.lineTo(x, H-padB + 5*DPR);
      g.stroke();
      g.fillText(fmt(tt), x, H-padB + 7*DPR);
    }

    // Serien-Legende oben im Diagramm
    const legendY = 8*DPR;
    g.textBaseline = "middle";
    g.font = `${10*DPR}px Arial, Helvetica, sans-serif`;
    g.textAlign = "left";
    let legendX = padL + 4*DPR;
    g.lineWidth = 2.2*DPR;
    g.strokeStyle = "rgba(239,68,68,.90)";
    g.beginPath(); g.moveTo(legendX, legendY); g.lineTo(legendX + 12*DPR, legendY); g.stroke();
    legendX += 15*DPR;
    g.fillStyle = "#000000";
    g.fillText("links", legendX, legendY);
    legendX += g.measureText("links").width + 14*DPR;
    g.strokeStyle = "rgba(168,85,247,.90)";
    g.beginPath(); g.moveTo(legendX, legendY); g.lineTo(legendX + 12*DPR, legendY); g.stroke();
    legendX += 15*DPR;
    g.fillText("rechts", legendX, legendY);
    g.textAlign = "center";
    g.textBaseline = "top";

    // Events (Wetter + Jäger-Spawns) als Marker auf der Zeitachse
    evs = evs || [];

    // Wetterereignisse (Kreise auf Zeitachse)
    const weatherColor = (k)=>{
      if (k==="rain") return "rgba(56,189,248,.90)";
      if (k==="fire") return "rgba(251,146,60,.92)";
      return "rgba(167,139,250,.92)"; // storm
    };
    const weatherLabel = (k)=> (k==="rain") ? "R" : (k==="fire") ? "F" : "G";

    // Jäger-Spawnmarker (obere Kante)
    const isSpawnEvent = (k)=> (k==="foxSpawn" || k==="weaselSpawn");
    const spawnStroke = (k)=> (k==="foxSpawn") ? "rgba(251,146,60,.60)" : "rgba(56,189,248,.60)";
    const spawnFill   = (k)=> (k==="foxSpawn") ? "rgba(251,146,60,.95)" : "rgba(56,189,248,.95)";
    const spawnLabel  = (k)=> (k==="foxSpawn") ? "F" : "W";

    // Spawnmarker: Events sind bereits in recordEvent() batchweise zusammengefasst.
    // Hier nur sichtbare Wetter- und Spawn-Events für den aktuellen Zeitbereich sammeln.
    const visibleSpawnEvents = [];
    const visibleWeatherEvents = [];

    for (const e of (evs || [])){
      if (!e || !Number.isFinite(e.t)) continue;

      const isSpawn = isSpawnEvent(e.kind);
      if (e.t > maxX) continue;
      if (e.t < minX) continue;

      const xRaw = xScale(e.t);
      const xClamped = Math.max(padL + 6*DPR, Math.min(W - padR - 6*DPR, xRaw));

      if (isSpawn){
        visibleSpawnEvents.push({ e });
      } else {
        visibleWeatherEvents.push({ e, x:xClamped });
      }
    }

    // Alte Spawnmarker-Overlay-Logik deaktiviert (F/W-Textmarker):
    // Darstellung erfolgt weiter unten ausschließlich über Icons direkt auf den Linien.

    for (const {e, x} of visibleWeatherEvents){
      // Wettermarker
      g.save();
      g.setLineDash([4*DPR, 4*DPR]);
      g.strokeStyle = chartColors.eventLine;
      g.lineWidth = 1*DPR;
      g.beginPath();
      g.moveTo(x, padT); g.lineTo(x, H-padB);
      g.stroke();
      g.restore();

      const y = H - padB - 9*DPR;
      g.fillStyle = weatherColor(e.kind);
      g.beginPath();
      g.arc(x, y, 6*DPR, 0, Math.PI*2);
      g.fill();

      g.fillStyle = "rgba(15,23,42,.95)";
      g.font = `${10*DPR}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      g.textBaseline = "middle";
      g.fillText(weatherLabel(e.kind), x, y + 0.5*DPR);

      g.font = `${11*DPR}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      g.textBaseline = "top";
      g.fillStyle = chartColors.tick;
    }

    const cycLenM = getCycleLen();
    const firstCyc = Math.max(1, Math.ceil(minX / cycLenM));
    const lastCyc = Math.floor(maxX / cycLenM);

    // Deutlichere Zyklusmarkierung: alternierende Hintergründe + kräftigere Linien/Labels
    if (lastCyc >= firstCyc){
      // Alternierende Zyklus-Bänder
      const startBand = Math.max(0, Math.floor(minX / cycLenM));
      const endBand = Math.ceil(maxX / cycLenM);
      for (let bi = startBand; bi < endBand; bi++){
        const t0 = Math.max(minX, bi * cycLenM);
        const t1 = Math.min(maxX, (bi + 1) * cycLenM);
        if (t1 <= t0) continue;
        if (bi % 2 === 1){
          const x0b = xScale(t0);
          const x1b = xScale(t1);
          g.fillStyle = chartColors.band;
          g.fillRect(x0b, padT, Math.max(1, x1b - x0b), H - padT - padB);
        }
      }

      g.save();
      g.setLineDash([]);
      g.strokeStyle = chartColors.cycleLine;
      g.lineWidth = 1.4*DPR;
      g.font = `${10*DPR}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
      g.textAlign = "left";
      g.textBaseline = "top";

      for (let ci = firstCyc; ci <= lastCyc; ci++){
        const tt = ci * cycLenM;
        const x = xScale(tt);

        g.beginPath();
        g.moveTo(x, padT);
        g.lineTo(x, H-padB);
        g.stroke();

        const txt = `Z${ci}`;
        const tw = g.measureText(txt).width;
        const tx = x + 4*DPR;
        const ty = padT + 2*DPR;
        g.fillStyle = chartColors.cycleLabelBg;
        g.fillRect(tx - 2*DPR, ty - 1*DPR, tw + 4*DPR, 12*DPR);
        g.fillStyle = chartColors.cycleLabel;
        g.fillText(txt, tx, ty);
      }
      g.restore();
    }

    // Spawn-Legende (F/W) entfernt; Marker werden als Icons im Graphen dargestellt.





    const drawLine = (key, stroke)=>{
      g.strokeStyle = stroke;
      g.lineWidth = 2.2*DPR;
      g.beginPath();
      for (let i=0;i<hist.length;i++){
        const x = xScale(hist[i].t);
        const y = yScale(hist[i][key]);
        if (i===0) g.moveTo(x,y); else g.lineTo(x,y);
      }
      g.stroke();
    };

    drawLine("red","rgba(239,68,68,.90)");
    drawLine("pur","rgba(168,85,247,.90)");

    // Spawn-Icons DIREKT im Graphen (Zeit = x, Echsenzahl im betroffenen Habitat = y)
    // Wichtig: nach den Linien zeichnen, damit sie nicht vom Graphen übermalt werden.
    if (visibleSpawnEvents && visibleSpawnEvents.length){
      g.save();
      g.textAlign = "center";
      g.textBaseline = "middle";

      for (const {e:ev} of visibleSpawnEvents){
        const kind = ev.kind;
        const isFox = (kind === "foxSpawn");

        // Y-Wert direkt aus dem beim Spawn aufgezeichneten Populationsstand nehmen.
        // Fallback nur für alte Dateien/Events ohne popRed/popPur.
        let v = isFox ? Number(ev.popRed) : Number(ev.popPur);
        if (!Number.isFinite(v)){
          const key = isFox ? "red" : "pur";
          v = sampleSeriesAt(key, ev.t);
        }

        // Exakte Markerposition: x = Spawn-Zeit, y = Echsenzahl im jeweiligen Habitat zum Spawnzeitpunkt
        // (nicht aus einer vorab geclamp-ten Hilfsposition übernehmen).
        const xLine = xScale(ev.t);
        const x = Math.max(padL + 4*DPR, Math.min(W - padR - 4*DPR, xLine));

        const yLine = yScale(v);
        const y = Math.max(padT + 6*DPR, Math.min(H - padB - 6*DPR, yLine));

        const iconAsset = getPredatorSpawnIconAsset(kind);
        const iconReady = !!(useSpawnImageIcons && iconAsset && iconAsset.ready && iconAsset.img && iconAsset.img.complete && iconAsset.img.naturalWidth > 0);

        if (iconReady){
          const trim = (iconAsset && iconAsset.trim) ? iconAsset.trim : null;
          const iw = trim ? (trim.sw || 1) : (iconAsset.img.naturalWidth || 1);
          const ih = trim ? (trim.sh || 1) : (iconAsset.img.naturalHeight || 1);

          // Icon-Hotspot auf den Linienpunkt legen (unten mittig statt Zentrum)
          const targetH = 16*DPR;
          const targetW = Math.max(12*DPR, targetH * (iw / ih));
          const anchorX = 0.5;
          // etwas oberhalb des unteren Randes, damit Füße/Unterkante auf dem Graphen sitzen
          const anchorY = isFox ? 0.86 : 0.84;
          const dx = x - targetW * anchorX;
          const dy = y - targetH * anchorY;

          if (trim){
            g.drawImage(iconAsset.img, trim.sx, trim.sy, trim.sw, trim.sh, dx, dy, targetW, targetH);
          } else {
            g.drawImage(iconAsset.img, dx, dy, targetW, targetH);
          }
        } else {
          g.fillStyle = isFox ? "rgba(251,146,60,.98)" : "rgba(56,189,248,.98)";
          g.font = `${10.5*DPR}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
          g.fillText(isFox ? "◆" : "●", x, y);
        }

        if (((ev.count|0) || 1) > 1){
          const txt = String(ev.count);
          g.font = `${8*DPR}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
          g.fillStyle = chartColors.spawnCount;
          g.fillText(txt, x + 12*DPR, y - 8*DPR);
        }
      }
      g.restore();
    }
  }

  function drawPopulationChartFullForExport(opts={}){
    if (!chartHiddenPopulation) return;
    const histFull = (state.historyAll && state.historyAll.length) ? state.historyAll : state.history;
    const evFull = (state.eventsAll && state.eventsAll.length) ? state.eventsAll : state.events;
    const useSpawnImageIcons = !(opts && opts.useSpawnImageIcons === false);
    drawLineChartCore(chartHiddenPopulation, histFull, evFull, { useSpawnImageIcons, theme:"light" });
  }

  function drawLineChart(){
    const c = document.getElementById("chartLine");
    drawLineChartCore(c, state.history, state.events, { useSpawnImageIcons:true, theme:"light" });
  }


  // Physische Zonenzugehörigkeit (unabhängig vom Habitat-Label des Agenten)
  function inZoneMask(zoneName, x, y){
    const z = activeZone();
    const xx = clamp(x,0,z.w-1), yy=clamp(y,0,z.h-1);
    if (z.fullHabitat) return true;

    if (z._maskReady){
      const m = (zoneName==="red") ? z.redMask : (z.sharedHabitat ? z.redMask : z.purpleMask);
      if (m && m.data){
        const cx = clamp((xx / m.cell) | 0, 0, m.gw-1);
        const cy = clamp((yy / m.cell) | 0, 0, m.gh-1);
        return !!m.data[cy*m.gw + cx];
      }
    }

    if (zoneName==="red") return inAnyPoly(xx,yy,z.redPolys);
    if (z.sharedHabitat) return inAnyPoly(xx,yy,z.redPolys);
    return inAnyPoly(xx,yy,z.purplePolys);
  }

  
function countTypesInZones(){
  const out = {};
  for (const t of LIZARD_GIFS) out[t] = {red:0, purple:0};

  for (const a of state.agents){
    if (!a || !a.alive || a.kind!=="lizard") continue;
    const m = a.morph;
    if (!out[m]) continue;

    const inR = inZoneMask("red", a.x, a.y);
    const inP = inZoneMask("purple", a.x, a.y);

    if (inR && !inP) out[m].red++;
    else if (inP && !inR) out[m].purple++;
    else if (inR && inP){
      // seltene Überlappung: anhand Habitat-Label zuordnen
      if (a.habitat === "red") out[m].red++;
      else out[m].purple++;
    }
  }
  return out;
}


function fitText(ctx, text, maxW){
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(t + "…").width > maxW){
    t = t.slice(0, -1);
  }
  return (t.length < text.length) ? (t + "…") : t;
}

function drawZoneTypeBarsHorizontal(canvasId, zoneKey, counts){
  const c = document.getElementById(canvasId);
  if (!c) return;
  const g = c.getContext("2d");
  const W = c.width, H = c.height;
  const DPR = devicePixelRatio || 1;

  g.clearRect(0,0,W,H);
  g.fillStyle = "#ffffff";
  g.fillRect(0,0,W,H);

  const types = LIZARD_GIFS.slice();
  const rows = types.map(t => ({ type: t, v: (counts?.[t]?.[zoneKey]) || 0 }));
  const maxV = Math.max(1, ...rows.map(r => r.v));
  const total = rows.reduce((s,r)=>s+r.v,0);

  const padL = Math.min(108*DPR, Math.floor(W * 0.36));
  const padR = Math.max(12*DPR, Math.ceil(W * 0.14));
  const padT = 10*DPR;
  const padB = 8*DPR;

  g.fillStyle = "#000000";
  g.font = `${10*DPR}px Arial, Helvetica, sans-serif`;
  g.textBaseline = "top";
  g.textAlign = "left";
  g.fillText(`Gesamtzahl = ${total}`, 10*DPR, 6*DPR);

  const innerX0 = padL;
  const innerY0 = padT + 10*DPR;
  const innerW = W - padL - padR;
  const innerH = Math.max(2*DPR, H - innerY0 - padB);

  const n = rows.length;
  const rowH = innerH / Math.max(1,n);
  const barH = Math.max(2*DPR, Math.min(rowH * 0.55, 14*DPR, rowH - 2*DPR));

  g.strokeStyle = "rgba(148,163,184,.40)";
  g.lineWidth = 1*DPR;
  g.beginPath();
  g.moveTo(innerX0, innerY0);
  g.lineTo(innerX0, innerY0 + innerH);
  g.moveTo(innerX0 + innerW, innerY0);
  g.lineTo(innerX0 + innerW, innerY0 + innerH);
  g.stroke();

  g.fillStyle = "#000000";
  g.font = `${9*DPR}px Arial, Helvetica, sans-serif`;
  g.textAlign = "right";
  g.textBaseline = "top";
  g.fillText(String(maxV), innerX0 + innerW, innerY0 - 12*DPR);

  for (let i=0;i<n;i++){
    const r = rows[i];
    const cy = innerY0 + i*rowH + rowH/2;
    const y = cy - barH/2;

    g.fillStyle = "#000000";
    g.font = `${9*DPR}px Arial, Helvetica, sans-serif`;
    g.textAlign = "right";
    g.textBaseline = "middle";
    const lab = fitText(g, LIZARD_LABEL[r.type] || r.type, padL - 20*DPR);
    g.fillText(lab, innerX0 - 10*DPR, cy);

    const bw = (r.v / maxV) * innerW;
    g.fillStyle = LIZARD_COLOR[r.type] || (zoneKey === "red" ? "rgba(239,68,68,.85)" : "rgba(168,85,247,.85)");
    g.fillRect(innerX0, y, bw, barH);

    if (r.v > 0){
    g.fillStyle = "#000000";
      g.font = `${9*DPR}px Arial, Helvetica, sans-serif`;
      g.textAlign = "left";
      g.textBaseline = "middle";
      const tx = innerX0 + bw + 6*DPR;
      g.fillText(String(r.v), Math.min(tx, W - 10*DPR), cy);
    }
  }
}

function drawZoneTypesCharts(){
  const counts = countTypesInZones();
  drawZoneTypeBarsHorizontal("chartZoneTypesRed", "red", counts);
  drawZoneTypeBarsHorizontal("chartZoneTypesPurple", "purple", counts);
}


function drawAllCharts(){
    resizeCharts();
    drawLineChart();
    drawZoneTypesCharts();
    }

function safeDrawAllCharts(){
  try { drawAllCharts(); }
  catch(e){
    console.error(e);
    setStatus("Fehler");
    const el = document.getElementById("kHint");
    if (el) el.textContent = (e && e.message) ? e.message : String(e);
  }
}


// --- Effects / Morph ---

  // Feuer: kleines Patch (5x kleiner) in der lila Zone
  function getPurpleCenterWorld(){
    const z = activeZone();
    if (!z) return {x:0, y:0};
    const c = z.sharedHabitat ? z.redCenter : z.purpleCenter;
    if (c && Number.isFinite(c.x) && Number.isFinite(c.y)) return c;
    return {x:(z.w-1)/2, y:(z.h-1)/2};
  }

  function clearFirePatch(){
    if (!firePatchLayer) return;
    firePatchLayer.innerHTML = "";
  }

  // Feuer-Patches: 5 kleine GIFs an verschiedenen Stellen in der lila Zone
  const FIRE_PATCH_COUNT = 10;
  const FIRE_PATCH_MIN_DIST = 260; // world px – sorgt für räumliche Streuung

  function ensureFirePatches(n){
    if (!firePatchLayer) return [];
    let imgs = Array.from(firePatchLayer.querySelectorAll("img.firePatch"));
    while (imgs.length < n){
      const img = document.createElement("img");
      img.className = "firePatch";
      img.alt = "Feuer";
      img.src = "GIFs/Feuer.gif";
      firePatchLayer.appendChild(img);
      imgs.push(img);
    }
    while (imgs.length > n){
      const last = imgs.pop();
      if (last) last.remove();
    }
    return imgs;
  }

  function pickFirePatchPoints(n = FIRE_PATCH_COUNT){
    const z = state.zone;
    const samples = (z && z.purpleSamples && z.purpleSamples.length) ? z.purpleSamples : null;
    const pts = [];

    if (samples){
      const minD2 = FIRE_PATCH_MIN_DIST * FIRE_PATCH_MIN_DIST;
      for (let t=0; t<5000 && pts.length<n; t++){
        const s = samples[(Math.random() * samples.length) | 0];
        const x = s[0], y = s[1];
        let ok = true;
        for (const p of pts){
          const dx = x - p.x, dy = y - p.y;
          if (dx*dx + dy*dy < minD2){ ok = false; break; }
        }
        if (ok) pts.push({x, y});
      }
      while (pts.length < n){
        const s = samples[(Math.random() * samples.length) | 0];
        pts.push({x:s[0], y:s[1]});
      }
      return pts;
    }

    // Fallback (sollte selten passieren): rund um das lila Zentrum
    const c = getPurpleCenterWorld();
    for (let i=0;i<n;i++){
      pts.push({
        x: c.x + (Math.random()*2-1)*160,
        y: c.y + (Math.random()*2-1)*160
      });
    }
    return pts;
  }

  function placeFirePatches(points){
    const imgs = ensureFirePatches(points.length);
    points.forEach((pt, i)=>{
      const img = imgs[i];
      img.dataset.wx = pt.x;
      img.dataset.wy = pt.y;
      const p = worldToScreenScaled(pt.x, pt.y, state.scaleX, state.scaleY);
      img.style.left = `${p.sx}px`;
      img.style.top  = `${p.sy}px`;
    });
    return imgs;
  }

  function updateFirePatchPosition(){
    if (!firePatchLayer || firePatchLayer.style.display === "none") return;
    const imgs = firePatchLayer.querySelectorAll("img.firePatch");
    imgs.forEach((img)=>{
      const wx = parseFloat(img.dataset.wx);
      const wy = parseFloat(img.dataset.wy);
      if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
      const p = worldToScreenScaled(wx, wy, state.scaleX, state.scaleY);
      img.style.left = `${p.sx}px`;
      img.style.top  = `${p.sy}px`;
    });
  }

  function restartGif(imgEl){
    imgEl.src = imgEl.src.split("?")[0] + `?t=${Date.now()}`;
  }
  function resetLizardDistanceTracker(){
    state.weatherFxCompletedCount = 0;
    state.lizardDistanceTrackActive = false;
    state.lizardDist = { red:{day:0, night:0}, purple:{day:0, night:0} };
  }

  const DIST_PX_PER_METER = 10; // Modellmaßstab für Anzeige
  function formatDistPx(v){
    const px = Math.max(0, Number(v) || 0);
    const m = px / DIST_PX_PER_METER;
    const rounded = (m < 100) ? Math.round(m * 10) / 10 : Math.round(m);
    return `${rounded.toLocaleString('de-DE')} m`;
  }

  function completeWeatherEffect(kind){
    if (kind!=='rain' && kind!=='storm' && kind!=='fire') return;
    state.weatherFxCompletedCount = (state.weatherFxCompletedCount || 0) + 1;
    if (!state.lizardDistanceTrackActive && state.weatherFxCompletedCount >= 2){
      state.lizardDistanceTrackActive = true;
      state.lizardDist = { red:{day:0, night:0}, purple:{day:0, night:0} };
      setStatus('Distanz-Tracking aktiv');
    }
  }

  function recordPendingPredatorSpawnMarkers(){
    // Marker bei JÄGER-AKTIVIERUNG (Rising Edge):
    // - Wiesel bei Tag
    // - Fuchs bei Nacht
    // Dies passiert bei jedem Wechsel in die aktive Phase, nicht nur beim ersten Mal.
    let foxN = 0, weaselN = 0;
    for (const p of (state.agents || [])){
      if (!p || !p.alive || p.kind !== "pred") continue;
      const activeNow = (p.predatorType === "weasel") ? state.day : !state.day;
      const wasActive = !!p._spawnMarkerWasActive;
      if (activeNow && !wasActive){
        if (p.predatorType === "fox") foxN++;
        else if (p.predatorType === "weasel") weaselN++;
      }
      p._spawnMarkerWasActive = activeNow;
      // Legacy-Flag aus älteren Patches deaktivieren, damit keine Doppelmarker entstehen.
      if (p.spawnMarkerPending) p.spawnMarkerPending = false;
    }
    // Mehrfach aufrufen -> recordEvent() merged Batch-Events automatisch (count)
    for (let i=0; i<foxN; i++) recordEvent("foxSpawn");
    for (let i=0; i<weaselN; i++) recordEvent("weaselSpawn");
  }


  function recordEvent(kind){
    if (!state.events) state.events = [];
    if (!state.eventsAll) state.eventsAll = [];

    // Spawn-Events, die im selben Tick / quasi zeitgleich auftreten (z.B. Batch-Spawn von 6 Füchsen),
    // werden zusammengefasst und mit count gespeichert. So bleiben Tracking + Markierung korrekt lesbar.
    const mergeWindow = 0.20; // s
    const canMerge = (kind === "foxSpawn" || kind === "weaselSpawn");

    // Für Spawnmarker die Populationshöhe direkt beim Spawn speichern (Zeit + Echsenzahl im Zielhabitat),
    // damit das Icon exakt auf dem gezeichneten Linienverlauf platziert werden kann.
    let popRed = null, popPur = null;
    if (canMerge){
      let r = 0, p = 0;
      for (const a of (state.agents || [])){
        if (!a || !a.alive || a.kind !== "lizard") continue;
        if (a.habitat === "red") r++;
        else if (a.habitat === "purple") p++;
      }
      popRed = r;
      popPur = p;
    }

    let merged = false;
    if (canMerge && state.eventsAll.length){
      const lastAll = state.eventsAll[state.eventsAll.length - 1];
      if (lastAll && lastAll.kind === kind && Math.abs((lastAll.t||0) - state.t) <= mergeWindow){
        lastAll.count = (lastAll.count || 1) + 1;
        // popRed/popPur des ersten Spawns im Batch beibehalten (Lizard-Zahl ändert sich durch Predator-Spawn nicht)
        merged = true;
      }
    }

    if (!merged){
      const ev = {t: state.t, kind, count:1};
      if (canMerge){
        ev.popRed = popRed;
        ev.popPur = popPur;
      }
      state.events.push(ev);
      state.eventsAll.push(ev);
    }

    // trim to chart window (when history exists)
    if (state.history && state.history.length){
      const minT = state.history[0].t - 2;
      while (state.events.length && state.events[0].t < minT) state.events.shift();
    } else if (state.events.length > 120){
      state.events.shift();
    }
  }

  function startEffect(kind){
    if (state.morphActive) return; // keine parallelen Ereignisse
    if (kind==="fire" && !(state.zone && state.zone.fireEnabled)) {
      setStatus("Feuer deaktiviert");
      return;
    }


    recordEvent(kind);
    // Overlays/Layers sauber zurücksetzen
    rainOverlay.style.display = "none";
    fireOverlay.style.display = "none"; // Legacy (nicht verwenden)
    if (firePatchLayer) firePatchLayer.style.display = "none";
    lightningOverlay.style.display = "none";
    clearTimeout(state.effectTimer);
    state.effectTimer = null;

    if (kind==="rain"){
      rainOverlay.style.display = "block";
      restartGif(rainOverlay);
    } else if (kind==="fire"){
      // Feuer als kleines Patch (5x kleiner) in der lila Zone
      if (firePatchLayer){
        firePatchLayer.style.display = "block";
        const pts = pickFirePatchPoints(FIRE_PATCH_COUNT);
        const imgs = placeFirePatches(pts);
        imgs.forEach(img=>restartGif(img));
      } else {
        // Fallback: altes Fullscreen-Overlay
        fireOverlay.style.display = "block";
        restartGif(fireOverlay);
      }
    }

    // Morph startet SOFORT und läuft synchron zum Effekt (5s)
    const target = (kind==="rain") ? "Hintergrund_Ueberschwemmung" : "Hintergrund_Verbrannt1";
    beginMorph(target, 5.0);

    if (kind==="rain" && state.mapName==="Hintergrund_Trocken"){
      beginFloodTransition(5.0);
    }

    state.effectTimer = setTimeout(()=>{
      if (kind==="rain"){
        rainOverlay.style.display = "none";
      } else if (kind==="fire"){
        if (firePatchLayer){
          firePatchLayer.style.display = "none";
          clearFirePatch();
        }
        fireOverlay.style.display = "none";
      }
      completeWeatherEffect(kind);
    }, 5000);
  }



  // Gewitter: spielt Regen + Blitze gleichzeitig (5s), ohne Morph/Transition
  function startStormEffect(){
    if (state.morphActive) return;

    // Overlays zurücksetzen
    rainOverlay.style.display = "none";
    fireOverlay.style.display = "none";
    if (firePatchLayer){ firePatchLayer.style.display = "none"; clearFirePatch(); }
    lightningOverlay.style.display = "none";
    clearTimeout(state.effectTimer);
    state.effectTimer = null;

    setStatus("Gewitter");


    recordEvent("storm");
    rainOverlay.style.display = "block";
    lightningOverlay.style.display = "block";
    restartGif(rainOverlay);
    restartGif(lightningOverlay);

    state.effectTimer = setTimeout(()=>{
      rainOverlay.style.display = "none";
      lightningOverlay.style.display = "none";
      completeWeatherEffect("storm");
    }, 5000);
  }

  function beginMorph(targetMap, durSec=5.0){
    if (state.morphActive) return;
    state.morphActive=true;
    state.morphFrom = state.bgImg;
    state.morphTo = null;
    state.morphT = 0;
    state.morphDur = durSec;
    state.morphTarget = targetMap;

    loadBackground(targetMap).then(img=>{
      state.morphTo = img;
    }).catch(()=>{
      state.morphActive=false;
    state.logicZone=null;
    state.transition=null;
    });
  }

  // Morph mit Fallback-Liste: versucht die Maps der Reihe nach zu laden (für abweichende Dateinamen).
  function beginMorphAny(targetMaps, durSec=5.0){
    if (state.morphActive) return;
    state.morphActive = true;
    state.morphFrom = state.bgImg;
    state.morphTo = null;
    state.morphT = 0;
    state.morphDur = durSec;
    state.morphTarget = null;

    let i = 0;
    const tryLoad = ()=>{
      const mapName = targetMaps[i];
      state.morphTarget = mapName;
      loadBackground(mapName).then(img=>{
        state.morphTo = img;
      }).catch(()=>{
        i++;
        if (i < targetMaps.length){
          tryLoad();
        } else {
          // kein Ziel ladbar -> Morph abbrechen
          state.morphActive = false;
          state.logicZone = null;
          state.transition = null;
        }
      });
    };
    tryLoad();
  }


  function updateMorph(dt){
    if (!state.morphActive) return;
    if (!state.morphTo) return;
    const dur = state.morphDur || 5.0;
    state.morphT += dt / dur; // läuft synchron zum Effekt-GIF
    if (state.morphT >= 1) {
      state.morphActive = false;

      const target = state.morphTarget;
      const isFlood = !!(state.transition && state.transition.kind==="rain" && state.transition.toMap===target);
      if (isFlood) purgeAmbientCrossers();

      setMap(target, {enforce: !isFlood}).then(()=>{
        if (isFlood) finalizeFloodTransition();
        setStatus("Morph abgeschlossen");
      }).catch(()=>{});
    }
  }

  function drawMorph(){
    const cw=simCanvas.width, ch=simCanvas.height;
    ctx.clearRect(0,0,cw,ch);
    if (!state.morphFrom || !state.morphTo) return;
    ctx.globalAlpha = 1;
    ctx.drawImage(state.morphFrom,0,0,cw,ch);
    ctx.globalAlpha = clamp(state.morphT,0,1);
    ctx.drawImage(state.morphTo,0,0,cw,ch);
    ctx.globalAlpha = 1;
  }

  // --- Main Loop ---

function tick(ts){
  if (!state.running) return;
  if (!state.lastFrame) state.lastFrame = ts;
  const dt = Math.min(0.05, (ts - state.lastFrame)/1000);
  state.lastFrame = ts;

  // Pause während Entscheidungs-Popup
  if (state.choiceOpen || state.rainIntroOpen){
    if (state.morphActive && state.morphTo) {
      drawMorph();
    } else {
      drawBackground();
      state.bgDirty = false;
    }
    updateSprites();
    requestAnimationFrame(tick);
    return;
  }

  // Benutzer-Pause: Simulation einfrieren (Zeit/Bewegung), Rendering bleibt aktiv
  if (state.paused){
    state.lastFrame = ts;
    if (state.morphActive && state.morphTo) {
      drawMorph();
    } else {
      drawBackground();
      state.bgDirty = false;
    }
    updateSprites();
    updateTopBar();
    requestAnimationFrame(tick);
    return;
  }



  state.t += dt;

  // day/night
  const phase = Math.floor(state.t / state.phaseLen);
  state.day = (phase % 2 === 0);
  applyZoneTimeTint();
  recordPendingPredatorSpawnMarkers();

  // Zyklus-Tracking (Tag+Nacht) + fester Story-Zeitplan
  const cycLen = getCycleLen();
  const cycNow = Math.floor(state.t / cycLen);
  if (cycNow > state.lastCycleIndex){
    while (state.lastCycleIndex < cycNow){
      state.lastCycleIndex++;
      state.cycleCount = state.lastCycleIndex;
      recordTypeHistory();
      timelineOnCycle();
    }
  }

  // Stage-Aktionen laufen nur, wenn kein Morph aktiv ist
  runTimelinePending();

  // ggf. wurde die Simulation beendet oder das Popup geöffnet
  if (!state.running) return;
  if (state.choiceOpen || state.rainIntroOpen){
    requestAnimationFrame(tick);
    return;
  }

  updateRhythmBar();
  updateTransition(dt);
  updateAmbientCrossers(dt);

  // Vorherige Positionen für Sprite-Rotation speichern
  for (const a of state.agents){
    if (!a || !a.alive) continue;
    a.prevX = a.x; a.prevY = a.y;
  }

  stepAgents(dt);
  reproduction(dt);
  updateMorph(dt);

  if (state.morphActive && state.morphTo) {
    drawMorph();
  } else {
    // Hintergrund in jedem Frame sichern (verhindert "schwarzen" Screen nach Layout-/CSS-Änderungen)
    drawBackground();
    state.bgDirty = false;
  }
  updateSprites();

  // KPIs + chart at 2 Hz
  if (Math.floor(state.t*2) !== Math.floor((state.t-dt)*2)) {
    updateViewScale();
    updateKPIs();
    pushHistory();
    safeDrawAllCharts();
    updateTopBar();
  }

  requestAnimationFrame(tick);
}

  function cancelActiveEffectsAndMigrations(){
    // Übergänge / Effekte abbrechen (damit activeZone nicht auf alten Restriktionen bleibt)
    state.logicZone = null;
    state.transition = null;

    // Morph / Overlay stoppen
    state.morphActive = false;
    state.morphFrom = null;
    state.morphTo = null;
    state.morphT = 0;
    state.morphTarget = null;

    rainOverlay.style.display = "none";
    fireOverlay.style.display = "none";
    lightningOverlay.style.display = "none";
    clearTimeout(state.effectTimer);
    state.effectTimer = null;

    // Migration sicher beenden (sonst ignorieren Echsen Zonen)
    for (const a of state.agents){
      if (!a || !a.alive) continue;
      if (a.kind==="lizard" && a.migrating){
        a.migrating = false;
        if (Number.isFinite(a.baseSpeed)) a.speed = a.baseSpeed;
        a.migrateUntil = null;
        a.target = null;
      }
      if (a.kind==="pred"){
        a.targetId = null;
        a.target = null;
        a.wander = null;
      }
    }
  }


  // --- UI ---
  document.getElementById("btnStart").addEventListener("click", async ()=>{
    try {
      if (state.running) return; // verhindert multiple RAF-Loops
      const btn = document.getElementById("btnStart");
      btn.disabled = true;
      const pBtn = document.getElementById("btnPause");
      if (pBtn){ pBtn.disabled = false; pBtn.textContent = "Pause"; }
      state.paused = false;
      // Vor dem ersten Start wichtige Karten/GIFs/Sprites puffern (Tablet/file://: verhindert verzögertes Laden).
      await runStartupPreloadWithProgress();

      if (!state.zone) await setMap("Hintergrund_Trocken");
      // Relevante Story-Hintergründe früh vorladen (insb. hilfreich auf Tablets / file://).
      preloadBackgrounds([
        "Hintergrund_Ueberschwemmung",
        "Hintergrund_Normal",
        "Hintergrund_Geroell2",
        "Hintergrund_Geroell3",
        "Hintergrund_Verbrannt1",
        "Hintergrund_Verbrannt2"
      ]);
      preloadPredatorAssets();
      
      // Story-Timeline zurücksetzen
      state.t = 0;
      state.lastCycleIndex = 0;
      state.cycleCount = 0;
      state.timelineStage = 0;
      state.timelineBranch = null;
      state.timelineChoiceCycle = 0;
      state.timelinePending = null;
      state.choiceOpen = false;
      state.rainIntroOpen = false;
    state.redLowFoxFreezeLatched = false;
    state.redLowFoxFreezeAt = null;
    state.redLowFoxFreezeIdCutoff = null;
    state.redLowFoxFrozenIds = new Set();
    state.purpleLowWeaselFreezeLatched = false;
    state.purpleLowWeaselFreezeAt = null;
    state.purpleLowWeaselFreezeIdCutoff = null;
    state.purpleLowWeaselFrozenIds = new Set();
      const cb = document.getElementById("choiceBackdrop");
      if (cb) cb.style.display = "none";
      closeRainIntroModal();
      closeEndRunModal();

      state.history=[];
      state.historyAll=[];
      state.events=[];
      state.eventsAll=[];
      resetLizardDistanceTracker();
      spawnInitial();
      // Sofort einen History-Punkt bei t=0 schreiben, damit Initial-Batch-Spawns im Populationsdiagramm
      // entlang des Graphen markiert werden können (nicht links abgeschnitten).
      pushHistory();
      safeDrawAllCharts();
      if (btnExportEnd) btnExportEnd.style.display = "none";
      if (btnDisplayEnd) btnDisplayEnd.style.display = "none";
      initTypeTracking();
      closeExportModal();
      hideInlineExportResult();
      state.running=true;
      state.lastFrame=0;
      setStatus("läuft");
      requestAnimationFrame(tick);
    } catch(e) {
      setStatus("Fehler");
      document.getElementById("kHint").textContent = e.message;
    }
  });

  // Pause / Weiter
  {
    const pBtn = document.getElementById("btnPause");
    if (pBtn){
      pBtn.addEventListener("click", ()=>{
        if (!state.running) return;
        state.paused = !state.paused;
        pBtn.textContent = state.paused ? "Weiter" : "Pause";
        setStatus(state.paused ? "pausiert" : "läuft");
      });
    }
  }



  document.getElementById("predCount").addEventListener("input", ()=>{ if (state.running) syncPredators(); });
document.getElementById("btnReset").addEventListener("click", async ()=>{
    state.running=false;
    state.paused=false;
    const pBtn = document.getElementById("btnPause");
    if (pBtn){ pBtn.disabled = true; pBtn.textContent = "Pause"; }
    // Timeline/Popup zurücksetzen
    state.timelinePending = null;
    state.timelineStage = 0;
    state.timelineBranch = null;
    state.timelineChoiceCycle = 0;
    state.lastCycleIndex = 0;
    state.cycleCount = 0;
    state.choiceOpen = false;
    state.rainIntroOpen = false;
    const cb = document.getElementById("choiceBackdrop");
    if (cb) cb.style.display = "none";
    closeRainIntroModal();
    closeEndRunModal();
    const sBtn = document.getElementById("choiceStormBtn");
    const fBtn = document.getElementById("choiceFireBtn");
    if (sBtn) sBtn.disabled = false;
    if (fBtn) fBtn.disabled = false;

    cancelActiveEffectsAndMigrations();
    document.getElementById("btnStart").disabled = false;
    clearAgents();
    state.history=[];
    state.historyAll=[];
    state.events=[];
    state.eventsAll=[];
    resetLizardDistanceTracker();
    state.typeHistoryRed = [];
    state.typeHistoryPurple = [];
    if (btnExportEnd) btnExportEnd.style.display = "none";
      if (btnDisplayEnd) btnDisplayEnd.style.display = "none";
    closeExportModal();
    hideInlineExportResult();
    safeDrawAllCharts();
    rainOverlay.style.display="none";
    fireOverlay.style.display="none";
    lightningOverlay.style.display="none";
    clearTimeout(state.effectTimer);
    state.effectTimer=null;
    state.morphActive=false;
    state.t=0; state.lastFrame=0;
    await setMap("Hintergrund_Trocken");
    setStatus("bereit");
    updateKPIs();
    updateTopBar();
  });

  // init
  (async ()=>{
    resize();
    await setMap("Hintergrund_Trocken");
    preloadPredatorAssets();
    drawBackground();
    resetLizardDistanceTracker();
    updateKPIs();
        safeDrawAllCharts();
updateTopBar();
    setStatus("bereit");
    openIntroModal();
  })();


/* UI-Ergaenzungen: Quellenmodal und Tablet-spezifische Platzierung. */
/* Dekorative Leaf-Frames entfernt. */

// Quellenmodal: Eventbindung im Script statt Inline-Handler; Escape und Backdrop bleiben erhalten.
  (function(){
    function setSourcesModal(open){
      var m = document.getElementById('quellenModal');
      if (!m) return;
      m.style.display = open ? 'flex' : 'none';
      m.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    document.addEventListener('DOMContentLoaded', function(){
      var btn = document.getElementById('quellenBtn');
      var modal = document.getElementById('quellenModal');
      var close = document.getElementById('quellenModalClose');
      if (btn) btn.addEventListener('click', function(){ setSourcesModal(true); });
      if (close) close.addEventListener('click', function(){ setSourcesModal(false); });
      if (modal) modal.addEventListener('click', function(e){ if (e.target === modal) setSourcesModal(false); });
    });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') setSourcesModal(false);
    });
  })();

/* Tablet-only: Steuerbuttons in die linke Diagrammspalte verschieben */
(() => {
  const tabletQuery = window.matchMedia('(max-width: 1450px) and (min-width: 761px)');
  const mobileLandscapeQuery = window.matchMedia('(max-width: 900px) and (orientation: landscape)');
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  if (!leftPanel || !rightPanel) return;

  const buttonRow = leftPanel.querySelector('.row.mt-2px');
  const exportButton = document.getElementById('btnExportEnd');
  if (!buttonRow) return;

  const originalMarker = document.createComment('tablet-controls-marker');
  if (buttonRow.parentNode === leftPanel) {
    leftPanel.insertBefore(originalMarker, buttonRow);
  }

  let tabletHost = document.getElementById('tabletControlsHost');
  if (!tabletHost) {
    tabletHost = document.createElement('div');
    tabletHost.id = 'tabletControlsHost';
  }

  const syncTabletControlsPlacement = () => {
    if (tabletQuery.matches && !mobileLandscapeQuery.matches) {
      if (tabletHost.parentNode !== rightPanel) {
        rightPanel.insertBefore(tabletHost, rightPanel.firstChild);
      }
      if (buttonRow.parentNode !== tabletHost) {
        tabletHost.appendChild(buttonRow);
      }
    } else {
      if (buttonRow.parentNode !== leftPanel) {
        if (originalMarker.parentNode === leftPanel) {
          leftPanel.insertBefore(buttonRow, originalMarker.nextSibling);
        } else if (exportButton && exportButton.parentNode === leftPanel) {
          leftPanel.insertBefore(buttonRow, exportButton);
        } else {
          leftPanel.insertBefore(buttonRow, leftPanel.firstChild);
        }
      }
      if (tabletHost.parentNode === rightPanel && !tabletHost.hasChildNodes()) {
        tabletHost.remove();
      }
    }
  };

  if (typeof tabletQuery.addEventListener === 'function') {
    tabletQuery.addEventListener('change', syncTabletControlsPlacement);
  } else if (typeof tabletQuery.addListener === 'function') {
    tabletQuery.addListener(syncTabletControlsPlacement);
  }
  window.addEventListener('resize', syncTabletControlsPlacement, { passive: true });
  if (typeof mobileLandscapeQuery.addEventListener === 'function') {
    mobileLandscapeQuery.addEventListener('change', syncTabletControlsPlacement);
  } else if (typeof mobileLandscapeQuery.addListener === 'function') {
    mobileLandscapeQuery.addListener(syncTabletControlsPlacement);
  }
  syncTabletControlsPlacement();
})();

/* Tablet-only: Anzeige-Felder initial einklappen und bei Rueckkehr in den Tabletmodus wieder schliessen. */
(() => {
  const tabletQuery = window.matchMedia('(max-width: 1450px) and (min-width: 901px)');
  const collapseTabletDetailsInitially = () => {
    if (!tabletQuery.matches) return;
    const displayStats = document.getElementById('optDisplayStats');
    const lizardDistance = document.getElementById('optLizardDistance');
    if (displayStats) displayStats.open = false;
    if (lizardDistance) lizardDistance.open = false;
  };
  if (typeof tabletQuery.addEventListener === 'function') {
    tabletQuery.addEventListener('change', collapseTabletDetailsInitially);
  } else if (typeof tabletQuery.addListener === 'function') {
    tabletQuery.addListener(collapseTabletDetailsInitially);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', collapseTabletDetailsInitially, { once: true });
  } else {
    collapseTabletDetailsInitially();
  }
  window.setTimeout(collapseTabletDetailsInitially, 80);
})();

/* Mobile-Landscape: alle Zusatzfenster initial einklappen, damit die Simulation maximal gross bleibt. */
(() => {
  const mobileLandscapeQuery = window.matchMedia('(max-width: 900px) and (orientation: landscape)');
  const leftPanel = document.getElementById('leftPanel');
  const rightPanel = document.getElementById('rightPanel');
  const chartsCol = rightPanel ? rightPanel.querySelector('.chartsCol') : null;
  const chartsMarker = document.createComment('mobile-landscape-charts-marker');
  if (chartsCol && chartsCol.parentNode) {
    chartsCol.parentNode.insertBefore(chartsMarker, chartsCol);
  }
  const collapsibleIds = [
    'optDisplayStats',
    'optLizardDistance'
  ];
  const chartIds = [
    'chartLine',
    'chartZoneTypesRed',
    'chartZoneTypesPurple'
  ];
  const getMobileLandscapeDetails = () => {
    const optionDetails = collapsibleIds
      .map((id) => document.getElementById(id))
      .filter(Boolean);
    const chartDetails = chartIds
      .map((id) => {
        const canvas = document.getElementById(id);
        return canvas ? canvas.closest('details') : null;
      })
      .filter(Boolean);
    return [...optionDetails, ...chartDetails];
  };

  const syncMobileLandscapeChartPlacement = () => {
    if (!leftPanel || !rightPanel || !chartsCol) return;
    if (mobileLandscapeQuery.matches) {
      if (chartsCol.parentNode !== leftPanel) {
        leftPanel.appendChild(chartsCol);
      }
    } else if (chartsCol.parentNode !== rightPanel) {
      if (chartsMarker.parentNode === rightPanel) {
        rightPanel.insertBefore(chartsCol, chartsMarker.nextSibling);
      } else {
        rightPanel.appendChild(chartsCol);
      }
    }
  };

  const updateMobileToggleCompression = () => {
    const anyOpen = mobileLandscapeQuery.matches && getMobileLandscapeDetails().some((details) => details.open);
    document.body.classList.toggle('mobile-toggle-active', anyOpen);
  };

  const syncMobileLandscapeDetails = () => {
    syncMobileLandscapeChartPlacement();
    const shouldCollapse = mobileLandscapeQuery.matches;
    getMobileLandscapeDetails().forEach((details) => {
      details.open = !shouldCollapse;
    });
    updateMobileToggleCompression();
  };

  const bindMobileLandscapeToggles = () => {
    getMobileLandscapeDetails().forEach((details) => {
      if (details.dataset.mobileLandscapeBound === 'true') return;
      details.dataset.mobileLandscapeBound = 'true';
      details.addEventListener('toggle', () => {
        if (!mobileLandscapeQuery.matches) {
          updateMobileToggleCompression();
          return;
        }
        if (details.open) {
          getMobileLandscapeDetails().forEach((other) => {
            if (other !== details) other.open = false;
          });
        }
        window.requestAnimationFrame(updateMobileToggleCompression);
      });
    });
  };

  if (typeof mobileLandscapeQuery.addEventListener === 'function') {
    mobileLandscapeQuery.addEventListener('change', syncMobileLandscapeDetails);
  } else if (typeof mobileLandscapeQuery.addListener === 'function') {
    mobileLandscapeQuery.addListener(syncMobileLandscapeDetails);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      bindMobileLandscapeToggles();
      syncMobileLandscapeDetails();
    }, { once: true });
  } else {
    bindMobileLandscapeToggles();
    syncMobileLandscapeDetails();
  }
})();

