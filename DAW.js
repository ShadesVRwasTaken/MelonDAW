// Global State Tracking
let trackCount = 0;
let isPlaying = false;

// 1. Core Transport Controls
document.getElementById('play-btn').addEventListener('click', async () => {
    // Web browsers strictly require user interaction before activating the Web Audio context
    await Tone.start();
    
    if (!isPlaying) {
        Tone.Transport.start();
        isPlaying = true;
        document.getElementById('play-btn').innerText = "⏸ Pause";
        document.getElementById('play-btn').classList.add('active');
    } else {
        Tone.Transport.pause();
        isPlaying = false;
        document.getElementById('play-btn').innerText = "▶ Play";
        document.getElementById('play-btn').classList.remove('active');
    }
});

document.getElementById('stop-btn').addEventListener('click', () => {
    Tone.Transport.stop();
    isPlaying = false;
    document.getElementById('play-btn').innerText = "▶ Play";
    document.getElementById('play-btn').classList.remove('active');
});

// Update BPM when changed
document.getElementById('bpm-input').addEventListener('input', (e) => {
    let bpmValue = parseFloat(e.target.value);
    if (bpmValue > 0) {
        Tone.Transport.bpm.value = bpmValue;
    }
});

// 2. Dynamic Track Creation Logic
const tracksList = document.getElementById('tracks-list');

// Add Instrument Track (+)
document.getElementById('add-inst-btn').addEventListener('click', () => {
    trackCount++;
    
    // Create an independent Tone.js Synthesizer for this track
    const synth = new Tone.PolySynth(Tone.Synth).toDestination();

    createTrackElement(`Track ${trackCount} (Synth)`, 'instrument', (time, isRegionClicked) => {
        if (isRegionClicked) {
            // Play a standard chord or note when timeline region is clicked / triggered
            synth.triggerAttackRelease(["C4", "E4", "G4"], "2n", time);
        }
    });
});

// Add Audio Track (+)
document.getElementById('add-audio-btn').addEventListener('click', () => {
    trackCount++;

    // Fallback synth mimicking a drum/audio sample trigger since local file assets vary in Codespaces
    const samplerMock = new Tone.NoiseSynth({
        envelope: { attack: 0.001, decay: 0.1, sustain: 0 }
    }).toDestination();

    createTrackElement(`Track ${trackCount} (Audio)`, 'audio', (time, isRegionClicked) => {
        if (isRegionClicked) {
            samplerMock.triggerAttackRelease("2n", time);
        }
    });
});

// 3. Helper function to render tracks & link blocks to timeline schedule
function createTrackElement(trackName, trackType, audioTriggerCallback) {
    const trackRow = document.createElement('div');
    trackRow.className = `track-row ${trackType}-track`;

    // Track Control Header Panel (Left Side)
    const trackHeader = document.createElement('div');
    trackHeader.className = 'track-header';
    trackHeader.innerHTML = `
        <span class="track-title">${trackName}</span>
        <div class="track-controls">
            <button class="mute-btn">M</button>
            <button class="delete-btn">🗑</button>
        </div>
    `;

    // Timeline Blocks Region (Right Side)
    const trackTimeline = document.createElement('div');
    trackTimeline.className = 'track-timeline';
    
    // Create 4 distinct bars/blocks along the grid matching FL Studio layout
    const blocksState = [false, false, false, false];
    
    for (let i = 0; i < 4; i++) {
        const block = document.createElement('div');
        block.className = 'timeline-block';
        block.dataset.bar = i;
        
        block.addEventListener('click', () => {
            blocksState[i] = !blocksState[i];
            block.classList.toggle('active-block', blocksState[i]);
        });
        
        trackTimeline.appendChild(block);
    }

    // Connect this specific track sequence to the main audio timeline loop
    Tone.Transport.scheduleRepeat((time) => {
        // Quantize position into 4 bars loop
        const currentBar = Math.floor(Tone.Transport.position.split(':')[0]) % 4;
        
        // Visually pulse active playheads
        const allBlocks = trackTimeline.querySelectorAll('.timeline-block');
        allBlocks.forEach((b, idx) => {
            if (idx === currentBar && isPlaying) {
                b.classList.add('playhead-current');
            } else {
                b.classList.remove('playhead-current');
            }
        });

        // Trigger sound if block is scheduled active by user click
        audioTriggerCallback(time, blocksState[currentBar]);
    }, "1m"); // "1m" checks exact sound triggers once every full bar length

    // Handle Delete Track
    trackHeader.querySelector('.delete-btn').addEventListener('click', () => {
        trackRow.remove();
    });

    trackRow.appendChild(trackHeader);
    trackRow.appendChild(trackTimeline);
    tracksList.appendChild(trackRow);
}
