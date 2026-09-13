// ==========================================================================
// WINDOW 1: CORE ENGINE STATE REGISTRIES & FREQUENCY ENGINES
// ==========================================================================
let audioCtx = null;
let trackCount = 0;
let isPlaying = false;
let currentSeconds = 0; 
let bpm = 120;
let playbackInterval = null;

const trackClips = {}; 
let activeClipRef = null; 
let currentSnapValue = 0.25;

let selectedNoteIds = [];
let selectedClipIds = [];
let noteClipboard = []; 

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

// ==========================================================================
// WINDOW 2: AUDIO SCHEDULING TRANSPORT & PANEL RESIZER DRIVER
// ==========================================================================
function startTimelineLoop() {
    const timeResolutionMs = 25; 
    const startTime = Date.now() - (currentSeconds * 1000) + 50; 

    playbackInterval = setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        currentSeconds = Math.max(0, elapsedSec);
        const secondsPerBeat = 60 / bpm;
        const currentBeatPosition = currentSeconds / secondsPerBeat;

        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
        const tPlayheadPx = (currentBeatPosition / 4) * timelineZoomX;
        const playheadLine = document.getElementById('playhead-line');
        if (playheadLine) { playheadLine.style.display = 'block'; playheadLine.style.left = `${tPlayheadPx}px`; }

        const midiZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
        const clipBeatOffset = activeClipRef ? activeClipRef.barStart * 4 : 0;
        const localMidiBeat = currentBeatPosition - clipBeatOffset;
        const mPlayheadPx = localMidiBeat * midiZoomX;
        
        const midiPlayheadLine = document.getElementById('midi-playhead-line');
        if (midiPlayheadLine && activeClipRef) {
            if (localMidiBeat >= 0 && localMidiBeat <= (activeClipRef.barDuration * 4)) {
                midiPlayheadLine.style.display = 'block'; midiPlayheadLine.style.left = `${mPlayheadPx}px`;
            } else { midiPlayheadLine.style.display = 'none'; }
        }

        Object.keys(trackClips).forEach(trackId => {
            trackClips[trackId].forEach(clipObj => {
                const innerBeatOffset = clipObj.barStart * 4;
                const clipDurationBeats = clipObj.barDuration * 4;
                const triggerThreshold = (timeResolutionMs + 15) / 1000 / secondsPerBeat;

                clipObj.notes.forEach(noteObj => {
                    if (noteObj.beatStart >= clipDurationBeats) return;
                    const absoluteNoteBeatPosition = innerBeatOffset + noteObj.beatStart;
                    if (currentBeatPosition >= absoluteNoteBeatPosition - 0.02 && currentBeatPosition < absoluteNoteBeatPosition + triggerThreshold) {
                        if (!noteObj.hasTriggered) {
                            noteObj.hasTriggered = true;
                            const freq = getFrequency(noteObj.note);
                            playTone(freq, Math.min(noteObj.duration, clipDurationBeats - noteObj.beatStart) * secondsPerBeat);
                        }
                    } else { noteObj.hasTriggered = false; }
                });
            });
        });
    }, timeResolutionMs);
}

function initWindowSplitterResizer() {
    const editorArea = document.querySelector('.editor-area');
    const timelineContainer = document.querySelector('.timeline-container');
    const midiEditor = document.getElementById('midi-editor');
    const resizer = document.createElement('div'); resizer.className = 'window-resizer';
    editorArea.insertBefore(resizer, midiEditor);

    let isResizing = false;
    resizer.addEventListener('pointerdown', (e) => { isResizing = true; resizer.classList.add('active-dragging'); resizer.setPointerCapture(e.pointerId); });
    resizer.addEventListener('pointermove', (e) => {
        if (!isResizing) return;
        const rect = editorArea.getBoundingClientRect();
        let percentageTimeline = ((e.clientY - rect.top) / rect.height) * 100;
        percentageTimeline = Math.max(15, Math.min(percentageTimeline, 80));
        timelineContainer.style.height = `${percentageTimeline}%`; midiEditor.style.height = `${100 - percentageTimeline}%`;
    });
    resizer.addEventListener('pointerup', (e) => { isResizing = false; resizer.classList.remove('active-dragging'); resizer.releasePointerCapture(e.pointerId); });
}

