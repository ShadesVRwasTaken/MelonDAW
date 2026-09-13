// ==========================================
// WINDOW 1: CORE ARCHITECTURE & TIMING ENGINES
// ==========================================

let audioCtx = null;
let trackCount = 0;
let isPlaying = false;
let currentSeconds = 0; 
let bpm = 120;
let playbackInterval = null;

// Track Database Mapping Structure
const trackClips = {}; // Format: { trackId: [ { id: "clip-1", barStart: 0, notes: [] } ] }
let activeClipRef = null; // Pointer register holds clip entity focus
let currentSnapValue = 0.25;

const NOTE_NAMES = ['B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C'];
const ALL_NOTES = [];
for (let octave = 8; octave >= 0; octave--) {
    NOTE_NAMES.forEach(note => { ALL_NOTES.push(`${note}${octave}`); });
}

function getFrequency(noteName) {
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const name = noteName.slice(0, -1);
    const octave = parseInt(noteName.slice(-1));
    const semitones = notes.indexOf(name) + (octave - 4) * 12;
    return 440 * Math.pow(2, (semitones - 9) / 12);
}

function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, duration) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function startTimelineLoop() {
    const timeResolutionMs = 25; 
    const startTime = Date.now() - (currentSeconds * 1000);

    playbackInterval = setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        currentSeconds = elapsedSec;
        const secondsPerBeat = 60 / bpm;
        const currentBeatPosition = elapsedSec / secondsPerBeat;

        // Render playhead coordinates tracking ticks
        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
        const playheadPx = (currentBeatPosition / 4) * timelineZoomX; // 4 beats = 1 timeline block bar width
        
        const playheadLine = document.getElementById('playhead-line');
        if (playheadLine) { playheadLine.style.display = 'block'; playheadLine.style.left = `${playheadPx}px`; }

        // Dynamic multi-clip timeline scanning logic
        Object.keys(trackClips).forEach(trackId => {
            trackClips[trackId].forEach(clipObj => {
                const clipBeatOffset = clipObj.barStart * 4; 
                const triggerThreshold = timeResolutionMs / 1000 / secondsPerBeat;

                clipObj.notes.forEach(noteObj => {
                    const absoluteNoteBeatPosition = clipBeatOffset + noteObj.beatStart;
                    if (currentBeatPosition >= absoluteNoteBeatPosition && currentBeatPosition < absoluteNoteBeatPosition + triggerThreshold) {
                        if (!noteObj.hasTriggered) {
                            noteObj.hasTriggered = true;
                            const freq = getFrequency(noteObj.note);
                            playTone(freq, noteObj.duration * secondsPerBeat);
                        }
                    } else {
                        noteObj.hasTriggered = false;
                    }
                });
            });
        });
    }, timeResolutionMs);
}

// ==========================================
// WINDOW 2: TIMELINE ARRANGEMENT & DRAG ENGINE
// ==========================================

document.getElementById('play-btn').addEventListener('click', () => {
    initAudio();
    if (!isPlaying) { isPlaying = true; startTimelineLoop(); document.getElementById('play-btn').innerText = "⏸ Pause"; } 
    else { clearInterval(playbackInterval); isPlaying = false; document.getElementById('play-btn').innerText = "▶ Play"; }
});

document.getElementById('stop-btn').addEventListener('click', () => {
    clearInterval(playbackInterval); isPlaying = false; currentSeconds = 0;
    document.getElementById('play-btn').innerText = "▶ Play";
    if (document.getElementById('playhead-line')) document.getElementById('playhead-line').style.display = 'none';
    Object.keys(trackClips).forEach(t => trackClips[t].forEach(c => c.notes.forEach(n => n.hasTriggered = false)));
});

document.getElementById('bpm-input').addEventListener('input', (e) => { bpm = parseInt(e.target.value) || 120; });

function generateTimelineRuler() {
    const ticksContainer = document.getElementById('ruler-ticks');
    ticksContainer.innerHTML = '<div id="playhead-line"></div>';
    for (let i = 1; i <= 64; i++) {
        const tick = document.createElement('div'); tick.className = 'tick'; tick.innerText = `Bar ${i}`;
        ticksContainer.appendChild(tick);
    }
}

