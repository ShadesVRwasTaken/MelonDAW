// ==========================================================================
// PART 1: AUDIO CONFIGURATION & INFINITE TRANSPORT TIMING
// ==========================================================================

let audioCtx = null;
let trackCount = 0;
let isPlaying = false;
let currentSeconds = 0; 
let bpm = 120;
let playbackInterval = null;
let activeTrackId = null;

// Adaptive Snapping Value Context Sizing Trackers
let currentSnapValue = 0.25; // 0.25 = quarter note (Default 1 beat unit snapping interval)

const trackNotes = {}; 
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

// Infinite Continuous Time tracking loop driver engine
function startTimelineLoop() {
    const timeResolutionMs = 25; // Processes layout positions accurately every 25 milliseconds
    const startTime = Date.now() - (currentSeconds * 1000);

    playbackInterval = setInterval(() => {
        const elapsedSec = (Date.now() - startTime) / 1000;
        currentSeconds = elapsedSec;
        
        const secondsPerBeat = 60 / bpm;
        const currentBeatPosition = elapsedSec / secondsPerBeat;

        // Visual layout playhead tracking synchronization updating
        const timelineZoomX = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--timeline-block-width')) || 100;
        const playheadPx = currentBeatPosition * timelineZoomX;
        
        const playheadLine = document.getElementById('playhead-line');
        if (playheadLine) {
            playheadLine.style.display = 'block';
            playheadLine.style.left = `${playheadPx}px`;
        }

        // Loop checks audio note trigger ranges
        Object.keys(trackNotes).forEach(trackId => {
            trackNotes[trackId].forEach(noteObj => {
                const triggerThreshold = timeResolutionMs / 1000 / secondsPerBeat;
                if (currentBeatPosition >= noteObj.beatStart && currentBeatPosition < noteObj.beatStart + triggerThreshold) {
                    if (!noteObj.hasTriggeredThisPass) {
                        noteObj.hasTriggeredThisPass = true;
                        const freq = getFrequency(noteObj.note);
                        playTone(freq, noteObj.duration * secondsPerBeat);
                    }
                } else {
                    noteObj.hasTriggeredThisPass = false;
                }
            });
        });
    }, timeResolutionMs);
}

// ==========================================================================
// PART 2: TOOLBAR CONTROLS & DYNAMIC VIEWPORT GENERATION
// ==========================================================================

document.getElementById('play-btn').addEventListener('click', () => {
    initAudio();
    if (!isPlaying) {
        isPlaying = true;
        document.getElementById('play-btn').innerText = "⏸ Pause";
        document.getElementById('play-btn').classList.add('active');
        startTimelineLoop();
    } else {
        clearInterval(playbackInterval);
        isPlaying = false;
        document.getElementById('play-btn').innerText = "▶ Play";
        document.getElementById('play-btn').classList.remove('active');
    }
});

document.getElementById('stop-btn').addEventListener('click', () => {
    clearInterval(playbackInterval);
    isPlaying = false;
    currentSeconds = 0;
    document.getElementById('play-btn').innerText = "▶ Play";
    document.getElementById('play-btn').classList.remove('active');
    
    const playheadLine = document.getElementById('playhead-line');
    if (playheadLine) playheadLine.style.display = 'none';
    
    Object.keys(trackNotes).forEach(t => trackNotes[t].forEach(n => n.hasTriggeredThisPass = false));
});

document.getElementById('bpm-input').addEventListener('input', (e) => {
    bpm = parseInt(e.target.value) || 120;
});

// Render infinite layout helper ticks into top ruler track panels
function generateInfiniteTimelineRuler() {
    const ticksContainer = document.getElementById('ruler-ticks');
    ticksContainer.innerHTML = '<div id="playhead-line"></div>'; // Re-insert playhead lane shell
    
    // Procedurally prints initial timeline markers up to 100 beats down the track
    for (let i = 1; i <= 100; i++) {
        const tick = document.createElement('div');
        tick.className = 'tick';
        tick.innerText = `Beat ${i}`;
        ticksContainer.appendChild(tick);
    }
}

document.getElementById('add-inst-btn').addEventListener('click', () => {
    trackCount++;
    const trackId = `track-${trackCount}`;
    trackNotes[trackId] = [];
    createTimelineRow(trackId, `Instrument ${trackCount}`, 'instrument');
    openPianoRoll(trackId, `Instrument ${trackCount}`);
});

document.getElementById('add-audio-btn').addEventListener('click', () => {
    trackCount++;
    const trackId = `track-${trackCount}`;
    trackNotes[trackId] = [];
    createTimelineRow(trackId, `Audio Sample ${trackCount}`, 'audio');
});

