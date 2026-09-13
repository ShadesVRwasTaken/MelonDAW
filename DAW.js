// ==========================================
// WINDOW 1: CORE ENGINE & RUNTIME STATE
// ==========================================

let audioCtx = null;
let trackCount = 0;
let isPlaying = false;
let currentSeconds = 0; 
let bpm = 120;
let playbackInterval = null;

const trackClips = {}; 
let activeClipRef = null; 
let currentSnapValue = 0.25;

// Global selection lists for Mass Operations
let selectedNoteIds = [];
let selectedClipIds = [];

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

        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
        const playheadPx = (currentBeatPosition / 4) * timelineZoomX;
        
        const playheadLine = document.getElementById('playhead-line');
        if (playheadLine) { playheadLine.style.display = 'block'; playheadLine.style.left = `${playheadPx}px`; }

        Object.keys(trackClips).forEach(trackId => {
            trackClips[trackId].forEach(clipObj => {
                const clipBeatOffset = clipObj.barStart * 4;
                const clipDurationBeats = clipObj.barDuration * 4;
                const triggerThreshold = timeResolutionMs / 1000 / secondsPerBeat;

                clipObj.notes.forEach(noteObj => {
                    // Check bounds to ignore notes cut off by a resized shorter bar length
                    if (noteObj.beatStart >= clipDurationBeats) return;

                    const absoluteNoteBeatPosition = clipBeatOffset + noteObj.beatStart;
                    if (currentBeatPosition >= absoluteNoteBeatPosition && currentBeatPosition < absoluteNoteBeatPosition + triggerThreshold) {
                        if (!noteObj.hasTriggered) {
                            noteObj.hasTriggered = true;
                            const freq = getFrequency(noteObj.note);
                            playTone(freq, Math.min(noteObj.duration, clipDurationBeats - noteObj.beatStart) * secondsPerBeat);
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
// WINDOW 2: RESIZABLE CLIPS & TIMELINE LASSO
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

    row.querySelector('.track-timeline').addEventListener('dblclick', function(e) {
        if (e.target !== this) return;
        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
        const targetBar = Math.floor(e.offsetX / timelineZoomX);
        createNewTimelineClip(trackId, targetBar, this);
    });

    listContainer.appendChild(row);
    setupTimelineLassoSelection();
}

function createNewTimelineClip(trackId, barStart, timelineTrackEl) {
    const clipId = `clip-${Date.now()}`;
    // barDuration tracking parameter defaults to 1 whole Bar
    const clipObj = { id: clipId, barStart: barStart, barDuration: 1, notes: [] };
    trackClips[trackId].push(clipObj);

    const clipEl = document.createElement('div');
    clipEl.className = 'timeline-clip';
    clipEl.id = clipId;
    clipEl.innerHTML = `
        <div class="clip-title">Pattern</div>
        <canvas class="clip-preview-canvas"></canvas>
        <div class="resize-handle"></div>
    `;

    updateClipVisualPlacement(clipEl, clipObj);
    timelineTrackEl.appendChild(clipEl);
    setupClipTimelineInteractions(clipEl, clipObj, trackId);
    
    clipEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        openPianoRoll(clipObj, trackId);
    });
}

function updateClipVisualPlacement(clipEl, clipObj) {
    const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
    clipEl.style.width = `${clipObj.barDuration * timelineZoomX}px`; 
    clipEl.style.left = `${clipObj.barStart * timelineZoomX}px`;
    renderClipPreviewMatrix(clipEl, clipObj);
}

function setupClipTimelineInteractions(clipEl, clipObj, trackId) {
    let isDragging = false, isResizing = false, startX, startLeft, startWidth;
    const timelineZoomX = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;

    clipEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); clipEl.setPointerCapture(e.pointerId);
        startX = e.clientX; startLeft = parseFloat(clipEl.style.left); startWidth = parseFloat(clipEl.style.width);
        
        if (e.target.classList.contains('resize-handle')) {
            isResizing = true;
        } else {
            isDragging = true;
            if (!selectedClipIds.includes(clipObj.id)) {
                selectedClipIds = [clipObj.id];
                document.querySelectorAll('.timeline-clip').forEach(c => c.classList.remove('selected'));
                clipEl.classList.add('selected');
            }
        }
    });

    clipEl.addEventListener('pointermove', (e) => {
        const deltaX = e.clientX - startX;
        if (isDragging) {
            clipEl.style.left = `${Math.max(0, startLeft + deltaX)}px`;
        }
        if (isResizing) {
            clipEl.style.width = `${Math.max(timelineZoomX() * 0.25, startWidth + deltaX)}px`;
        }
    });

    clipEl.addEventListener('pointerup', (e) => {
        clipEl.releasePointerCapture(e.pointerId);
        if (isDragging) {
            isDragging = false;
            clipObj.barStart = Math.round(parseFloat(clipEl.style.left) / timelineZoomX());
        }
        if (isResizing) {
            isResizing = false;
            // Snap pattern duration sizing to the nearest quarter bar chunk
            clipObj.barDuration = Math.max(0.25, Math.round((parseFloat(clipEl.style.width) / timelineZoomX()) * 4) / 4);
        }
        updateClipVisualPlacement(clipEl, clipObj);
    });

    clipEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); clipEl.remove();
        trackClips[trackId] = trackClips[trackId].filter(c => c.id !== clipObj.id);
        if (activeClipRef && activeClipRef.id === clipObj.id) document.getElementById('midi-editor').classList.add('hidden');
    });
}