// ==========================================================================
// WINDOW 3: KEYBOARD SHORTCUT SYSTEMS & MAIN TRANSPORT CONTROLS
// ==========================================================================
window.addEventListener('keydown', (e) => {
    if (e.key === 'Backspace') {
        if (activeClipRef && selectedNoteIds.length > 0) {
            activeClipRef.notes = activeClipRef.notes.filter(note => {
                if (selectedNoteIds.includes(note.id)) {
                    const el = document.getElementById(note.id); if (el) el.remove(); return false;
                } return true;
            });
            selectedNoteIds = [];
            const clipEl = document.getElementById(activeClipRef.id); if (clipEl) renderClipPreviewMatrix(clipEl, activeClipRef);
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (activeClipRef && selectedNoteIds.length > 0) {
            const notesToCopy = activeClipRef.notes.filter(n => selectedNoteIds.includes(n.id));
            if (notesToCopy.length > 0) {
                const baseBeat = Math.min(...notesToCopy.map(n => n.beatStart));
                noteClipboard = notesToCopy.map(n => ({ note: n.note, beatOffset: n.beatStart - baseBeat, duration: n.duration }));
                e.preventDefault();
            }
        }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (activeClipRef && noteClipboard.length > 0) {
            e.preventDefault();
            const cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
            const midiPlayheadLine = document.getElementById('midi-playhead-line');
            let pasteStartBeat = 0;
            if (midiPlayheadLine && midiPlayheadLine.style.display !== 'none') { pasteStartBeat = parseFloat(midiPlayheadLine.style.left) / cellWidth; }
            
            document.querySelectorAll('.piano-note').forEach(n => n.classList.remove('selected')); selectedNoteIds = [];

            noteClipboard.forEach(clipData => {
                const targetedBeat = pasteStartBeat + clipData.beatOffset;
                if (targetedBeat >= 0 && targetedBeat < (activeClipRef.barDuration * 4)) {
                    const noteId = `note-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
                    const newNoteObj = { id: noteId, note: clipData.note, beatStart: targetedBeat, duration: clipData.duration, hasTriggered: false };
                    activeClipRef.notes.push(newNoteObj); renderNoteElement(newNoteObj, activeClipRef.id);
                    const noteEl = document.getElementById(noteId); if (noteEl) { noteEl.classList.add('selected'); selectedNoteIds.push(noteId); }
                }
            });
            const parentPatternEl = document.getElementById(activeClipRef.id); if (parentPatternEl) renderClipPreviewMatrix(parentPatternEl, activeClipRef);
        }
    }
});

document.getElementById('play-btn').addEventListener('click', async () => {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') await audioCtx.resume();
    if (!isPlaying) { isPlaying = true; document.getElementById('play-btn').innerText = "⏸ Pause"; startTimelineLoop(); } 
    else { clearInterval(playbackInterval); isPlaying = false; document.getElementById('play-btn').innerText = "▶ Play"; }
});

document.getElementById('stop-btn').addEventListener('click', () => {
    clearInterval(playbackInterval); isPlaying = false; currentSeconds = 0; document.getElementById('play-btn').innerText = "▶ Play";
    if (document.getElementById('playhead-line')) document.getElementById('playhead-line').style.display = 'none';
    if (document.getElementById('midi-playhead-line')) document.getElementById('midi-playhead-line').style.display = 'none';
    Object.keys(trackClips).forEach(t => trackClips[t].forEach(c => c.notes.forEach(n => n.hasTriggered = false)));
});

document.getElementById('bpm-input').addEventListener('input', (e) => { bpm = parseInt(e.target.value) || 120; });

// ==========================================================================
// WINDOW 4: ARRANGEMENT TRACK GENERATORS & RESIZABLE BAR CLIPS
// ==========================================================================
function generateTimelineRuler() {
    const ticksContainer = document.getElementById('ruler-ticks'); ticksContainer.innerHTML = '<div id="playhead-line"></div>';
    for (let i = 1; i <= 64; i++) {
        const tick = document.createElement('div'); tick.className = 'tick'; tick.innerText = `Bar ${i}`; ticksContainer.appendChild(tick);
    }
}

document.getElementById('add-inst-btn').addEventListener('click', () => { trackCount++; const trackId = `track-${trackCount}`; trackClips[trackId] = []; createTimelineRow(trackId, `Instrument ${trackCount}`, 'instrument'); });
document.getElementById('add-audio-btn').addEventListener('click', () => { trackCount++; const trackId = `track-${trackCount}`; trackClips[trackId] = []; createTimelineRow(trackId, `Audio Sample ${trackCount}`, 'audio'); });

function createTimelineRow(trackId, trackName, type) {
    const listContainer = document.getElementById('tracks-list');
    const row = document.createElement('div'); row.className = `track-row ${type}-track`; row.id = `row-${trackId}`;
    row.innerHTML = `
        <div class="track-header">
            <input type="text" class="track-title-input" value="${trackName}" title="Double click to rename">
            <div class="track-controls"><button onclick="deleteTrack('${trackId}')">🗑</button></div>
        </div>
        <div class="track-timeline" data-trackid="${trackId}"></div>
    `;
    row.querySelector('.track-timeline').addEventListener('dblclick', function(e) {
        if (e.target !== this) return;
        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
        const snapBeatResolution = timelineZoomX / 4;
        const snappedBeatStart = Math.floor(e.offsetX / snapBeatResolution) * 0.25;
        createNewTimelineClip(trackId, snappedBeatStart, this);
    });
    listContainer.appendChild(row);
}

function createNewTimelineClip(trackId, barStart, timelineTrackEl) {
    const clipId = `clip-${Date.now()}`; const clipObj = { id: clipId, barStart: barStart, barDuration: 1, notes: [] };
    trackClips[trackId].push(clipObj);
    const clipEl = document.createElement('div'); clipEl.className = 'timeline-clip'; clipEl.id = clipId;
    clipEl.innerHTML = `<div class="clip-title">Pattern</div><canvas class="clip-preview-canvas"></canvas><div class="resize-handle"></div>`;
    updateClipVisualPlacement(clipEl, clipObj); timelineTrackEl.appendChild(clipEl); setupClipTimelineInteractions(clipEl, clipObj, trackId);
    clipEl.addEventListener('dblclick', (e) => { e.stopPropagation(); openPianoRoll(clipObj, trackId); });
}

function updateClipVisualPlacement(clipEl, clipObj) {
    const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
    clipEl.style.width = `${clipObj.barDuration * timelineZoomX}px`; clipEl.style.left = `${clipObj.barStart * timelineZoomX}px`;
    renderClipPreviewMatrix(clipEl, clipObj);
}

function setupClipTimelineInteractions(clipEl, clipObj, trackId) {
    let isDragging = false, isResizing = false, startX, startLeft, startWidth;
    const timelineZoomX = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;

    clipEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); clipEl.setPointerCapture(e.pointerId); startX = e.clientX; startLeft = parseFloat(clipEl.style.left); startWidth = parseFloat(clipEl.style.width);
        if (e.target.classList.contains('resize-handle')) isResizing = true; 
        else { isDragging = true; selectedClipIds = [clipObj.id]; document.querySelectorAll('.timeline-clip').forEach(c => c.classList.remove('selected')); clipEl.classList.add('selected'); }
    });
    clipEl.addEventListener('pointermove', (e) => {
        const deltaX = e.clientX - startX;
        if (isDragging) clipEl.style.left = `${Math.max(0, startLeft + deltaX)}px`;
        if (isResizing) clipEl.style.width = `${Math.max(timelineZoomX() * 0.25, startWidth + deltaX)}px`;
    });
    clipEl.addEventListener('pointerup', (e) => {
        clipEl.releasePointerCapture(e.pointerId); const gridCellBeatWidth = timelineZoomX() / 4;
        if (isDragging) { isDragging = false; clipObj.barStart = Math.round(parseFloat(clipEl.style.left) / gridCellBeatWidth) * 0.25; }
        if (isResizing) { isResizing = false; clipObj.barDuration = Math.max(0.25, Math.round(parseFloat(clipEl.style.width) / gridCellBeatWidth) * 0.25); }
        updateClipVisualPlacement(clipEl, clipObj);
    });
    clipEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); clipEl.remove(); trackClips[trackId] = trackClips[trackId].filter(c => c.id !== clipObj.id);
        if (activeClipRef && activeClipRef.id === clipObj.id) document.getElementById('midi-editor').classList.add('hidden');
    });
}

// ==========================================================================
// WINDOW 4 - PART A: ARRANGEMENT TRACK GENERATORS & CLIPS SPAWNING
// ==========================================================================
function generateTimelineRuler() {
    const ticksContainer = document.getElementById('ruler-ticks'); ticksContainer.innerHTML = '<div id="playhead-line"></div>';
    for (let i = 1; i <= 64; i++) {
        const tick = document.createElement('div'); tick.className = 'tick'; tick.innerText = `Bar ${i}`; ticksContainer.appendChild(tick);
    }
}

document.getElementById('add-inst-btn').addEventListener('click', () => { trackCount++; const trackId = `track-${trackCount}`; trackClips[trackId] = []; createTimelineRow(trackId, `Instrument ${trackCount}`, 'instrument'); });
document.getElementById('add-audio-btn').addEventListener('click', () => { trackCount++; const trackId = `track-${trackCount}`; trackClips[trackId] = []; createTimelineRow(trackId, `Audio Sample ${trackCount}`, 'audio'); });

function createTimelineRow(trackId, trackName, type) {
    const listContainer = document.getElementById('tracks-list');
    const row = document.createElement('div'); row.className = `track-row ${type}-track`; row.id = `row-${trackId}`;
    row.innerHTML = `
        <div class="track-header">
            <input type="text" class="track-title-input" value="${trackName}" title="Double click to rename">
            <div class="track-controls"><button onclick="deleteTrack('${trackId}')">🗑</button></div>
        </div>
        <div class="track-timeline" data-trackid="${trackId}"></div>
    `;
    row.querySelector('.track-timeline').addEventListener('dblclick', function(e) {
        if (e.target !== this) return;
        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
        const snapBeatResolution = timelineZoomX / 4;
        const snappedBeatStart = Math.floor(e.offsetX / snapBeatResolution) * 0.25;
        createNewTimelineClip(trackId, snappedBeatStart, this);
    });
    listContainer.appendChild(row);
}

function createNewTimelineClip(trackId, barStart, timelineTrackEl) {
    const clipId = `clip-${Date.now()}`; const clipObj = { id: clipId, barStart: barStart, barDuration: 1, notes: [] };
    trackClips[trackId].push(clipObj);
    const clipEl = document.createElement('div'); clipEl.className = 'timeline-clip'; clipEl.id = clipId;
    clipEl.innerHTML = `<div class="clip-title">Pattern</div><canvas class="clip-preview-canvas"></canvas><div class="resize-handle"></div>`;
    updateClipVisualPlacement(clipEl, clipObj); timelineTrackEl.appendChild(clipEl); setupClipTimelineInteractions(clipEl, clipObj, trackId);
    clipEl.addEventListener('dblclick', (e) => { e.stopPropagation(); openPianoRoll(clipObj, trackId); });
}

// ==========================================================================
// WINDOW 4 - PART B: TIMELINE CLIP BEAT SNAPPING & RESIZING
// ==========================================================================
function updateClipVisualPlacement(clipEl, clipObj) {
    const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
    clipEl.style.width = `${clipObj.barDuration * timelineZoomX}px`; clipEl.style.left = `${clipObj.barStart * timelineZoomX}px`;
    renderClipPreviewMatrix(clipEl, clipObj);
}

function setupClipTimelineInteractions(clipEl, clipObj, trackId) {
    let isDragging = false, isResizing = false, startX, startLeft, startWidth;
    const timelineZoomX = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;

    clipEl.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); clipEl.setPointerCapture(e.pointerId); startX = e.clientX; startLeft = parseFloat(clipEl.style.left); startWidth = parseFloat(clipEl.style.width);
        if (e.target.classList.contains('resize-handle')) isResizing = true; 
        else { isDragging = true; selectedClipIds = [clipObj.id]; document.querySelectorAll('.timeline-clip').forEach(c => c.classList.remove('selected')); clipEl.classList.add('selected'); }
    });
    clipEl.addEventListener('pointermove', (e) => {
        const deltaX = e.clientX - startX;
        if (isDragging) clipEl.style.left = `${Math.max(0, startLeft + deltaX)}px`;
        if (isResizing) clipEl.style.width = `${Math.max(timelineZoomX() * 0.25, startWidth + deltaX)}px`;
    });
    clipEl.addEventListener('pointerup', (e) => {
        clipEl.releasePointerCapture(e.pointerId); const gridCellBeatWidth = timelineZoomX() / 4;
        if (isDragging) { isDragging = false; clipObj.barStart = Math.round(parseFloat(clipEl.style.left) / gridCellBeatWidth) * 0.25; }
        if (isResizing) { isResizing = false; clipObj.barDuration = Math.max(0.25, Math.round(parseFloat(clipEl.style.width) / gridCellBeatWidth) * 0.25); }
        updateClipVisualPlacement(clipEl, clipObj);
    });
    clipEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); clipEl.remove(); trackClips[trackId] = trackClips[trackId].filter(c => c.id !== clipObj.id);
        if (activeClipRef && activeClipRef.id === clipObj.id) document.getElementById('midi-editor').classList.add('hidden');
    });
}