function createTimelineRow(trackId, trackName, type) {
    const listContainer = document.getElementById('tracks-list');
    const row = document.createElement('div');
    row.className = `track-row ${type}-track`;
    row.id = `row-${trackId}`;

    row.innerHTML = `
        <div class="track-header">
            <span class="track-title">${trackName}</span>
            <div class="track-controls">
                ${type === 'instrument' ? `<button class="edit-midi-btn" onclick="openPianoRoll('${trackId}', '${trackName}')">🎹 Edit</button>` : ''}
                <button class="delete-btn" onclick="deleteTrack('${trackId}')">🗑</button>
            </div>
        </div>
        <div class="track-timeline">
             <div class="timeline-block" id="overview-${trackId}"></div>
        </div>
    `;
    listContainer.appendChild(row);
}

// ==========================================================================
// PART 3: PIANO ROLL CANVAS & ADAPTIVE SNAPPING GRID CALCULATIONS
// ==========================================================================

function calculateAdaptiveSnapping(zoomWidth) {
    const indicator = document.getElementById('snap-value');
    
    if (zoomWidth < 150) {
        currentSnapValue = 1.0; // Snaps strictly to full beats
        document.documentElement.style.setProperty('--midi-subdivisions', '1');
        if (indicator) indicator.innerText = "1/4 Note (1 Beat)";
    } else if (zoomWidth >= 150 && zoomWidth < 350) {
        currentSnapValue = 0.5; // 8th note steps
        document.documentElement.style.setProperty('--midi-subdivisions', '2');
        if (indicator) indicator.innerText = "1/8 Note";
    } else if (zoomWidth >= 350 && zoomWidth < 700) {
        currentSnapValue = 0.25; // 16th note structures
        document.documentElement.style.setProperty('--midi-subdivisions', '4');
        if (indicator) indicator.innerText = "1/16 Note";
    } else {
        currentSnapValue = 0.125; // High definition 32nd note adjustments
        document.documentElement.style.setProperty('--midi-subdivisions', '8');
        if (indicator) indicator.innerText = "1/32 Note";
    }
}

function openPianoRoll(trackId, trackName) {
    activeTrackId = trackId;
    document.getElementById('current-editing-track').innerText = trackName;
    document.getElementById('midi-editor').classList.remove('hidden');

    const keysContainer = document.getElementById('piano-keys');
    const gridContainer = document.getElementById('piano-grid');
    keysContainer.innerHTML = '';
    gridContainer.innerHTML = '';

    // Initialize adaptive layout scale calculations immediately
    const baseWidthSlider = document.getElementById('midi-zoom-x').value;
    calculateAdaptiveSnapping(parseFloat(baseWidthSlider));

    ALL_NOTES.forEach(noteName => {
        const key = document.createElement('div');
        key.className = `piano-key ${noteName.includes('#') ? 'black-key' : 'white-key'}`;
        key.innerText = noteName.endsWith('C') || noteName.includes('C') ? noteName : noteName.slice(0,2);
        key.dataset.note = noteName;
        key.addEventListener('click', () => { initAudio(); playTone(getFrequency(noteName), 0.2); });
        keysContainer.appendChild(key);

        const rowGrid = document.createElement('div');
        rowGrid.className = 'grid-row';
        rowGrid.dataset.note = noteName;
        
        // Single canvas click tracking catches note drawing anywhere down the lane lines
        rowGrid.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const clickX = e.offsetX;
            const cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
            const clickedBeatPosition = clickX / cellWidth;
            
            // Mathematical snap targeting calculation
            const snappedBeat = Math.round(clickedBeatPosition / currentSnapValue) * currentSnapValue;
            createNewNote(trackId, noteName, snappedBeat);
        });
        gridContainer.appendChild(rowGrid);
    });

    trackNotes[trackId].forEach(noteObj => renderNoteElement(noteObj));
    setTimeout(() => {
        const c4Key = document.querySelector('.piano-key[data-note="C4"]');
        if (c4Key) c4Key.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 100);
}

function createNewNote(trackId, noteName, beatStart) {
    const noteId = `note-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`;
    const newNoteObj = { id: noteId, note: noteName, beatStart: beatStart, duration: currentSnapValue, hasTriggeredThisPass: false };
    trackNotes[trackId].push(newNoteObj);
    renderNoteElement(newNoteObj);
    playTone(getFrequency(noteName), 0.2);
    updateTimelineOverview(trackId);
}

function renderNoteElement(noteObj) {
    const gridContainer = document.getElementById('piano-grid');
    const noteEl = document.createElement('div');
    noteEl.className = 'piano-note';
    noteEl.id = noteObj.id;
    noteEl.innerHTML = `<div class="resize-handle"></div>`;

    updateNoteStylePosition(noteEl, noteObj);
    gridContainer.appendChild(noteEl);
    setupNoteInteractions(noteEl, noteObj);
}