document.getElementById('add-inst-btn').addEventListener('click', () => {
    trackCount++; const trackId = `track-${trackCount}`; trackClips[trackId] = [];
    createTimelineRow(trackId, `Instrument ${trackCount}`, 'instrument');
});
document.getElementById('add-audio-btn').addEventListener('click', () => {
    trackCount++; const trackId = `track-${trackCount}`; trackClips[trackId] = [];
    createTimelineRow(trackId, `Audio Sample ${trackCount}`, 'audio');
});

function createTimelineRow(trackId, trackName, type) {
    const listContainer = document.getElementById('tracks-list');
    const row = document.createElement('div'); row.className = `track-row ${type}-track`; row.id = `row-${trackId}`;

    row.innerHTML = `
        <div class="track-header">
            <span class="track-title">${trackName}</span>
            <div class="track-controls"><button onclick="deleteTrack('${trackId}')">🗑</button></div>
        </div>
        <div class="track-timeline" data-trackid="${trackId}"></div>
    `;

    // Double-click an empty row to paint an FL Studio style block bar clip
    row.querySelector('.track-timeline').addEventListener('dblclick', function(e) {
        if (e.target !== this) return; // Prevent double-clicks on clips inside
        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
        const targetBar = Math.floor(e.offsetX / timelineZoomX);
        createNewTimelineClip(trackId, targetBar, this);
    });

    listContainer.appendChild(row);
}

function createNewTimelineClip(trackId, barStart, timelineTrackEl) {
    const clipId = `clip-${Date.now()}`;
    const clipObj = { id: clipId, barStart: barStart, notes: [] };
    trackClips[trackId].push(clipObj);

    const clipEl = document.createElement('div');
    clipEl.className = 'timeline-clip';
    clipEl.id = clipId;
    clipEl.innerHTML = `
        <div class="clip-title">Pattern</div>
        <canvas class="clip-preview-canvas"></canvas>
    `;

    updateClipVisualPlacement(clipEl, clipObj);
    timelineTrackEl.appendChild(clipEl);
    setupClipTimelineDrag(clipEl, clipObj, trackId);
    
    // Double click the bar pattern clip to dive down into midi piano roll view
    clipEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openPianoRoll(clipObj, trackId);
    });
}

function updateClipVisualPlacement(clipEl, clipObj) {
    const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
    clipEl.style.width = `${timelineZoomX}px`; // Each clip defaults to exactly 1 complete Bar long
    clipEl.style.left = `${clipObj.barStart * timelineZoomX}px`;
    renderClipPreviewMatrix(clipEl, clipObj);
}

function setupClipTimelineDrag(clipEl, clipObj, trackId) {
    let isDragging = false, startX, startLeft;
    const timelineZoomX = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;

    clipEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); clipEl.setPointerCapture(e.pointerId);
        isDragging = true; startX = e.clientX; startLeft = parseFloat(clipEl.style.left);
        document.querySelectorAll('.timeline-clip').forEach(c => c.classList.remove('selected'));
        clipEl.classList.add('selected');
    });

    clipEl.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        let newLeft = Math.max(0, startLeft + (e.clientX - startX));
        clipEl.style.left = `${newLeft}px`;
    });

    clipEl.addEventListener('pointerup', (e) => {
        if (!isDragging) return; isDragging = false; clipEl.releasePointerCapture(e.pointerId);
        // Snaps structural position vector directly onto column bar ticks
        clipObj.barStart = Math.round(parseFloat(clipEl.style.left) / timelineZoomX());
        updateClipVisualPlacement(clipEl, clipObj);
    });

    clipEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); clipEl.remove();
        trackClips[trackId] = trackClips[trackId].filter(c => c.id !== clipObj.id);
        if (activeClipRef && activeClipRef.id === clipObj.id) document.getElementById('midi-editor').classList.add('hidden');
    });
}

// ==========================================
// WINDOW 3: NOTE CANVAS PREVIEW & PIANO ROLL
// ==========================================

