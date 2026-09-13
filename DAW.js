// ==========================================
// PART 1: AUDIO CORE & STATE ARCHITECTURE
// ==========================================

let audioCtx = null;
let trackCount = 0;
let isPlaying = false;
let currentBeat = 0;
let bpm = 120;
let playbackInterval = null;
let activeTrackId = null;

// Track Global Registry Data Stores
const trackNotes = {}; 

const NOTE_NAMES = ['B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C'];
const ALL_NOTES = [];

// Build Pitch Scale Frequency Reference Table (C0 to C8)
for (let octave = 8; octave >= 0; octave--) {
    NOTE_NAMES.forEach(note => {
        ALL_NOTES.push(`${note}${octave}`);
    });
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
    
    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

// ==========================================
// PART 2: TRANSPORT LOOP & TRACK UI BUILDERS
// ==========================================

function startTimelineLoop() {
    const secondsPerBeat = 60 / bpm;

    playbackInterval = setInterval(() => {
        document.querySelectorAll('.timeline-block').forEach(b => {
            if (parseInt(b.dataset.bar) === currentBeat) {
                b.classList.add('playhead-current');
            } else {
                b.classList.remove('playhead-current');
            }
        });

        Object.keys(trackNotes).forEach(trackId => {
            const notes = trackNotes[trackId];
            notes.forEach(noteObj => {
                if (Math.floor(noteObj.beatStart) === currentBeat) {
                    const frequency = getFrequency(noteObj.note);
                    const noteDurationSeconds = noteObj.duration * secondsPerBeat;
                    playTone(frequency, noteDurationSeconds);
                }
            });
        });

        currentBeat = (currentBeat + 1) % 4;
    }, secondsPerBeat * 1000);
}

// Master Toolbar Interface Drivers
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
    currentBeat = 0;
    document.getElementById('play-btn').innerText = "▶ Play";
    document.getElementById('play-btn').classList.remove('active');
    document.querySelectorAll('.timeline-block').forEach(b => b.classList.remove('playhead-current'));
});

document.getElementById('bpm-input').addEventListener('input', (e) => {
    bpm = parseInt(e.target.value) || 120;
    if (isPlaying) {
        clearInterval(playbackInterval);
        startTimelineLoop();
    }
});

// Appending Track Framework Rows
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
            <div class="timeline-block" data-bar="0"></div>
            <div class="timeline-block" data-bar="1"></div>
            <div class="timeline-block" data-bar="2"></div>
            <div class="timeline-block" data-bar="3"></div>
        </div>
    `;
    listContainer.appendChild(row);
}

// ==========================================
// PART 3: PIANO ROLL ENGINE & DRAG LOGIC
// ==========================================

function openPianoRoll(trackId, trackName) {
    activeTrackId = trackId;
    document.getElementById('current-editing-track').innerText = trackName;
    document.getElementById('midi-editor').classList.remove('hidden');

    const keysContainer = document.getElementById('piano-keys');
    const gridContainer = document.getElementById('piano-grid');
    keysContainer.innerHTML = '';
    gridContainer.innerHTML = '';

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

        for (let b = 0; b < 4; b++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            cell.dataset.beat = b;
            cell.addEventListener('dblclick', (e) => { e.stopPropagation(); createNewNote(trackId, noteName, b); });
            rowGrid.appendChild(cell);
        }
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
    const newNoteObj = { id: noteId, note: noteName, beatStart: beatStart, duration: 1 };
    trackNotes[trackId].push(newNoteObj);
    renderNoteElement(newNoteObj);
    playTone(getFrequency(noteName), 0.2);
    updateTimelineOverview(trackId);
}

function renderNoteElement(noteObj) {
    const gridContainer = document.getElementById('piano-grid');
    const targetRow = document.querySelector(`.grid-row[data-note="${noteObj.note}"]`);
    if (!targetRow) return;

    const noteEl = document.createElement('div');
    noteEl.className = 'piano-note';
    noteEl.id = noteObj.id;
    noteEl.innerHTML = `<div class="resize-handle"></div>`;

    updateNoteStylePosition(noteEl, noteObj);
    gridContainer.appendChild(noteEl);
    setupNoteInteractions(noteEl, noteObj);
}

function updateNoteStylePosition(noteEl, noteObj) {
    const cellWidth = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width'));
    const cellHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-height'));
    const noteIndex = ALL_NOTES.indexOf(noteObj.note);

    noteEl.style.width = `${noteObj.duration * cellWidth}px`;
    noteEl.style.height = `${cellHeight - 2}px`;
    noteEl.style.left = `${noteObj.beatStart * cellWidth}px`;
    noteEl.style.top = `${noteIndex * cellHeight + 1}px`;
}

function setupNoteInteractions(noteEl, noteObj) {
    let isDragging = false, isResizing = false;
    let startX, startY, startLeft, startTop, startWidth;

    const cellWidth = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-width'));
    const cellHeight = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--midi-cell-height'));

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
            let newLeft = startLeft + deltaX; let newTop = startTop + deltaY;
            newLeft = Math.max(0, newLeft); newTop = Math.max(0, Math.min(newTop, (ALL_NOTES.length - 1) * cellHeight()));
            noteEl.style.left = `${newLeft}px`; noteEl.style.top = `${newTop}px`;
        }
        if (isResizing) {
            let newWidth = startWidth + deltaX;
            noteEl.style.width = `${Math.max(cellWidth() * 0.25, newWidth)}px`;
        }
    });

    noteEl.addEventListener('pointerup', (e) => {
        if (!isDragging && !isResizing) return;
        noteEl.releasePointerCapture(e.pointerId);

        if (isDragging) {
            isDragging = false; noteEl.classList.remove('dragging');
            const snappedBeat = Math.round(parseFloat(noteEl.style.left) / cellWidth());
            const snappedNoteIndex = Math.round(parseFloat(noteEl.style.top) / cellHeight());
            noteObj.beatStart = Math.min(3, Math.max(0, snappedBeat));
            noteObj.note = ALL_NOTES[snappedNoteIndex];
            playTone(getFrequency(noteObj.note), 0.2);
        }
        if (isResizing) {
            isResizing = false;
            noteObj.duration = Math.max(0.25, Math.round((parseFloat(noteEl.style.width) / cellWidth()) * 4) / 4);
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
    for (let b = 0; b < 4; b++) {
        const overviewBlock = document.querySelector(`#row-${trackId} .timeline-block[data-bar="${b}"]`);
        if (overviewBlock) {
            const hasNotesOnBeat = trackNotes[trackId].some(n => Math.floor(n.beatStart) === b);
            overviewBlock.classList.toggle('has-notes', hasNotesOnBeat);
        }
    }
}

// Global Custom Zoom Layout Event Callbacks
document.getElementById('timeline-zoom-x').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--timeline-block-width', `${e.target.value}px`);
});
document.getElementById('midi-zoom-x').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--midi-cell-width', `${e.target.value}px`);
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

// Structural Initialization Default System Parameters
document.documentElement.style.setProperty('--timeline-block-width', '100px');
document.documentElement.style.setProperty('--midi-cell-width', '100px');
document.documentElement.style.setProperty('--midi-cell-height', '24px');