function updateNoteStylePosition(noteEl, noteObj) {
    let cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
    let cellHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-height')) || 24;
    const noteIndex = ALL_NOTES.indexOf(noteObj.note);

    noteEl.style.width = `${noteObj.duration * cellWidth}px`;
    noteEl.style.height = `${cellHeight - 2}px`;
    noteEl.style.left = `${noteObj.beatStart * cellWidth}px`;
    noteEl.style.top = `${noteIndex * cellHeight + 1}px`;
}

function setupNoteInteractions(noteEl, noteObj) {
    let isDragging = false, isResizing = false;
    let startX, startY, startLeft, startTop, startWidth;

    const cellWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width')) || 200;
    const cellHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-height')) || 24;

    noteEl.addEventListener('pointerdown', (e) => {
        initAudio(); e.stopPropagation(); noteEl.setPointerCapture(e.pointerId);
        startX = e.clientX; startY = e.clientY;
        startLeft = parseFloat(noteEl.style.left); startTop = parseFloat(noteEl.style.top); startWidth = parseFloat(noteEl.style.width);
        if (e.target.classList.contains('resize-handle')) { isResizing = true; } 
        else { isDragging = true; noteEl.classList.add('dragging'); }
    });

    noteEl.addEventListener('pointermove', (e) => {
        if (!isDragging && !isResizing) return;
        const deltaX = e.clientX - startX; const deltaY = e.clientY - startY;

        if (isDragging) {
            let newLeft = Math.max(0, startLeft + deltaX);
            let newTop = Math.max(0, Math.min(startTop + deltaY, (ALL_NOTES.length - 1) * cellHeight()));
            noteEl.style.left = `${newLeft}px`; noteEl.style.top = `${newTop}px`;
        }
        if (isResizing) {
            noteEl.style.width = `${Math.max(cellWidth() * currentSnapValue, startWidth + deltaX)}px`;
        }
    });

    noteEl.addEventListener('pointerup', (e) => {
        if (!isDragging && !isResizing) return;
        noteEl.releasePointerCapture(e.pointerId);

        if (isDragging) {
            isDragging = false; noteEl.classList.remove('dragging');
            const snappedBeat = Math.round((parseFloat(noteEl.style.left) / cellWidth()) / currentSnapValue) * currentSnapValue;
            const snappedNoteIndex = Math.round(parseFloat(noteEl.style.top) / cellHeight());
            noteObj.beatStart = snappedBeat;
            noteObj.note = ALL_NOTES[snappedNoteIndex];
            playTone(getFrequency(noteObj.note), 0.2);
        }
        if (isResizing) {
            isResizing = false;
            const rawDuration = parseFloat(noteEl.style.width) / cellWidth();
            noteObj.duration = Math.max(currentSnapValue, Math.round(rawDuration / currentSnapValue) * currentSnapValue);
        }
        updateNoteStylePosition(noteEl, noteObj);
        updateTimelineOverview(activeTrackId);
    });

    noteEl.addEventListener('contextmenu', (e) => {
        e.preventDefault(); noteEl.remove();
        trackNotes[activeTrackId] = trackNotes[activeTrackId].filter(n => n.id !== noteObj.id);
        updateTimelineOverview(activeTrackId);
    });
}

function updateTimelineOverview(trackId) {
    const overview = document.getElementById(`overview-${trackId}`);
    if (overview) {
        overview.classList.toggle('has-notes', trackNotes[trackId].length > 0);
    }
}

// Sliders Zoom Event Triggers
document.getElementById('timeline-zoom-x').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--timeline-block-width', `${e.target.value}px`);
});

document.getElementById('midi-zoom-x').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    document.documentElement.style.setProperty('--midi-cell-width', `${val}px`);
    calculateAdaptiveSnapping(val);
    if (activeTrackId) refreshAllNoteElementsPositions();
});

document.getElementById('midi-zoom-y').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--midi-cell-height', `${e.target.value}px`);
    if (activeTrackId) refreshAllNoteElementsPositions();
});

function refreshAllNoteElementsPositions() {
    trackNotes[activeTrackId].forEach(noteObj => {
        const el = document.getElementById(noteObj.id);
        if (el) updateNoteStylePosition(el, noteObj);
    });
}

document.getElementById('close-midi-btn').addEventListener('click', () => {
    document.getElementById('midi-editor').classList.add('hidden');
});

function deleteTrack(trackId) {
    document.getElementById(`row-${trackId}`).remove();
    delete trackNotes[trackId];
    if (activeTrackId === trackId) document.getElementById('midi-editor').classList.add('hidden');
}

// Startup Framework Triggers
generateInfiniteTimelineRuler();
document.documentElement.style.setProperty('--timeline-block-width', '100px');
document.documentElement.style.setProperty('--midi-cell-width', '200px');
document.documentElement.style.setProperty('--midi-cell-height', '24px');