function renderClipPreviewMatrix(clipEl, clipObj) {
    const canvas = clipEl.querySelector('.clip-preview-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    
    // Resize drawing canvas resolution dynamically to match rendering boundaries
    canvas.width = clipEl.clientWidth;
    canvas.height = clipEl.clientHeight - 12;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (clipObj.notes.length === 0) return;

    // Filter focus boundaries around active keys scale
    const noteIndices = clipObj.notes.map(n => ALL_NOTES.indexOf(n.note));
    const maxIdx = Math.max(...noteIndices), minIdx = Math.min(...noteIndices);
    const idxRange = (maxIdx - minIdx) || 4;

    ctx.fillStyle = '#ff9800';
    clipObj.notes.forEach(note => {
        const xStart = (note.beatStart / 4) * canvas.width;
        const width = (note.duration / 4) * canvas.width;
        
        const currentIdx = ALL_NOTES.indexOf(note.note);
        const yPercent = (currentIdx - minIdx) / idxRange;
        const yStart = yPercent * (canvas.height - 6);

        ctx.fillRect(xStart, yStart, Math.max(4, width), 4);
    });
}

function calculateAdaptiveSnapping(zoomWidth) {
    const indicator = document.getElementById('snap-value');
    if (zoomWidth < 150) { currentSnapValue = 1.0; document.documentElement.style.setProperty('--midi-subdivisions', '1'); if (indicator) indicator.innerText = "1/4 Note (1 Beat)"; } 
    else if (zoomWidth >= 150 && zoomWidth < 350) { currentSnapValue = 0.5; document.documentElement.style.setProperty('--midi-subdivisions', '2'); if (indicator) indicator.innerText = "1/8 Note"; } 
    else if (zoomWidth >= 350 && zoomWidth < 700) { currentSnapValue = 0.25; document.documentElement.style.setProperty('--midi-subdivisions', '4'); if (indicator) indicator.innerText = "1/16 Note"; } 
    else { currentSnapValue = 0.125; document.documentElement.style.setProperty('--midi-subdivisions', '8'); if (indicator) indicator.innerText = "1/32 Note"; }
}

function openPianoRoll(clipObj, trackId) {
    activeClipRef = clipObj;
    document.getElementById('current-editing-track').innerText = `Pattern (Bar ${clipObj.barStart + 1})`;
    document.getElementById('midi-editor').classList.remove('hidden');

    const keysContainer = document.getElementById('piano-keys');
    const gridContainer = document.getElementById('piano-grid');
    keysContainer.innerHTML = ''; gridContainer.innerHTML = '';

    calculateAdaptiveSnapping(parseFloat(document.getElementById('midi-zoom-x').value));

    ALL_NOTES.forEach(noteName => {
        const key = document.createElement('div'); key.className = `piano-key ${noteName.includes('#') ? 'black-key' : 'white-key'}`;
        key.innerText = noteName.endsWith('C') || noteName.includes('C') ? noteName : noteName.slice(0,2);
        key.dataset.note = noteName;
        key.addEventListener('click', () => { initAudio(); playTone(getFrequency(noteName), 0.2); });
        keysContainer.appendChild(key);

        const rowGrid = document.createElement('div'); rowGrid.className = 'grid-row'; rowGrid.dataset.note = noteName;
        rowGrid.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
            const snappedBeat = Math.round((e.offsetX / cellWidth) / currentSnapValue) * currentSnapValue;
            
            // Limit bounds inside exactly 1 pattern block sequence length boundary
            if (snappedBeat >= 0 && snappedBeat < 4) { createNewNote(noteName, snappedBeat, clipObj, trackId); }
        });
        gridContainer.appendChild(rowGrid);
    });

    clipObj.notes.forEach(noteObj => renderNoteElement(noteObj, trackId));
    setTimeout(() => {
        const c4Key = document.querySelector('.piano-key[data-note="C4"]');
        if (c4Key) c4Key.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
}

function createNewNote(noteName, beatStart, clipObj, trackId) {
    const noteId = `note-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const newNoteObj = { id: noteId, note: noteName, beatStart: beatStart, duration: currentSnapValue, hasTriggered: false };
    clipObj.notes.push(newNoteObj);
    renderNoteElement(newNoteObj, trackId);
    playTone(getFrequency(noteName), 0.2);
    
    // Updates parent pattern mini note canvas schematic previews dynamically
    const clipEl = document.getElementById(clipObj.id);
    if (clipEl) renderClipPreviewMatrix(clipEl, clipObj);
}

function renderNoteElement(noteObj, trackId) {
    const gridContainer = document.getElementById('piano-grid');
    const noteEl = document.createElement('div'); noteEl.className = 'piano-note'; noteEl.id = noteObj.id; noteEl.innerHTML = `<div class="resize-handle"></div>`;
    updateNoteStylePosition(noteEl, noteObj);
    gridContainer.appendChild(noteEl);
    setupNoteInteractions(noteEl, noteObj, trackId);
}

function updateNoteStylePosition(noteEl, noteObj) {
    let cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
    let cellHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-height')) || 24;
    noteEl.style.width = `${noteObj.duration * cellWidth}px`; noteEl.style.height = `${cellHeight - 2}px`;
    noteEl.style.left = `${noteObj.beatStart * cellWidth}px`; noteEl.style.top = `${ALL_NOTES.indexOf(noteObj.note) * cellHeight + 1}px`;
}

function setupNoteInteractions(noteEl, noteObj, trackId) {
    let isDragging = false, isResizing = false, startX, startY, startLeft, startTop, startWidth;
    const cellWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
    const cellHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-height')) || 24;

    noteEl.addEventListener('pointerdown', (e) => {
        initAudio(); e.stopPropagation(); noteEl.setPointerCapture(e.pointerId);
        startX = e.clientX; startY = e.clientY; startLeft = parseFloat(noteEl.style.left); startTop = parseFloat(noteEl.style.top); startWidth = parseFloat(noteEl.style.width);
        if (e.target.classList.contains('resize-handle')) isResizing = true; else { isDragging = true; noteEl.classList.add('dragging'); }
    });

    noteEl.addEventListener('pointermove', (e) => {
        if (!isDragging && !isResizing) return;
        const deltaX = e.clientX - startX;
        if (isDragging) {
            let newLeft = Math.max(0, Math.min(startLeft + deltaX, (4 * cellWidth()) - parseFloat(noteEl.style.width)));
            noteEl.style.left = `${newLeft}px`; noteEl.style.top = `${Math.max(0, Math.min(startTop + e.clientY - startY, (ALL_NOTES.length - 1) * cellHeight()))}px`;
        }
        if (isResizing) noteEl.style.width = `${Math.max(cellWidth() * currentSnapValue, Math.min(startWidth + deltaX, (4 * cellWidth()) - parseFloat(noteEl.style.left)))}px`;
    });

    noteEl.addEventListener('pointerup', (e) => {
        if (!isDragging && !isResizing) return; clipEl = document.getElementById(activeClipRef.id);
        noteEl.releasePointerCapture(e.pointerId);
        if (isDragging) {
            isDragging = false; noteEl.classList.remove('dragging');
            noteObj.beatStart = Math.round((parseFloat(noteEl.style.left) / cellWidth()) / currentSnapValue) * currentSnapValue;
            noteObj.note = ALL_NOTES[Math.round(parseFloat(noteEl.style.top) / cellHeight())];
            playTone(getFrequency(noteObj.note), 0.2);
        }
        if (isResizing) { isResizing = false; noteObj.duration = Math.max(currentSnapValue, Math.round((parseFloat(noteEl.style.width) / cellWidth()) / currentSnapValue) * currentSnapValue); }
        updateNoteStylePosition(noteEl, noteObj); if (clipEl) renderClipPreviewMatrix(clipEl, activeClipRef);
    });

    noteEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); noteEl.remove(); clipEl = document.getElementById(activeClipRef.id);
        activeClipRef.notes = activeClipRef.notes.filter(n => n.id !== noteObj.id);
        if (clipEl) renderClipPreviewMatrix(clipEl, activeClipRef);
    });
}

document.getElementById('timeline-zoom-x').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--timeline-block-width', `${e.target.value}px`);
    Object.keys(trackClips).forEach(t => trackClips[t].forEach(c => { const el = document.getElementById(c.id); if (el) updateClipVisualPlacement(el, c); }));
});
document.getElementById('midi-zoom-x').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value); document.documentElement.style.setProperty('--midi-cell-width', `${val}px`); calculateAdaptiveSnapping(val);
    if (activeClipRef) { refreshAllNoteElementsPositions(); }
});
document.getElementById('midi-zoom-y').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--midi-cell-height', `${e.target.value}px`); if (activeClipRef) refreshAllNoteElementsPositions();
});

function refreshAllNoteElementsPositions() { activeClipRef.notes.forEach(noteObj => { const el = document.getElementById(noteObj.id); if (el) updateNoteStylePosition(el, noteObj); }); }
document.getElementById('close-midi-btn').addEventListener('click', () => { document.getElementById('midi-editor').classList.add('hidden'); });
function deleteTrack(trackId) { document.getElementById(`row-${trackId}`).remove(); delete trackClips[trackId]; document.getElementById('midi-editor').classList.add('hidden'); }

generateTimelineRuler();