// Global Timeline Lasso Rectangle Selector Node System
function setupTimelineLassoSelection() {
    const listContainer = document.getElementById('tracks-list');
    let marquee = document.getElementById('timeline-marquee');
    
    if (!marquee) {
        marquee = document.createElement('div'); marquee.className = 'selection-marquee'; marquee.id = 'timeline-marquee';
        listContainer.appendChild(marquee);
    }

    let isSelecting = false, startX, startY;

    listContainer.addEventListener('mousedown', (e) => {
        if (e.target.closest('.timeline-clip') || e.target.closest('.track-header')) return;
        isSelecting = true;
        const rect = listContainer.getBoundingClientRect();
        startX = e.clientX - rect.left + listContainer.scrollLeft;
        startY = e.clientY - rect.top + listContainer.scrollTop;
        
        marquee.style.left = `${startX}px`; marquee.style.top = `${startY}px`;
        marquee.style.width = '0px'; marquee.style.height = '0px'; marquee.style.display = 'block';

        selectedClipIds = [];
        document.querySelectorAll('.timeline-clip').forEach(c => c.classList.remove('selected'));
    });

    window.addEventListener('mousemove', (e) => {
        if (!isSelecting) return;
        const rect = listContainer.getBoundingClientRect();
        const currentX = e.clientX - rect.left + listContainer.scrollLeft;
        const currentY = e.clientY - rect.top + listContainer.scrollTop;

        const left = Math.min(startX, currentX), top = Math.min(startY, currentY);
        const width = Math.abs(startX - currentX), height = Math.abs(startY - currentY);

        marquee.style.left = `${left}px`; marquee.style.top = `${top}px`;
        marquee.style.width = `${width}px`; marquee.style.height = `${height}px`;

        // Mathematical rectangle collision detection tracking loop
        document.querySelectorAll('.timeline-clip').forEach(clipEl => {
            const cRect = {
                left: clipEl.offsetLeft, top: clipEl.offsetTop + clipEl.parentElement.offsetTop,
                right: clipEl.offsetLeft + clipEl.clientWidth, bottom: clipEl.offsetTop + clipEl.parentElement.offsetTop + clipEl.clientHeight
            };

            const overlaps = !(left > cRect.right || left + width < cRect.left || top > cRect.bottom || top + height < cRect.top);
            const clipId = clipEl.id;
            
            if (overlaps) {
                clipEl.classList.add('selected');
                if (!selectedClipIds.includes(clipId)) selectedClipIds.push(clipId);
            } else {
                clipEl.classList.remove('selected');
                selectedClipIds = selectedClipIds.filter(id => id !== clipId);
            }
        });
    });

    window.addEventListener('mouseup', () => { if (isSelecting) { isSelecting = false; marquee.style.display = 'none'; } });
}

// ==========================================================================
// WINDOW 3 - PART A: PIANO ROLL RENDERING & NOTE SPAWNING
// ==========================================================================

