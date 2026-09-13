// --- Native Audio Architecture Setup ---
let audioCtx = null;
let trackCount = 0;
let isPlaying = false;
let currentBar = 0;
let bpm = 120;
let playbackInterval = null;
let activeTrackId = null;

// Track Data Stores
const trackSequences = {}; // Format: { trackId: { noteKey: [false, false, false, false] } }

// Frequencies for Octaves C0 to C8
const NOTE_NAMES = ['B', 'A#', 'A', 'G#', 'G', 'F#', 'F', 'E', 'D#', 'D', 'C#', 'C'];
const NOTE_FREQS = [];
const ALL_NOTES = [];

// Build Pitch Scale Table (C0 to C8)
for (let octave = 8; octave >= 0; octave--) {
    NOTE_NAMES.forEach(note => {
        let name = `${note}${octave}`;
        ALL_NOTES.push(name);
    });
}

// Fixed base mappings for synthetic node pitches
function getFrequency(noteName) {
    const notes = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const name = noteName.slice(0, -1);
    const octave = parseInt(noteName.slice(-1));
    const semitones = notes.indexOf(name) + (octave - 4) * 12;
    return 440 * Math.pow(2, (semitones - 9) / 12);
}

// 1. App Audio Drivers
function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
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

// 2. Transport Engine Loop
function startTimelineLoop() {
    const secondsPerBar = (60 / bpm) * 4; 
    const stepTimeMs = (secondsPerBar / 4) * 1000; // Check quarterly per bar grid

    playbackInterval = setInterval(() => {
        // Visual Playhead Tracker Updates
        document.querySelectorAll('.timeline-block').forEach(b => {
            if (parseInt(b.dataset.bar) === currentBar) {
                b.classList.add('playhead-current');
            } else {
                b.classList.remove('playhead-current');
            }
        });

        // Loop over tracks and scan structural note registers
        Object.keys(trackSequences).forEach(trackId => {
            const sequenceData = trackSequences[trackId];
            Object.keys(sequenceData).forEach(noteName => {
                if (sequenceData[noteName][currentBar]) {
                    const frequency = getFrequency(noteName);
                    playTone(frequency, 0.4);
                }
            });
        });

        currentBar = (currentBar + 1) % 4;
    }, stepTimeMs);
}

// 3. UI Interactions Handling
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
    currentBar = 0;
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

// Add Track Events
document.getElementById('add-inst-btn').addEventListener('click', () => {
    trackCount++;
    const trackId = `track-${trackCount}`;
    trackSequences[trackId] = {};
    
    // Default matrix steps configuration setup for C0-C8 notes
    ALL_NOTES.forEach(note => {
        trackSequences[trackId][note] = [false, false, false, false];
    });

    createTimelineRow(trackId, `Instrument ${trackCount}`, 'instrument');
    openPianoRoll(trackId, `Instrument ${trackCount}`);
});

document.getElementById('add-audio-btn').addEventListener('click', () => {
    trackCount++;
    const trackId = `track-${trackCount}`;
    trackSequences[trackId] = { "C3": [false, false, false, false] };
    createTimelineRow(trackId, `Audio Sample ${trackCount}`, 'audio');
});

// 4. Render Arrangement Tracks UI
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

// 5. MIDI Piano Roll Render Canvas Matrix
function openPianoRoll(trackId, trackName) {
    activeTrackId = trackId;
    document.getElementById('current-editing-track').innerText = trackName;
    document.getElementById('midi-editor').classList.remove('hidden');

    const keysContainer = document.getElementById('piano-keys');
    const gridContainer = document.getElementById('piano-grid');

    keysContainer.innerHTML = '';
    gridContainer.innerHTML = '';

    // Render nodes for full scale ranges from C0 to C8
    ALL_NOTES.forEach(noteName => {
        // Render physical keyboard key element
        const key = document.createElement('div');
        key.className = `piano-key ${noteName.includes('#') ? 'black-key' : 'white-key'}`;
        key.innerText = noteName.endsWith('C') || noteName.includes('C') ? noteName : noteName.slice(0,2);
        
        // Single preview pitch testing on click
        key.addEventListener('click', () => {
            initAudio();
            playTone(getFrequency(noteName), 0.2);
        });
        keysContainer.appendChild(key);

        // Render timeline step blocks matching note key row
        const rowGrid = document.createElement('div');
        rowGrid.className = 'grid-row';

        for (let b = 0; b < 4; b++) {
            const cell = document.createElement('div');
            cell.className = 'grid-cell';
            if (trackSequences[trackId][noteName][b]) {
                cell.classList.add('note-active');
            }

            cell.addEventListener('click', () => {
                initAudio();
                trackSequences[trackId][noteName][b] = !trackSequences[trackId][noteName][b];
                cell.classList.toggle('note-active');
                
                // Update track visual overview status state
                const overviewBlock = document.querySelector(`#row-${trackId} .timeline-block[data-bar="${b}"]`);
                if (overviewBlock) {
                    const hasActiveNotes = ALL_NOTES.some(n => trackSequences[trackId][n][b]);
                    overviewBlock.classList.toggle('has-notes', hasActiveNotes);
                }
            });
            rowGrid.appendChild(cell);
        }
        gridContainer.appendChild(rowGrid);
    });
}

document.getElementById('close-midi-btn').addEventListener('click', () => {
    document.getElementById('midi-editor').classList.add('hidden');
});

function deleteTrack(trackId) {
    document.getElementById(`row-${trackId}`).remove();
    delete trackSequences[trackId];
    if (activeTrackId === trackId) {
        document.getElementById('midi-editor').classList.add('hidden');
    }
}
// ... (Keep all your existing track creation, sound engines, and data tracking layers on top intact) ...

// --- Dynamic Scaling / Zoom Control Logic ---

// 1. Timeline Zoom (Horizontal Only)
document.getElementById('timeline-zoom-x').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--timeline-block-width', `${e.target.value}px`);
});

// 2. MIDI Piano Roll Zoom (Horizontal Width)
document.getElementById('midi-zoom-x').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--midi-cell-width', `${e.target.value}px`);
});

// 3. MIDI Piano Roll Zoom (Vertical Note Height - Universal variable)
document.getElementById('midi-zoom-y').addEventListener('input', (e) => {
    document.documentElement.style.setProperty('--midi-cell-height', `${e.target.value}px`);
});

// Set default fallback system dimensions explicit values
document.documentElement.style.setProperty('--timeline-block-width', '100px');
document.documentElement.style.setProperty('--midi-cell-width', '100px');
document.documentElement.style.setProperty('--midi-cell-height', '24px');
