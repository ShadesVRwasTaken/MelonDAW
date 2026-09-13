// ==========================================================================
// WINDOW 1: CORE ENGINE STATE REGISTRIES & AUDIO HARDWARE
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
// WINDOW 2: AUDIO SCHEDULING TRANSPORT & TIME SETTER HANDLE
// ==========================================================================
let systemLoopStartTime = null; 

function startTimelineLoop() {
    const timeResolutionMs = 25; 
    systemLoopStartTime = Date.now() - (currentSeconds * 1000) + 50; 

    playbackInterval = setInterval(() => {
        const elapsedSec = (Date.now() - systemLoopStartTime) / 1000;
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

// ==========================================================================
// WINDOW 3: HOTKEY SHORTCUTS & PANEL RESIZER INITIALIZATION
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
// WINDOW 4: TIMELINE CONTROLS & TRACK LINE ARRANGEMENT
// ==========================================================================
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
    const timelineLane = row.querySelector('.track-timeline');
    timelineLane.addEventListener('dblclick', function(e) {
        if (e.target !== this) return;
        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 200;
        const snapBeatResolution = timelineZoomX / 4;
        const snappedBeatStart = Math.floor(e.offsetX / snapBeatResolution) * 0.25;
        createNewTimelineClip(trackId, snappedBeatStart, this);
    });
    listContainer.appendChild(row); setupTimelineLassoSelection(timelineLane);
}

// ==========================================================================
// WINDOW 5: PATTERN BLOCKS & TIMELINE LASSO INTERACTION
// ==========================================================================
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
        if (e.shiftKey) return; e.stopPropagation(); clipEl.setPointerCapture(e.pointerId); startX = e.clientX; startLeft = parseFloat(clipEl.style.left); startWidth = parseFloat(clipEl.style.width);
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

function setupTimelineLassoSelection(timelineEl) {
    let marquee = document.getElementById('timeline-marquee');
    if (!marquee) { marquee = document.createElement('div'); marquee.className = 'selection-marquee'; marquee.id = 'timeline-marquee'; document.getElementById('tracks-list').appendChild(marquee); }
    let isSelecting = false, startX, startY;
    timelineEl.addEventListener('pointerdown', (e) => {
        if (!e.shiftKey || e.target.closest('.timeline-clip')) return; isSelecting = true; timelineEl.setPointerCapture(e.pointerId);
        const listContainer = document.getElementById('tracks-list'); const rect = listContainer.getBoundingClientRect();
        startX = e.clientX - rect.left + listContainer.scrollLeft; startY = e.clientY - rect.top + listContainer.scrollTop;
        marquee.style.left = `${startX}px`; marquee.style.top = `${startY}px`; marquee.style.width = '0px'; marquee.style.height = '0px'; marquee.style.display = 'block';
        selectedClipIds = []; document.querySelectorAll('.timeline-clip').forEach(c => c.classList.remove('selected'));
    });
    timelineEl.addEventListener('pointermove', (e) => {
        if (!isSelecting) return; const listContainer = document.getElementById('tracks-list'); const rect = listContainer.getBoundingClientRect();
        const currentX = e.clientX - rect.left + listContainer.scrollLeft; const currentY = e.clientY - rect.top + listContainer.scrollTop;
        const left = Math.min(startX, currentX), top = Math.min(startY, currentY); const width = Math.abs(startX - currentX), height = Math.abs(startY - currentY);
        marquee.style.left = `${left}px`; marquee.style.top = `${top}px`; marquee.style.width = `${width}px`; marquee.style.height = `${height}px`;
        document.querySelectorAll('.timeline-clip').forEach(clipEl => {
            const trackRowEl = clipEl.closest('.track-row');
            const cRect = { left: clipEl.offsetLeft, top: clipEl.offsetTop + trackRowEl.offsetTop, right: clipEl.offsetLeft + clipEl.clientWidth, bottom: clipEl.offsetTop + trackRowEl.offsetTop + clipEl.clientHeight };
            const overlaps = !(left > cRect.right || left + width < cRect.left || top > cRect.bottom || top + height < cRect.top);
            if (overlaps) { clipEl.classList.add('selected'); if (!selectedClipIds.includes(clipEl.id)) selectedClipIds.push(clipEl.id); } 
            else { clipEl.classList.remove('selected'); selectedClipIds = selectedClipIds.filter(id => id !== clipEl.id); }
        });
    });
    timelineEl.addEventListener('pointerup', (e) => { if (!isSelecting) return; isSelecting = false; timelineEl.releasePointerCapture(e.pointerId); marquee.style.display = 'none'; });
}

// ==========================================================================
// WINDOW 6 - PART A: PIANO ROLL CANVAS GENERATOR
// ==========================================================================
function renderClipPreviewMatrix(clipEl, clipObj) {
    const canvas = clipEl.querySelector('.clip-preview-canvas'); if (!canvas) return; const ctx = canvas.getContext('2d');
    canvas.width = clipEl.clientWidth; canvas.height = clipEl.clientHeight - 12; ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (clipObj.notes.length === 0) return;
    const noteIndices = clipObj.notes.map(n => ALL_NOTES.indexOf(n.note));
    const maxIdx = Math.max(...noteIndices), minIdx = Math.min(...noteIndices); const idxRange = (maxIdx - minIdx) || 4;
    ctx.fillStyle = '#ff9800';
    clipObj.notes.forEach(note => {
        const clipDurationBeats = clipObj.barDuration * 4; if (note.beatStart >= clipDurationBeats) return; 
        const xStart = (note.beatStart / clipDurationBeats) * canvas.width; const width = (note.duration / clipDurationBeats) * canvas.width;
        const yStart = ((ALL_NOTES.indexOf(note.note) - minIdx) / idxRange) * (canvas.height - 6); ctx.fillRect(xStart, yStart, Math.max(4, width), 4);
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
    const inputTitle = document.querySelector(`#row-${trackId} .track-title-input`).value;
    document.getElementById('current-editing-track').innerText = `${inputTitle} (Bar ${clipObj.barStart + 1})`;
    document.getElementById('midi-editor').classList.remove('hidden');
    const keysContainer = document.getElementById('piano-keys'); const gridContainer = document.getElementById('piano-grid');
    keysContainer.innerHTML = ''; gridContainer.innerHTML = '';
    const ruler = document.createElement('div'); ruler.className = 'midi-ruler'; ruler.innerHTML = '<div id="midi-playhead-line"></div>';
    for(let b=0; b < (clipObj.barDuration * 4); b++) {
        const tick = document.createElement('div'); tick.className = 'midi-ruler-tick'; tick.style.left = `${b * parseFloat(document.getElementById('midi-zoom-x').value || 200)}px`;
        tick.innerText = `Beat ${b+1}`; ruler.appendChild(tick);
    }
    ruler.addEventListener('click', (e) => {
        const cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
        const secondsPerBeat = 60 / bpm; const localBeatClicked = e.offsetX / cellWidth;
        currentSeconds = ((clipObj.barStart * 4) + localBeatClicked) * secondsPerBeat;
        if (isPlaying) { systemLoopStartTime = Date.now() - (currentSeconds * 1000); }
        document.getElementById('midi-playhead-line').style.left = `${e.offsetX}px`;
    });
    gridContainer.appendChild(ruler); calculateAdaptiveSnapping(parseFloat(document.getElementById('midi-zoom-x').value));
    ALL_NOTES.forEach(noteName => {
        const key = document.createElement('div'); key.className = `piano-key ${noteName.includes('#') ? 'black-key' : 'white-key'}`;
        key.innerText = noteName.endsWith('C') || noteName.includes('C') ? noteName : noteName.slice(0,2); key.dataset.note = noteName;
        key.addEventListener('click', () => { initAudio(); playTone(getFrequency(noteName), 0.2); }); keysContainer.appendChild(key);
        const rowGrid = document.createElement('div'); rowGrid.className = 'grid-row'; rowGrid.dataset.note = noteName;
        rowGrid.addEventListener('click', (e) => {
            if (e.shiftKey || (e.target !== rowGrid && !e.target.classList.contains('grid-cell'))) return; e.stopPropagation();
            const cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
            const snappedBeat = Math.floor((e.offsetX / cellWidth) / currentSnapValue) * currentSnapValue;
            if (snappedBeat >= 0 && snappedBeat < (clipObj.barDuration * 4)) { createNewNote(noteName, snappedBeat, clipObj, trackId); }
        });
        gridContainer.appendChild(rowGrid);
    });
    clipObj.notes.forEach(noteObj => renderNoteElement(noteObj, trackId)); setupMidiRollLassoSelection(gridContainer);
    setTimeout(() => { const c4Key = document.querySelector('.piano-key[data-note="C4"]'); if (c4Key) c4Key.scrollIntoView({ block: 'center', behavior: 'smooth' }); }, 100);
}

// ==========================================================================
// WINDOW 6 - PART B: NOTE SPAWNING & DRAG POSITIONING
// ==========================================================================
function createNewNote(noteName, beatStart, clipObj, trackId) {
    const existing = clipObj.notes.find(n => n.note === noteName && n.beatStart === beatStart); if (existing) return;
    const noteId = `note-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const newNoteObj = { id: noteId, note: noteName, beatStart: beatStart, duration: currentSnapValue, hasTriggered: false };
    clipObj.notes.push(newNoteObj); renderNoteElement(newNoteObj, trackId); playTone(getFrequency(noteName), 0.2);
    const clipEl = document.getElementById(clipObj.id); if (clipEl) renderClipPreviewMatrix(clipEl, clipObj);
}

function renderNoteElement(noteObj, trackId) {
    const gridContainer = document.getElementById('piano-grid'); const noteEl = document.createElement('div'); noteEl.className = 'piano-note'; noteEl.id = noteObj.id; noteEl.innerHTML = `<div class="resize-handle"></div>`;
    updateNoteStylePosition(noteEl, noteObj); gridContainer.appendChild(noteEl); setupNoteInteractions(noteEl, noteObj, trackId);
}

function updateNoteStylePosition(noteEl, noteObj) {
    let cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
    let cellHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-height')) || 24;
    noteEl.style.width = `${noteObj.duration * cellWidth}px`; noteEl.style.height = `${cellHeight - 2}px`;
    noteEl.style.left = `${noteObj.beatStart * cellWidth}px`; noteEl.style.top = `${(ALL_NOTES.indexOf(noteObj.note) * cellHeight) + 21}px`;
}

function setupNoteInteractions(noteEl, noteObj, trackId) {
    let isDragging = false, isResizing = false, startX, startY, startLeft, startTop, startWidth;
    const cellWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
    const cellHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-height')) || 24;
    noteEl.addEventListener('pointerdown', (e) => {
        if (e.shiftKey) return; initAudio(); e.stopPropagation(); noteEl.setPointerCapture(e.pointerId);
        startX = e.clientX; startY = e.clientY; startLeft = parseFloat(noteEl.style.left); startTop = parseFloat(noteEl.style.top); startWidth = parseFloat(noteEl.style.width);
        if (e.target.classList.contains('resize-handle')) isResizing = true; 
        else { isDragging = true; if (!selectedNoteIds.includes(noteObj.id)) { selectedNoteIds = [noteObj.id]; document.querySelectorAll('.piano-note').forEach(n => n.classList.remove('selected')); noteEl.classList.add('selected'); } }
    });
    noteEl.addEventListener('pointermove', (e) => {
        if (!isDragging && !isResizing) return; const deltaX = e.clientX - startX; const maxLimitBeats = activeClipRef.barDuration * 4;
        if (isDragging) {
            let newLeft = Math.max(0, Math.min(startLeft + deltaX, (maxLimitBeats * cellWidth()) - parseFloat(noteEl.style.width)));
            noteEl.style.left = `${newLeft}px`; noteEl.style.top = `${Math.max(21, Math.min(startTop + e.clientY - startY, ((ALL_NOTES.length - 1) * cellHeight()) + 21))}px`;
        }
        if (isResizing) noteEl.style.width = `${Math.max(cellWidth() * currentSnapValue, Math.min(startWidth + deltaX, (maxLimitBeats * cellWidth()) - parseFloat(noteEl.style.left)))}px`;
    });
    noteEl.addEventListener('pointerup', (e) => {
        if (!isDragging && !isResizing) return; let clipEl = document.getElementById(activeClipRef.id); noteEl.releasePointerCapture(e.pointerId);
        if (isDragging) { isDragging = false; noteObj.beatStart = Math.round((parseFloat(noteEl.style.left) / cellWidth()) / currentSnapValue) * currentSnapValue; noteObj.note = ALL_NOTES[Math.round((parseFloat(noteEl.style.top) - 21) / cellHeight())]; playTone(getFrequency(noteObj.note), 0.2); }
        if (isResizing) { isResizing = false; noteObj.duration = Math.max(currentSnapValue, Math.round((parseFloat(noteEl.style.width) / cellWidth()) / currentSnapValue) * currentSnapValue); }
        updateNoteStylePosition(noteEl, noteObj); if (clipEl) renderClipPreviewMatrix(clipEl, activeClipRef);
    });
    noteEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); noteEl.remove(); let clipEl = document.getElementById(activeClipRef.id);
        activeClipRef.notes = activeClipRef.notes.filter(n => n.id !== noteObj.id); if (clipEl) renderClipPreviewMatrix(clipEl, activeClipRef);
    });
}

// ==========================================================================
// WINDOW 6 - PART C: LASER LASSO SELECTION & SYSTEM CONTROLS
// ==========================================================================
function setupMidiRollLassoSelection(gridContainer) {
    let marquee = document.getElementById('midi-marquee');
    if (!marquee) { marquee = document.createElement('div'); marquee.className = 'selection-marquee'; marquee.id = 'midi-marquee'; gridContainer.appendChild(marquee); }
    let isSelecting = false, startX, startY;
    gridContainer.addEventListener('pointerdown', (e) => {
        if (!e.shiftKey || e.target.closest('.piano-note')) return; isSelecting = true; gridContainer.setPointerCapture(e.pointerId);
        const rect = gridContainer.getBoundingClientRect(); startX = e.clientX - rect.left + gridContainer.parentElement.scrollLeft; startY = e.clientY - rect.top + gridContainer.parentElement.scrollTop;
        marquee.style.left = `${startX}px`; marquee.style.top = `${startY}px`; marquee.style.width = '0px'; marquee.style.height = '0px'; marquee.style.display = 'block';
        selectedNoteIds = []; document.querySelectorAll('.piano-note').forEach(n => n.classList.remove('selected'));
    });
    gridContainer.addEventListener('pointermove', (e) => {
        if (!isSelecting) return; const rect = gridContainer.getBoundingClientRect();
        const currentX = e.clientX - rect.left + gridContainer.parentElement.scrollLeft; const currentY = e.clientY - rect.top + gridContainer.parentElement.scrollTop;
        const left = Math.min(startX, currentX), top = Math.min(startY, currentY); const width = Math.abs(startX - currentX), height = Math.abs(startY - currentY);
        marquee.style.left = `${left}px`; marquee.style.top = `${top}px`; marquee.style.width = `${width}px`; marquee.style.height = `${height}px`;
        document.querySelectorAll('.piano-note').forEach(noteEl => {
            const nRect = { left: noteEl.offsetLeft, top: noteEl.offsetTop, right: noteEl.offsetLeft + noteEl.clientWidth, bottom: noteEl.offsetTop + noteEl.clientHeight };
            const overlaps = !(left > nRect.right || left + width < nRect.left || top > nRect.bottom || top + height < nRect.top);
            if (overlaps) { noteEl.classList.add('selected'); if (!selectedNoteIds.includes(noteEl.id)) selectedNoteIds.push(noteEl.id); } 
            else { noteEl.classList.remove('selected'); selectedNoteIds = selectedNoteIds.filter(id => id !== noteEl.id); }
        });
    });
    gridContainer.addEventListener('pointerup', (e) => { if (!isSelecting) return; isSelecting = false; gridContainer.releasePointerCapture(e.pointerId); marquee.style.display = 'none'; });
}

document.getElementById('timeline-zoom-x').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--timeline-block-width', `${e.target.value}px`);
    Object.keys(trackClips).forEach(t => trackClips[t].forEach(c => { const el = document.getElementById(c.id); if (el) updateClipVisualPlacement(el, c); }));
});
document.getElementById('midi-zoom-x').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value); document.documentElement.style.setProperty('--midi-cell-width', `${val}px`); calculateAdaptiveSnapping(val);
    if (activeClipRef) { openPianoRoll(activeClipRef, activeClipRef.id); }
});
document.getElementById('midi-zoom-y').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--midi-cell-height', `${e.target.value}px`); if (activeClipRef) refreshAllNoteElementsPositions();
});

function refreshAllNoteElementsPositions() { activeClipRef.notes.forEach(noteObj => { const el = document.getElementById(noteObj.id); if (el) updateNoteStylePosition(el, noteObj); }); }
document.getElementById('close-midi-btn').addEventListener('click', () => { document.getElementById('midi-editor').classList.add('hidden'); });
function deleteTrack(trackId) { document.getElementById(`row-${trackId}`).remove(); delete trackClips[trackId]; document.getElementById('midi-editor').classList.add('hidden'); }

// BOOT LAUNCH SYNCHRONIZATION HOOKS
generateTimelineRuler();
initWindowSplitterResizer();