function renderClipPreviewMatrix(clipEl, clipObj) {
    const canvas = clipEl.querySelector('.clip-preview-canvas');
    if (!canvas) return; const ctx = canvas.getContext('2d');
    canvas.width = clipEl.clientWidth; canvas.height = clipEl.clientHeight - 12;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (clipObj.notes.length === 0) return;

    const noteIndices = clipObj.notes.map(n => ALL_NOTES.indexOf(n.note));
    const maxIdx = Math.max(...noteIndices), minIdx = Math.min(...noteIndices);
    const idxRange = (maxIdx - minIdx) || 4;

    ctx.fillStyle = '#ff9800';
    clipObj.notes.forEach(note => {
        const clipDurationBeats = clipObj.barDuration * 4;
        if (note.beatStart >= clipDurationBeats) return; 

        const xStart = (note.beatStart / clipDurationBeats) * canvas.width;
        const width = (note.duration / clipDurationBeats) * canvas.width;
        const yStart = ((ALL_NOTES.indexOf(note.note) - minIdx) / idxRange) * (canvas.height - 6);

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
    activeClipRef = clipObj; selectedNoteIds = [];
    document.getElementById('current-editing-track').innerText = `Pattern (Bar ${clipObj.barStart + 1})`;
    document.getElementById('midi-editor').classList.remove('hidden');

    const keysContainer = document.getElementById('piano-keys'); const gridContainer = document.getElementById('piano-grid');
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
            if (snappedBeat >= 0 && snappedBeat < (clipObj.barDuration * 4)) { createNewNote(noteName, snappedBeat, clipObj, trackId); }
        });
        gridContainer.appendChild(rowGrid);
    });

    clipObj.notes.forEach(noteObj => renderNoteElement(noteObj, trackId));
    setupMidiRollLassoSelection(gridContainer);
    
    setTimeout(() => {
        const c4Key = document.querySelector('.piano-key[data-note="C4"]');
        if (c4Key) c4Key.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
}

function createNewNote(noteName, beatStart, clipObj, trackId) {
    const noteId = `note-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const newNoteObj = { id: noteId, note: noteName, beatStart: beatStart, duration: currentSnapValue, hasTriggered: false };
    clipObj.notes.push(newNoteObj); renderNoteElement(newNoteObj, trackId); playTone(getFrequency(noteName), 0.2);
    const clipEl = document.getElementById(clipObj.id); if (clipEl) renderClipPreviewMatrix(clipEl, clipObj);
}

// ==========================================================================
// WINDOW 3 - PART B: NOTE DRAGS & MULTI-SELECTION ENGINE
// ==========================================================================

function renderNoteElement(noteObj, trackId) {
    const gridContainer = document.getElementById('piano-grid');
    const noteEl = document.createElement('div'); noteEl.className = 'piano-note'; noteEl.id = noteObj.id; noteEl.innerHTML = `<div class="resize-handle"></div>`;
    updateNoteStylePosition(noteEl, noteObj); gridContainer.appendChild(noteEl); setupNoteInteractions(noteEl, noteObj, trackId);
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
        
        if (e.target.classList.contains('resize-handle')) isResizing = true; 
        else { 
            isDragging = true; 
            if (!selectedNoteIds.includes(noteObj.id)) {
                selectedNoteIds = [noteObj.id];
                document.querySelectorAll('.piano-note').forEach(n => n.classList.remove('selected'));
                noteEl.classList.add('selected');
            }
        }
    });

    noteEl.addEventListener('pointermove', (e) => {
        if (!isDragging && !isResizing) return;
        const deltaX = e.clientX - startX;
        const maxLimitBeats = activeClipRef.barDuration * 4;

        if (isDragging) {
            let newLeft = Math.max(0, Math.min(startLeft + deltaX, (maxLimitBeats * cellWidth()) - parseFloat(noteEl.style.width)));
            noteEl.style.left = `${newLeft}px`; noteEl.style.top = `${Math.max(0, Math.min(startTop + e.clientY - startY, (ALL_NOTES.length - 1) * cellHeight()))}px`;
        }
        if (isResizing) {
            noteEl.style.width = `${Math.max(cellWidth() * currentSnapValue, Math.min(startWidth + deltaX, (maxLimitBeats * cellWidth()) - parseFloat(noteEl.style.left)))}px`;
        }
    });

    noteEl.addEventListener('pointerup', (e) => {
        if (!isDragging && !isResizing) return; let clipEl = document.getElementById(activeClipRef.id);
        noteEl.releasePointerCapture(e.pointerId);
        if (isDragging) {
            isDragging = false;
            noteObj.beatStart = Math.round((parseFloat(noteEl.style.left) / cellWidth()) / currentSnapValue) * currentSnapValue;
            noteObj.note = ALL_NOTES[Math.round(parseFloat(noteEl.style.top) / cellHeight())];
            playTone(getFrequency(noteObj.note), 0.2);
        }
        if (isResizing) { isResizing = false; noteObj.duration = Math.max(currentSnapValue, Math.round((parseFloat(noteEl.style.width) / cellWidth()) / currentSnapValue) * currentSnapValue); }
        updateNoteStylePosition(noteEl, noteObj); if (clipEl) renderClipPreviewMatrix(clipEl, activeClipRef);
    });

    noteEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); noteEl.remove(); let clipEl = document.getElementById(activeClipRef.id);
        activeClipRef.notes = activeClipRef.notes.filter(n => n.id !== noteObj.id);
        if (clipEl) renderClipPreviewMatrix(clipEl, activeClipRef);
    });
}

function setupMidiRollLassoSelection(gridContainer) {
    let marquee = document.getElementById('midi-marquee');
    if (!marquee) {
        marquee = document.createElement('div'); marquee.className = 'selection-marquee'; marquee.id = 'midi-marquee';
        gridContainer.appendChild(marquee);
    }
    let isSelecting = false, startX, startY;

    gridContainer.addEventListener('mousedown', (e) => {
        if (e.target.closest('.piano-note')) return;
        isSelecting = true;
        const rect = gridContainer.getBoundingClientRect();
        startX = e.clientX - rect.left + gridContainer.parentElement.scrollLeft;
        startY = e.clientY - rect.top + gridContainer.parentElement.scrollTop;

        marquee.style.left = `${startX}px`; marquee.style.top = `${startY}px`;
        marquee.style.width = '0px'; marquee.style.height = '0px'; marquee.style.display = 'block';

        selectedNoteIds = [];
        document.querySelectorAll('.piano-note').forEach(n => n.classList.remove('selected'));
    });

    window.addEventListener('mousemove', (e) => {
        if (!isSelecting) return;
        const rect = gridContainer.getBoundingClientRect();
        const currentX = e.clientX - rect.left + gridContainer.parentElement.scrollLeft;
        const currentY = e.clientY - rect.top + gridContainer.parentElement.scrollTop;

        const left = Math.min(startX, currentX), top = Math.min(startY, currentY);
        const width = Math.abs(startX - currentX), height = Math.abs(startY - currentY);

        marquee.style.left = `${left}px`; marquee.style.top = `${top}px`;
        marquee.style.width = `${width}px`; marquee.style.height = `${height}px`;

        document.querySelectorAll('.piano-note').forEach(noteEl => {
            const nRect = {
                left: noteEl.offsetLeft, top: noteEl.offsetTop,
                right: noteEl.offsetLeft + noteEl.clientWidth, bottom: noteEl.offsetTop + noteEl.clientHeight
            };
            const overlaps = !(left > nRect.right || left + width < nRect.left || top > nRect.bottom || top + height < nRect.top);
            
            if (overlaps) {
                noteEl.classList.add('selected');
                if (!selectedNoteIds.includes(noteEl.id)) selectedNoteIds.push(noteEl.id);
            } else {
                noteEl.classList.remove('selected');
                selectedNoteIds = selectedNoteIds.filter(id => id !== noteEl.id);
            }
        });
    });

    window.addEventListener('mouseup', () => { if (isSelecting) { isSelecting = false; marquee.style.display = 'none'; } });
}

document.getElementById('timeline-zoom-x').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--timeline-block-width', `${e.target.value}px`);
    Object.keys(trackClips).forEach(t => trackClips[t].forEach(c => { const el = document.getElementById(c.id); if (el) updateClipVisualPlacement(el, c); }));
});
document.getElementById('midi-zoom-x').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value); document.documentElement.style.setProperty('--midi-cell-width', `${val}px`); calculateAdaptiveSnapping(val);
    if (activeClipRef) refreshAllNoteElementsPositions();
});
document.getElementById('midi-zoom-y').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--midi-cell-height', `${e.target.value}px`); if (activeClipRef) refreshAllNoteElementsPositions();
});

function refreshAllNoteElementsPositions() { activeClipRef.notes.forEach(noteObj => { const el = document.getElementById(noteObj.id); if (el) updateNoteStylePosition(el, noteObj); }); }
document.getElementById('close-midi-btn').addEventListener('click', () => { document.getElementById('midi-editor').classList.add('hidden'); });
function deleteTrack(trackId) { document.getElementById(`row-${trackId}`).remove(); delete trackClips[trackId]; document.getElementById('midi-editor').classList.add('hidden'); }

generateTimelineRuler();
