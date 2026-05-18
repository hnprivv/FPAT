import * as THREE from "./node_modules/three/build/three.module.js";
import { GLTFLoader } from './node_modules/three/examples/jsm/loaders/GLTFLoader.js';
import { EXRLoader } from './node_modules/three/examples/jsm/loaders/EXRLoader.js';
import { initNetwork, broadcastState, broadcastShoot, broadcastPlayerHit, broadcastDeath, broadcastRespawn, broadcastBombPlanted, broadcastBombDefused, broadcastBombPlantingStart, broadcastBombPlantingStop, broadcastSndRematch, broadcastSndQuit, broadcastPistolThrow, broadcastPistolReturn, getMyPlayerId, getRemotePlayerHit, updateRemotePlayers, initRemoteAudio, getLeaderboardData, getRemotePlayerPositions, getRemotePlayerPosition, setRemoteFootstepVolume, setWallBoxes, broadcastGrenadeThrow, getPlayersInRange } from './network.js';

// Asset loading manager
const loadingManager = new THREE.LoadingManager();

// DOM elements (assigned on DOMContentLoaded)
let loaderOverlay = null;
let loaderFill = null;
let loaderPercent = null;
let dayNightBtn = null;
let controlsBtn = null;
let controlsModal = null;
let infoBtn = null;
let infoModal = null;

// LoadingManager callbacks (use DOM variables which will be set once DOM is ready)
loadingManager.onStart = function (url, itemsLoaded, itemsTotal) {
    if (loaderOverlay) loaderOverlay.classList.remove('hidden');
    if (loaderFill) loaderFill.style.width = '0%';
    if (loaderPercent) loaderPercent.textContent = '0%';
};

loadingManager.onProgress = function (url, itemsLoaded, itemsTotal) {
    const pct = Math.round((itemsLoaded / itemsTotal) * 100);
    if (loaderFill) loaderFill.style.width = `${pct}%`;
    if (loaderPercent) loaderPercent.textContent = `${pct}%`;
};

loadingManager.onLoad = function () {
    setTimeout(() => {
        if (loaderOverlay) loaderOverlay.classList.add('hidden');
        gameActive = true;
        // Auto-open multiplayer modal only when arriving via an invite link
        const params = new URLSearchParams(window.location.search);
        if (params.get('room')) {
            const lobbyEl = document.getElementById('lobby-overlay');
            if (lobbyEl) lobbyEl.classList.add('visible');
        }
    }, 220);
};

loadingManager.onError = function (url) {
    console.error('LoadingManager error:', url);
    // still hide overlay after a moment so user can interact and see console
    setTimeout(() => {
        if (loaderOverlay) loaderOverlay.classList.add('hidden');
    }, 800);
};

// Wait for DOM so overlay and UI elements exist
window.addEventListener('DOMContentLoaded', () => {
    loaderOverlay = document.getElementById('loading-overlay');
    loaderFill = document.getElementById('loader-fill');
    loaderPercent = document.getElementById('loader-percent');

    // UI buttons and modals
    dayNightBtn = document.getElementById('day-night-btn');
    if (dayNightBtn) {
        dayNightBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            updateDayNightButton();
        });
    }

    controlsBtn = document.getElementById('controls-btn');
    controlsModal = document.getElementById('controls-modal');
    if (controlsBtn && controlsModal) {
        controlsBtn.addEventListener('click', (e) => {
            controlsModal.classList.add('visible');
            e.stopPropagation();
        });
        controlsModal.addEventListener('click', () => {
            controlsModal.classList.remove('visible');
        });
        const controlsContent = document.getElementById('controls-modal-content');
        if (controlsContent) controlsContent.addEventListener('click', (e) => e.stopPropagation());
    }

    infoBtn = document.getElementById('info-btn');
    infoModal = document.getElementById('info-modal');
    if (infoBtn && infoModal) {
        infoBtn.addEventListener('click', (e) => {
            infoModal.classList.add('visible');
            e.stopPropagation();
        });
        infoModal.addEventListener('click', () => {
            infoModal.classList.remove('visible');
        });
        const infoContent = document.getElementById('info-modal-content');
        if (infoContent) infoContent.addEventListener('click', (e) => e.stopPropagation());
        // show info modal at start
        infoModal.classList.add('visible');
    }

    // Multiplayer modal
    const multiplayerBtn = document.getElementById('multiplayer-btn');
    if (multiplayerBtn) {
        multiplayerBtn.addEventListener('click', e => {
            e.stopPropagation();
            const overlay = document.getElementById('lobby-overlay');
            if (overlay) overlay.classList.add('visible');
        });
    }

    // Volume modal
    const volumeBtn   = document.getElementById('volume-btn');
    const volumeModal = document.getElementById('volume-modal');
    if (volumeBtn && volumeModal) {
        volumeBtn.addEventListener('click', e => { volumeModal.classList.add('visible'); e.stopPropagation(); });
        volumeModal.addEventListener('click', () => volumeModal.classList.remove('visible'));
        const vmContent = document.getElementById('volume-modal-content');
        if (vmContent) vmContent.addEventListener('click', e => e.stopPropagation());

        const gunshotSlider  = document.getElementById('vol-gunshot');
        const gunshotValEl   = document.getElementById('vol-gunshot-val');
        const footstepSlider = document.getElementById('vol-footstep');
        const footstepValEl  = document.getElementById('vol-footstep-val');
        const explosionSlider = document.getElementById('vol-explosion');
        const explosionValEl  = document.getElementById('vol-explosion-val');

        if (gunshotSlider) {
            gunshotSlider.addEventListener('input', () => {
                const s = parseFloat(gunshotSlider.value);
                gunVolume = s * s; // squared curve — makes slider perceptually linear
                if (gunshotValEl) gunshotValEl.textContent = Math.round(s * 100) + '%';
                gunshotSound.setVolume(gunVolume);
            });
        }
        if (footstepSlider) {
            footstepSlider.addEventListener('input', () => {
                const s = parseFloat(footstepSlider.value);
                footstepVolume = s * s; // squared curve
                if (footstepValEl) footstepValEl.textContent = Math.round(s * 100) + '%';
                footstepSound.setVolume(footstepVolume);
                setRemoteFootstepVolume(footstepVolume);
            });
        }
        if (explosionSlider) {
            explosionSlider.addEventListener('input', () => {
                explosionVolume = parseFloat(explosionSlider.value);
                if (explosionValEl) explosionValEl.textContent = Math.round(explosionVolume * 100) + '%';
            });
        }
    }

    // SND Rematch / Quit buttons
    const sndRematchBtn = document.getElementById('snd-rematch-btn');
    const sndQuitBtn    = document.getElementById('snd-quit-btn');
    if (sndRematchBtn) {
        sndRematchBtn.addEventListener('click', e => {
            e.stopPropagation();
            sndRematchBtn.disabled = true;
            if (sndQuitBtn) sndQuitBtn.disabled = true;
            broadcastSndRematch();
        });
    }
    if (sndQuitBtn) {
        sndQuitBtn.addEventListener('click', e => {
            e.stopPropagation();
            broadcastSndQuit();
        });
    }

    // Score reset button
    const scoreResetBtn = document.getElementById('reset-btn');
    if (scoreResetBtn) {
        scoreResetBtn.addEventListener('click', (e) => {
            e.preventDefault();
            setScore(0);
            // hide any transient +1 popup or target-hit message if visible
            const plus = document.getElementById('score-plus');
            if (plus) plus.classList.remove('visible');
            const targetMsg = document.getElementById('target-hit-msg');
            if (targetMsg) targetMsg.classList.remove('visible');

            console.log('Score reset to 0');
            showTargetHitMessage('Score has been reset!', 2000, true);
        });
    }
});

let gameActive = false;

// Custom FPS mouse-look controller.
// Replaces PointerLockControls' mouse handler, which had two problems:
//   1. No per-event delta clamping → large movementX/Y spikes (common on Windows,
//      and always on the first event after pointer lock engages) snap the camera.
//   2. Decomposes camera.quaternion to Euler on every event → any residual rotation
//      state from spawning or the death animation causes an immediate snap.
// This class owns _yaw/_pitch as plain numbers, clamps each event's delta,
// and applies the result directly. No quaternion decomposition needed.
class FPSControls {
    constructor(camera, domElement) {
        this.camera = camera;
        this.domElement = domElement;
        this.isLocked = false;
        this.sensitivity = 0.002;
        this._yaw = 0;
        this._pitch = 0;
        this._v = new THREE.Vector3();

        camera.rotation.order = 'YXZ';

        this._onMove   = this._onMove.bind(this);
        this._onChange = this._onChange.bind(this);
        document.addEventListener('mousemove', this._onMove);
        document.addEventListener('pointerlockchange', this._onChange);
    }

    _onMove(event) {
        if (!this.isLocked) return;
        const process = (e) => {
            // Hard-clamp each raw delta. This kills the snap that happens when
            // pointer lock first engages (Chrome queues all movement during the
            // async lock request and fires it as one huge event).
            const dx = Math.max(-50, Math.min(50, e.movementX || 0));
            const dy = Math.max(-50, Math.min(50, e.movementY || 0));
            this._yaw   -= dx * this.sensitivity;
            this._pitch -= dy * this.sensitivity;
            this._pitch  = Math.max(-Math.PI * 0.499, Math.min(Math.PI * 0.499, this._pitch));
        };
        // getCoalescedEvents gives sub-frame events on high-frequency mice (1000 Hz etc.)
        // so fast flicks are tracked precisely instead of being rounded to one delta.
        if (event.getCoalescedEvents) {
            for (const e of event.getCoalescedEvents()) process(e);
        } else {
            process(event);
        }
        this.camera.rotation.y = this._yaw;
        this.camera.rotation.x = this._pitch;
    }

    _onChange() {
        this.isLocked = document.pointerLockElement === this.domElement;
    }

    lock()   { this.domElement.requestPointerLock(); }
    unlock() { document.exitPointerLock(); }

    moveForward(dist) {
        this._v.setFromMatrixColumn(this.camera.matrix, 0);
        this._v.crossVectors(this.camera.up, this._v);
        this.camera.position.addScaledVector(this._v, dist);
    }

    moveRight(dist) {
        this._v.setFromMatrixColumn(this.camera.matrix, 0);
        this.camera.position.addScaledVector(this._v, dist);
    }

    // Always use this instead of setting camera.rotation directly —
    // it keeps _yaw/_pitch in sync so the next mouse event doesn't snap.
    setRotation(yaw, pitch = 0) {
        this._yaw   = yaw;
        this._pitch = Math.max(-Math.PI * 0.499, Math.min(Math.PI * 0.499, pitch));
        this.camera.rotation.y = this._yaw;
        this.camera.rotation.x = this._pitch;
    }
}

// Renderer
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Scene and camera
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
window.camera = camera;

// Controls
const controls = new FPSControls(camera, renderer.domElement);
const controlsObject = camera; // alias — existing code uses controlsObject for position/collision
scene.add(camera);

// Lighting
const sun = new THREE.DirectionalLight(0xffffff, 0.4); // softer intensity
sun.position.set(10, 20, 10);

// Shadow settings
sun.shadow.mapSize.width = 2048;
sun.shadow.mapSize.height = 2048;
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 100;
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;

scene.add(sun);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const ambient = new THREE.AmbientLight(0xffffff, 0.2);
scene.add(ambient);

// Flashlight setup
const flashlight = new THREE.SpotLight(0xffffff, 2, 20, Math.PI / 8, 0.3, 1);
camera.add(flashlight);
flashlight.position.set(0, 0, 0);
flashlight.target.position.set(0, 0, -1);
camera.add(flashlight.target);
flashlight.visible = false;

// WASD movement
const move = { forward: false, backward: false, left: false, right: false };
const velocity = new THREE.Vector3();
const direction = new THREE.Vector3();
const standingHeight = 2;
const crouchingHeight = 1.5;
const staminaMax = 100;
const staminaDepleteRate = staminaMax / 20;
const reloadAnimSpeed = 2;

// Other global variables
let canJump = true;
let isWalking = false;
let isCrouching = false;
let activeWeapon = 'pistol'; // 'pistol' | 'shotgun'
let weaponSwitchState = 'idle'; // 'idle' | 'holstering' | 'drawing'
let weaponSwitchProgress = 0;
let pendingWeapon = null;
const WEAPON_SWITCH_SPEED = 4.5;
let isReloading = false;
let isRaisingGun = false;
let reloadAnimProgress = 0;
let stamina = 100;
let shiftPressed = false;
let staminaDepleted = false;
let spawnPosition = new THREE.Vector3(0, 2, 0);

const SPAWN_POINTS = [
    new THREE.Vector3(14.32,  2,  35.91),
    new THREE.Vector3(-19.24, 2,  25.28),
    new THREE.Vector3(-21.67, 2,  -3.41),
    new THREE.Vector3(-17.53, 2, -20.54),
    new THREE.Vector3( 22.89, 2, -20.91),
    new THREE.Vector3(  0.59, 2, -15.57),
];
let lastSpawnIdx = -1;

function pickSpawnPoint() {
    const enemies = getRemotePlayerPositions();
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < SPAWN_POINTS.length; i++) {
        let score;
        if (enemies.length === 0) {
            score = i !== lastSpawnIdx ? 1 : 0;
        } else {
            let minDist = Infinity;
            for (const ep of enemies) {
                const d = SPAWN_POINTS[i].distanceTo(ep);
                if (d < minDist) minDist = d;
            }
            score = minDist + (i !== lastSpawnIdx ? 0.001 : 0);
        }
        if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    lastSpawnIdx = bestIdx;
    return SPAWN_POINTS[bestIdx].clone();
}

let killStreak = 0;
let gunVolume = 1.0;

// ---- SND constants ----
const SND_SITE = { minX: -23.534, maxX: -8.552, minZ: 17.675, maxZ: 30.365 };
const ATTACKER_SPAWNS = [
    new THREE.Vector3(6.14,  2, -13.79),
    new THREE.Vector3(-2.25, 2, -15.21),
];
const DEFENDER_SPAWNS = [
    new THREE.Vector3(25.45, 2, 29.01),
    new THREE.Vector3(25.49, 2, 17.17),
];
const PLANT_DURATION  = 7;
const DEFUSE_DURATION = 12;

// ---- SND state ----
let sndMode         = false;
let myTeam          = null;     // 'attacker' | 'defender'
let hasBomb         = false;
let isSpectating    = false;
let sndPhase        = 'waiting';
let bombWorldPos    = null;
let bombMesh        = null;
let sndRound        = 0;
let sndAttackerScore = 0;
let sndDefenderScore = 0;
let isPlanting      = false;
let isDefusing      = false;
let plantTimer      = 0;
let defuseTimer     = 0;
let _sndRoundStartTimeout = null;
let _sndRoundEndTimeout   = null;
let _bombBeepTimeout      = null;
let _bombSecondsLeft      = 50;
let c4LightMesh           = null;
let c4LightFlashTimer     = 0;
const C4_FLASH_DURATION   = 0.12;

// ---- Grenade constants ----
const GRENADE_MAX        = 2;
const GRENADE_FUSE       = 3.0;
const GRENADE_SPEED      = 14;
const GRENADE_BOUNCE_W   = 0.65;
const GRENADE_BOUNCE_F   = 0.50;
const GRENADE_RADIUS     = 7;
const GRENADE_DMG_MAX    = 60;
const GRENADE_DMG_MIN    = 15;
const GRENADE_RECHARGE   = 20;
let grenadeCount   = GRENADE_MAX;
let grenadeRecharge = 0;
const grenades       = [];
const grenadeFlashes = [];
let footstepVolume = 1.0;
let explosionVolume = 1.0;
let health = 100;
let healthDepleteTimer = 0;
let isDead = false;
let lastHitBy = null;
let lastHitWasMelee = false;
let shakeIntensity = 0;
let shakeAngle = 0;
let isDay = true;
let exrTexture = null;
let wallBoxes = [];
let mapScene = null;
let c4Template = null;

// Add target detection globals
let targetObjects = [];
const raycaster = new THREE.Raycaster();
let targetHitTimeout = null;

// Input handlers
function onKeyDown(event) {
    if (event.code === 'Tab') event.preventDefault();
    if (document.activeElement?.id === 'chat-input') return;
    switch (event.code) {
        case 'Tab': showLeaderboard(); return;
        case 'KeyW': move.forward = true; break;
        case 'KeyA': move.left = true; break;
        case 'KeyS': move.backward = true; break;
        case 'KeyD': move.right = true; break;
        case 'ShiftLeft':
            isWalking = true;
            shiftPressed = true;
            break;
        case 'KeyC':
            isCrouching = !isCrouching;
            playRandomCrouch();
            break;
        case 'KeyN':
            updateDayNightButton();
            break;
        case 'Digit1':
            startWeaponSwitch('shotgun');
            break;
        case 'Digit2':
            startWeaponSwitch('pistol');
            break;
        case 'KeyQ':
            throwPistol();
            break;
        case 'KeyG':
            throwGrenade();
            break;
        case 'KeyE':
            if (sndMode && !isDead) {
                if (sndPhase === 'active' && hasBomb && isInSite() && !isDefusing) {
                    isPlanting = true;
                    broadcastBombPlantingStart(camera.position);
                    startPlantingSound(camera.position);
                }
                if (sndPhase === 'planted' && myTeam === 'defender' && isNearBomb() && !isPlanting) isDefusing = true;
            }
            break;
        case 'KeyF':
            toggleFlashlightSound();
            flashlight.visible = !flashlight.visible;
            flashlight.intensity = flashlight.visible ? 10 : 0;
            document.getElementById('flashlight-indicator')?.classList.toggle('active', flashlight.visible);
            break;
        case 'KeyR':
            if (activeWeapon === 'shotgun') {
                if (shotgunAmmoCurrent < shotgunAmmoMax && shotgunAmmoReserve > 0 && !isReloading) {
                    startShotgunReload();
                }
            } else {
                if (ammoCurrent < ammoMax && ammoReserve > 0 && !isReloading) {
                    isReloading = true;
                    isRaisingGun = false;
                    reloadAnimProgress = 0;
                    reloadSound.stop();
                    reloadSound.onEnded = null;
                    reloadSound.onEnded = () => {
                        const needed = ammoMax - ammoCurrent;
                        const take = Math.min(needed, ammoReserve);
                        ammoCurrent += take;
                        ammoReserve -= take;
                        updateAmmoDisplay();
                        isRaisingGun = true;
                        isReloading = false;
                        reloadSound.onEnded = null;
                        showReloadMessage(false);
                    };
                    reloadSound.play();
                }
            }
            break;
        case 'Space':
            if (canJump && !isCrouching) {
                velocity.y = 7.5;
                canJump = false;
                stamina -= 10;
                if (stamina < 0) stamina = 0;
            }
            break;
        case 'Enter':
            if (gameActive) {
                event.preventDefault();
                controls.unlock();
                const chatRow = document.getElementById('chat-input-row');
                const chatInput = document.getElementById('chat-input');
                if (chatRow) chatRow.style.display = 'flex';
                if (chatInput) { chatInput.focus(); chatInput.value = ''; }
            }
            break;
    }
}

function onKeyUp(event) {
    if (document.activeElement?.id === 'chat-input') return;
    switch (event.code) {
        case 'Tab': hideLeaderboard(); return;
        case 'KeyW': move.forward = false; break;
        case 'KeyA': move.left = false; break;
        case 'KeyS': move.backward = false; break;
        case 'KeyD': move.right = false; break;
        case 'ShiftLeft':
            isWalking = false;
            shiftPressed = false;
            break;
        case 'KeyE':
            if (isPlanting || isDefusing) {
                if (isPlanting) {
                    broadcastBombPlantingStop();
                    stopPlantingSound();
                }
                isPlanting = false;
                isDefusing = false;
                plantTimer = 0;
                defuseTimer = 0;
                updateSndProgressBar(false, 0, 0);
            }
            break;
    }
}

document.addEventListener('keydown', onKeyDown);
document.addEventListener('keyup', onKeyUp);

const textureLoader = new THREE.TextureLoader(loadingManager);
const muzzleTextures = [
    textureLoader.load('muzzle1.png'),
    textureLoader.load('muzzle2.png'),
];
let muzzleFlashTimer = 0;

// Load GLTF model with manager
const loader = new GLTFLoader(loadingManager);
loader.load('fps2.glb', (gltf) => {
    // Pull C4 out before adding scene so it's invisible until planted
    const c4Node = gltf.scene.getObjectByName('C4');
    if (c4Node?.parent) {
        c4Node.parent.remove(c4Node);
        c4Template = c4Node;
        c4Template.traverse(child => {
            if (child.isMesh && child.material) child.material = child.material.clone();
        });
    }

    scene.add(gltf.scene);
    mapScene = gltf.scene;

    gltf.scene.traverse((child) => {
        if (child.isMesh && child.material && 'envMapIntensity' in child.material) {
            child.material.envMapIntensity = 0.5; // Adjust as needed
            child.castShadow = true;
            child.receiveShadow = true;
        }
    });

    wallBoxes = [];
    const wallParent = gltf.scene.getObjectByName('Wall');
    if (wallParent) {
        for (let i = 1; i <= 49; i++) {
            const wallObj = wallParent.getObjectByName(`Wall${i}`);
            if (wallObj) {
                wallBoxes.push(new THREE.Box3().setFromObject(wallObj));
            }
        }
    }
    setWallBoxes(wallBoxes);

    targetObjects = [];
    for (let i = 1; i <= 4; i++) {
        const t = gltf.scene.getObjectByName(`Tar${i}`);
        if (t) targetObjects.push(t);
    }
    // Fallback: collect any object named 'Tar' prefix in case naming differs
    if (targetObjects.length === 0) {
        gltf.scene.traverse((child) => {
            if (child.name && child.name.startsWith('Tar')) targetObjects.push(child);
        });
    }

    let pistol = gltf.scene.getObjectByName('Pistol');
    if (pistol) {
        // Remove pistol from scene if it's already added
        scene.remove(pistol);

        // Attach pistol to camera so it moves with the player
        camera.add(pistol);

        // Set pistol position and rotation relative to camera
        pistol.position.set(0.4, -0.3, -0.8); // Adjust X, Y, Z for desired placement
        pistol.rotation.set(0, -Math.PI / 2, 0); // Adjust for correct orientation

        const pistolFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleTextures[0], transparent: true }));
        pistolFlash.name = 'PistolMuzzleFlash';
        pistolFlash.scale.set(0.15, 0.15, 0.15);
        pistolFlash.position.set(-0.15, 0.04, 0.05);
        pistolFlash.visible = false;
        pistol.add(pistolFlash);

    } else {
        console.warn('Pistol not found in GLB.');
    }

    const shotgunObj = gltf.scene.getObjectByName('Shotgun');
    if (shotgunObj) {
        shotgunObj.removeFromParent();
        camera.add(shotgunObj);
        shotgunObj.position.set(0.3, -0.38, -0.75);
        shotgunObj.rotation.set(0, Math.PI, 0);
        shotgunObj.scale.set(0.5, 0.5, 0.5);
        shotgunObj.visible = false;

        const shotgunFlash = new THREE.Sprite(new THREE.SpriteMaterial({ map: muzzleTextures[0], transparent: true }));
        shotgunFlash.name = 'ShotgunMuzzleFlash';
        shotgunFlash.scale.set(0.5, 0.5, 0.5);
        shotgunFlash.position.set(0, 0.08, 1.55);
        shotgunFlash.visible = false;
        shotgunObj.add(shotgunFlash);
    } else {
        console.warn('Shotgun not found in GLB.');
    }

    // Find the SpawnPoint object
    let spawn = gltf.scene.getObjectByName('spawnPoint');
    if (spawn) {
        camera.position.copy(spawn.getWorldPosition(new THREE.Vector3()));
        spawnPosition.copy(camera.position);
        // Extract only the yaw from the spawn point — copying the full quaternion
        // passes any Blender pitch/roll into PointerLockControls and causes view inversion.
        const spawnEuler = new THREE.Euler().setFromQuaternion(
            spawn.getWorldQuaternion(new THREE.Quaternion()), 'YXZ'
        );
        controls.setRotation(spawnEuler.y, 0);
    } else {
        console.warn('SpawnPoint not found in GLB.');
    }
}, undefined, (error) => {
    console.error('Error loading GLB:', error);
});

// Pointer lock — only after leaving the lobby
document.addEventListener('click', () => {
    if (gameActive) controls.lock();
});

// START OF ALL SOUNDS

// Audio listener
const listener = new THREE.AudioListener();
camera.add(listener);

// Audio loader using manager
const audioLoader = new THREE.AudioLoader(loadingManager);

// Preload flashlight sound once
const flashlightSound = new THREE.Audio(listener);
audioLoader.load('flashlight.mp3', (buffer) => {
    flashlightSound.setBuffer(buffer);
    flashlightSound.setVolume(0.5);
});

// --- Impact audio buffers (ricochet) ---
const ricochetBuffers = [];
audioLoader.load('ri1.mp3', (b) => { ricochetBuffers[0] = b; });
audioLoader.load('ri2.mp3', (b) => { ricochetBuffers[1] = b; });

// Add impact effects state
const impactEffects = [];
let impactTexture = null;

// create a reusable canvas-based impact texture
function createImpactTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    // radial gradient (bright center -> transparent)
    const grad = ctx.createRadialGradient(size / 2, size / 2, 1, size / 2, size / 2, size / 2);
    grad.addColorStop(0, 'rgba(255,255,220,1)');
    grad.addColorStop(0.2, 'rgba(255,205,120,0.9)');
    grad.addColorStop(0.45, 'rgba(255,140,60,0.6)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
}

// spawn impact visual + positional audio at the intersection
function spawnImpactEffect(intersect) {
    if (!impactTexture) impactTexture = createImpactTexture();

    const pos = intersect.point.clone();

    // Sprite visual
    const mat = new THREE.SpriteMaterial({
        map: impactTexture,
        color: 0xffffff,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(pos);
    // offset slightly along normal to avoid z-fighting
    if (intersect.face && intersect.face.normal) {
        const normalWorld = intersect.face.normal.clone().transformDirection(intersect.object.matrixWorld);
        sprite.position.addScaledVector(normalWorld, 0.02);
        // orient sprite to face camera by default; scale along normal a bit
    }
    const baseScale = 0.25;
    sprite.scale.set(baseScale, baseScale, baseScale);
    scene.add(sprite);

    // Positional audio
    if (ricochetBuffers.length > 0) {
        // pick a random ricochet buffer
        const bufIdx = Math.floor(Math.random() * ricochetBuffers.length);
        const buf = ricochetBuffers[bufIdx];
        if (buf) {
            const anchor = new THREE.Object3D();
            anchor.position.copy(pos);
            scene.add(anchor);
            const pAudio = new THREE.PositionalAudio(listener);
            pAudio.setBuffer(buf);
            pAudio.setRefDistance(8);
            pAudio.setVolume(0.7);
            anchor.add(pAudio);
            try { pAudio.play(); } catch (e) { /* play may fail if not user-interacted yet */ }

            // schedule cleanup after sound finishes
            const removeAfter = (buf.duration ? buf.duration * 1000 : 1000) + 200;
            setTimeout(() => {
                try { pAudio.stop(); } catch (e) { }
                anchor.remove(pAudio);
                scene.remove(anchor);
            }, removeAfter);
        }
    }

    // push to impactEffects for lifetime updates
    impactEffects.push({
        sprite,
        createdAt: performance.now(),
        duration: 800, // ms
        baseScale
    });
}

// START - Footstep sound
const footstepSound = new THREE.Audio(listener);
audioLoader.load('indoor_footsteps.mp3', (buffer) => {
    footstepSound.setBuffer(buffer);
    footstepSound.setLoop(true);
    footstepSound.setVolume(footstepVolume);
    initRemoteAudio(listener, buffer);
});

// Play sound when moving
function updateFootstepSound() {
    if ((move.forward || move.backward || move.left || move.right) && !footstepSound.isPlaying) {
        footstepSound.play();
    } else if (!(move.forward || move.backward || move.left || move.right) && footstepSound.isPlaying) {
        footstepSound.stop();
    }
    requestAnimationFrame(updateFootstepSound);
}
updateFootstepSound();
// END - Footstep sound

// START - Gunshot sound + recoil animation
const gunshotSound = new THREE.Audio(listener);
audioLoader.load('9mm.mp3', (buffer) => {
    gunshotSound.setBuffer(buffer);
    gunshotSound.setLoop(false);
    gunshotSound.setVolume(gunVolume);
});

const shotgunSound = new THREE.Audio(listener);
audioLoader.load('shotgun-fire.mp3', (buffer) => {
    shotgunSound.setBuffer(buffer);
    shotgunSound.setLoop(false);
    shotgunSound.setVolume(gunVolume);
});

const maxRecoil = 0.15;
const maxShotgunRecoil = 0.32;
const recoilRecover = 8;
const ammoMax = 10;
const ammoTotal = 64;
const shotgunAmmoMax   = 7;
const shotgunAmmoTotal = 40;
const FIRE_RATE = 0.35;         // pistol — ~2.9 rps
const SHOTGUN_FIRE_RATE = 0.85; // SPAS-12 pump cadence

let recoil = 0;
let shotgunRecoil = 0;
let ammoCurrent = ammoMax;
let fireCooldown = 0;
let ammoReserve = ammoTotal - ammoMax;
let shotgunAmmoCurrent = shotgunAmmoMax;
let shotgunAmmoReserve = shotgunAmmoTotal - shotgunAmmoMax;
let _shotgunReloadInterval = null;

// Empty mag sound
const emptySound = new THREE.Audio(listener);
audioLoader.load('empty.mp3', (buffer) => {
    emptySound.setBuffer(buffer);
    emptySound.setVolume(0.5);
});

// Shooting logic
function shootHandler(event) {
    if (controls.isLocked === true && event.button === 0 && !isDead && fireCooldown <= 0 && !thrownPistol && weaponSwitchState === 'idle') {
        const curAmmo = activeWeapon === 'shotgun' ? shotgunAmmoCurrent : ammoCurrent;
        if (curAmmo > 0) {
            if (activeWeapon === 'shotgun') {
                cancelShotgunReload();
                isReloading = false;
                fireCooldown = SHOTGUN_FIRE_RATE;
                shotgunSound.stop();
                shotgunSound.play();
                shotgunRecoil = maxShotgunRecoil;
                shotgunAmmoCurrent--;
                const sgFlash = camera.getObjectByName('ShotgunMuzzleFlash');
                if (sgFlash) {
                    sgFlash.material.map = muzzleTextures[Math.floor(Math.random() * muzzleTextures.length)];
                    sgFlash.visible = true;
                }
            } else {
                fireCooldown = FIRE_RATE;
                gunshotSound.stop();
                gunshotSound.play();
                recoil = maxRecoil;
                ammoCurrent--;
                const pFlash = camera.getObjectByName('PistolMuzzleFlash');
                if (pFlash) {
                    pFlash.material.map = muzzleTextures[Math.floor(Math.random() * muzzleTextures.length)];
                    pFlash.visible = true;
                }
            }
            muzzleFlashTimer = 0.08;
            updateAmmoDisplay();

            broadcastShoot(activeWeapon);

            // Raycast from camera for target and remote player hits
            const origin = new THREE.Vector3();
            const dir = new THREE.Vector3();
            camera.getWorldPosition(origin);
            camera.getWorldDirection(dir);

            function firePellet(pelletDir, bodyDmg, headDmg) {
                raycaster.set(origin, pelletDir);
                let hitTarget = false;
                if (targetObjects.length > 0) {
                    const tHits = raycaster.intersectObjects(targetObjects, true);
                    if (tHits.length > 0) { hitTarget = true; spawnImpactEffect(tHits[0]); }
                }
                let wallHit = null;
                if (mapScene) {
                    const wHits = raycaster.intersectObject(mapScene, true);
                    if (wHits.length > 0) wallHit = wHits[0];
                }
                const remoteHit = getRemotePlayerHit(raycaster);
                if (remoteHit && (!wallHit || wallHit.distance > remoteHit.intersect.distance)) {
                    const dist = camera.position.distanceTo(remoteHit.intersect.point);
                    const dmg = applyDamageFalloff(remoteHit.isHeadshot ? headDmg : bodyDmg, dist, activeWeapon === 'shotgun');
                    broadcastPlayerHit(remoteHit.playerId, dmg);
                    spawnImpactEffect(remoteHit.intersect);
                    showHitPopup(remoteHit.bodyPos, dmg, remoteHit.isHeadshot);
                    spawnBloodEffect(remoteHit.intersect.point);
                } else if (wallHit) {
                    spawnBulletHole(wallHit);
                }
                return hitTarget;
            }

            if (activeWeapon === 'shotgun') {
                const PELLETS = 8, SPREAD = 0.06;
                const right = new THREE.Vector3();
                const up = new THREE.Vector3();
                if (Math.abs(dir.y) < 0.9) right.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
                else right.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
                up.crossVectors(right, dir);
                let anyTarget = false;
                for (let i = 0; i < PELLETS; i++) {
                    const r = SPREAD * Math.sqrt(Math.random());
                    const theta = Math.random() * Math.PI * 2;
                    const pelletDir = dir.clone()
                        .addScaledVector(right, r * Math.cos(theta))
                        .addScaledVector(up, r * Math.sin(theta))
                        .normalize();
                    if (firePellet(pelletDir, 20, 45)) anyTarget = true;
                }
                if (anyTarget) { score += 1; setScore(score); showTargetHitMessage(); showScorePlus(); }
            } else {
                if (firePellet(dir, 15, 25)) { score += 1; setScore(score); showTargetHitMessage(); showScorePlus(); }
            }
        } else {
            emptySound.stop();
            emptySound.play();
        }
    }
}
document.addEventListener('mousedown', shootHandler);
// END - Gunshot sound + recoil animation

// START - Reload sound
const reloadSound = new THREE.Audio(listener);
audioLoader.load('mag.mp3', (buffer) => {
    reloadSound.setBuffer(buffer);
    reloadSound.setVolume(0.5);
});

const shotgunReloadSound = new THREE.Audio(listener);
audioLoader.load('shotgun-reload.mp3', (buffer) => {
    shotgunReloadSound.setBuffer(buffer);
    shotgunReloadSound.setVolume(0.6);
});
// END - Reload sound

// Ouch sound (grunts)
const ouchSounds = [];
for (let i = 1; i <= 12; i++) {
    const sound = new THREE.Audio(listener);
    audioLoader.load(`Grunts/g${i}.mp3`, (buffer) => {
        sound.setBuffer(buffer);
        sound.setVolume(0.5);
    });
    ouchSounds.push(sound);
}

let lastOuchIdx = -1;
function playRandomOuch() {
    let idx;
    do {
        idx = Math.floor(Math.random() * ouchSounds.length);
    } while (idx === lastOuchIdx && ouchSounds.length > 1);
    lastOuchIdx = idx;
    ouchSounds[idx].stop();
    ouchSounds[idx].play();
}

// Death sound
const deathSound = new THREE.Audio(listener);
audioLoader.load('death.mp3', (buffer) => {
    deathSound.setBuffer(buffer);
    deathSound.setVolume(0.8);
});

// Remote player gunshot (positional — spatialized at the shooter's position)
document.addEventListener('remote-gunshot', (e) => {
    const isShotgun = e.detail.weapon === 'shotgun';
    const buf = isShotgun ? shotgunSound.buffer : gunshotSound.buffer;
    if (!buf) return;
    const sound = new THREE.PositionalAudio(listener);
    sound.setBuffer(buf);
    sound.setVolume(gunVolume);
    sound.setRefDistance(4);
    sound.setRolloffFactor(1.5);
    const carrier = new THREE.Object3D();
    carrier.position.copy(e.detail.position);
    scene.add(carrier);
    carrier.add(sound);
    sound.play();
    sound.onEnded = () => scene.remove(carrier);
});

// Remote player explosion sound (positional — spatialized at the exploding model)
let explosionBuffer = null;
audioLoader.load('deltarune-explosion.mp3', (buffer) => { explosionBuffer = buffer; });

// ---- SND voice lines (loaded outside loading manager so they don't delay the loading screen) ----
const sndVoiceLoader          = new THREE.AudioLoader();
const sndVoiceYouHaveTheBomb  = new THREE.Audio(listener);
const sndVoiceAttackerIntro   = new THREE.Audio(listener);
const sndVoiceDefenderIntro   = new THREE.Audio(listener);
const sndVoiceAttackersWin    = new THREE.Audio(listener);
const sndVoiceBombPlanted     = new THREE.Audio(listener);
const sndVoiceDefendersWin    = [new THREE.Audio(listener), new THREE.Audio(listener)];
const sndBombBeep             = new THREE.PositionalAudio(listener);
sndBombBeep.setRefDistance(8);

const plantingAudioObj        = new THREE.Object3D();
scene.add(plantingAudioObj);
const sndBombPlanting         = new THREE.PositionalAudio(listener);
sndBombPlanting.setRefDistance(8);
sndBombPlanting.setLoop(true);
plantingAudioObj.add(sndBombPlanting);

sndVoiceLoader.load('you-have-the-bomb.wav',    b => { sndVoiceYouHaveTheBomb.setBuffer(b); });
sndVoiceLoader.load('attacker-intro.wav',        b => { sndVoiceAttackerIntro.setBuffer(b); });
sndVoiceLoader.load('defenders-intro.wav',       b => { sndVoiceDefenderIntro.setBuffer(b); });
sndVoiceLoader.load('attackers-win.wav',         b => { sndVoiceAttackersWin.setBuffer(b); });
sndVoiceLoader.load('bomb-has-been-planted.wav', b => { sndVoiceBombPlanted.setBuffer(b); });
sndVoiceLoader.load('bomb-defused.wav',          b => { sndVoiceDefendersWin[0].setBuffer(b); });
sndVoiceLoader.load('defenders-win.wav',         b => { sndVoiceDefendersWin[1].setBuffer(b); });
sndVoiceLoader.load('bomb-beep.mp3',             b => { sndBombBeep.setBuffer(b); });
sndVoiceLoader.load('bomb-planting.mp3',         b => { sndBombPlanting.setBuffer(b); });
document.addEventListener('player-exploded', (e) => {
    if (!explosionBuffer) return;
    const sound = new THREE.PositionalAudio(listener);
    sound.setBuffer(explosionBuffer);
    sound.setVolume(explosionVolume);
    sound.setRefDistance(3);
    sound.setRolloffFactor(1.5);
    const carrier = new THREE.Object3D();
    carrier.position.copy(e.detail.position);
    scene.add(carrier);
    carrier.add(sound);
    sound.play();
    sound.onEnded = () => scene.remove(carrier);
});

document.addEventListener('remote-grenade-thrown', (e) => {
    const { position, velocity } = e.detail;
    const pos = new THREE.Vector3(position.x, position.y, position.z);
    const vel = new THREE.Vector3(velocity.x, velocity.y, velocity.z);
    const g = spawnGrenadeObject(pos, vel);
    g.isRemote = true;
    grenades.push(g);
});

document.addEventListener('remote-pistol-thrown', (e) => {
    const { id, position, velocity } = e.detail;
    const pistolObj = camera.getObjectByName('Pistol');
    if (!pistolObj) return;
    const clone = pistolObj.clone();
    clone.position.set(position.x, position.y, position.z);
    clone.visible = true;
    scene.add(clone);
    remoteThrownPistols.set(id, {
        mesh: clone,
        velocity: new THREE.Vector3(velocity.x, velocity.y, velocity.z),
        age: 0,
    });
});

document.addEventListener('remote-pistol-returned', (e) => {
    const rp = remoteThrownPistols.get(e.detail.id);
    if (rp) { scene.remove(rp.mesh); remoteThrownPistols.delete(e.detail.id); }
});

document.addEventListener('player-left', (e) => {
    const rp = remoteThrownPistols.get(e.detail.id);
    if (rp) { scene.remove(rp.mesh); remoteThrownPistols.delete(e.detail.id); }
});

// Crouch sound
const crouchSounds = [];
const crouchFiles = ['crouch-up.mp3', 'crouch-down.mp3'];
crouchFiles.forEach((file) => {
    const sound = new THREE.Audio(listener);
    audioLoader.load(file, (buffer) => {
        sound.setBuffer(buffer);
        sound.setVolume(0.5);
    });
    crouchSounds.push(sound);
});

let lastCrouchIdx = -1;
function playRandomCrouch() {
    let idx;
    do {
        idx = Math.floor(Math.random() * crouchSounds.length);
    } while (idx === lastCrouchIdx && crouchSounds.length > 1);
    lastCrouchIdx = idx;
    crouchSounds[idx].stop();
    crouchSounds[idx].play();
}

// Flashlight toggle sound
function toggleFlashlightSound() {
    if (flashlightSound && flashlightSound.buffer) {
        flashlightSound.stop();
        flashlightSound.play();
    } else {
        // fallback: if not yet loaded, don't call audioLoader.load per-toggle
        // (preload should normally have filled flashlightSound)
        console.warn('Flashlight sound not loaded yet.');
    }
}

// START - HDRI Environment (use manager)
const exrLoader = new EXRLoader(loadingManager);
const pmremGenerator = new THREE.PMREMGenerator(renderer);

exrLoader.load('qwant.exr', (texture) => {
    exrTexture = texture;
    const envMap = pmremGenerator.fromEquirectangular(texture).texture;
    scene.environment = envMap;
    scene.background = null;
    // keep texture object (do not dispose here if you want to reuse later)
    // texture.dispose(); pmremGenerator.dispose(); // avoid disposing so day toggle can reuse
});

// Day-Night toggle function (uses dayNightBtn if available)
function updateDayNightButton() {
    isDay = !isDay;
    if (isDay) {
        sun.visible = true;
        sun.intensity = 0.4;
        ambient.intensity = 0.2;
        scene.background = null;
        // Enable HDR if loaded
        if (exrTexture) {
            const envMap = pmremGenerator.fromEquirectangular(exrTexture).texture;
            scene.environment = envMap;
        }
        if (dayNightBtn && dayNightBtn.querySelector) {
            const img = dayNightBtn.querySelector('img');
            if (img) img.src = 'night.png';
        }
    } else {
        sun.visible = false;
        ambient.intensity = 0.18;
        scene.background = new THREE.Color(0x10131a);
        scene.environment = null;
        if (dayNightBtn && dayNightBtn.querySelector) {
            const img = dayNightBtn.querySelector('img');
            if (img) img.src = 'day.png';
        }
    }
}

// START - UI ELEMENTS
function showTargetHitMessage(text = 'Target Hit!', duration = 2000, noRestore = false) {
    const el = document.getElementById('target-hit-msg');
    if (!el) {
        console.log(text);
        return;
    }

    // Save previous text only when we plan to restore it
    const prevText = noRestore ? '' : el.textContent;

    el.textContent = text;
    el.classList.add('visible');

    if (targetHitTimeout) {
        clearTimeout(targetHitTimeout);
        targetHitTimeout = null;
    }

    targetHitTimeout = setTimeout(() => {
        el.classList.remove('visible');
        // restore previous text only if requested
        if (!noRestore) el.textContent = prevText;
        targetHitTimeout = null;
    }, duration);
}

function setHealthBar(healthPercent) {
    const fill = document.getElementById('healthbar-fill');
    if (fill) {
        fill.style.width = `${Math.max(0, Math.min(healthPercent, 100))}%`;
    }
    const healthValueElem = document.getElementById('health-value');
    if (healthValueElem) {
        healthValueElem.textContent = Math.round(healthPercent);
    }
}
setHealthBar(100);

function setStaminaBar(staminaPercent) {
    const fill = document.getElementById('stamina-fill');
    if (fill) {
        fill.style.width = `${Math.max(0, Math.min(staminaPercent, 100))}%`;
    }
    const staminaElem = document.getElementById('stamina-value');
    if (staminaElem) {
        staminaElem.textContent = Math.round(stamina);
    }
}
setStaminaBar(100);

// Update ammo display
function updateAmmoDisplay() {
    const isShotgun = activeWeapon === 'shotgun';
    const cur = isShotgun ? shotgunAmmoCurrent : ammoCurrent;
    const res = isShotgun ? shotgunAmmoReserve : ammoReserve;
    const ammoCurrentElem = document.getElementById('ammo-current');
    const ammoTotalElem = document.getElementById('ammo-total');
    if (ammoCurrentElem) ammoCurrentElem.textContent = cur;
    if (ammoTotalElem) ammoTotalElem.textContent = res;
    const gunIcon = document.getElementById('gun-icon');
    if (gunIcon) gunIcon.src = isShotgun ? 'shotgun.png' : 'pistol.png';
    showReloadMessage(cur === 0 && res > 0 && !isReloading);
}

function showReloadMessage(show) {
    const msg = document.getElementById('reload-message');
    if (msg) {
        if (show) {
            msg.style.display = 'block';
            msg.classList.add('flashing');
        } else {
            msg.style.display = 'none';
            msg.classList.remove('flashing');
        }
    }
}

const STAMINA_MSG_TEXT = "I need to rest or walk to regain stamina, or I'll start to lose health.";
let _staminaMsgActive = false;      // true while message is on screen (typing or fully typed)
let _staminaMsgInterval = null;     // typewriter interval
let _staminaMsgFadeTimeout = null;  // hide-after-fade timeout
let _staminaMsgTypingDone = false;  // true once all characters have been typed
let _staminaMsgFadePending = false; // fade was requested before typing finished

function _doFadeStaminaMsg() {
    const msg = document.getElementById('stamina-message');
    if (!msg) return;
    _staminaMsgActive = false;
    _staminaMsgFadePending = false;
    msg.style.opacity = '0';
    _staminaMsgFadeTimeout = setTimeout(() => {
        msg.style.display = 'none';
        msg.textContent = '';
        _staminaMsgFadeTimeout = null;
        _staminaMsgTypingDone = false;
    }, 2000);
}

function showStaminaMessage() {
    const msg = document.getElementById('stamina-message');
    if (!msg || _staminaMsgActive || _staminaMsgFadeTimeout) return;
    _staminaMsgActive = true;
    _staminaMsgTypingDone = false;
    _staminaMsgFadePending = false;
    msg.style.display = 'block';
    msg.style.opacity = '1';
    msg.textContent = '';
    let i = 0;
    _staminaMsgInterval = setInterval(() => {
        msg.textContent = STAMINA_MSG_TEXT.slice(0, ++i);
        if (i >= STAMINA_MSG_TEXT.length) {
            clearInterval(_staminaMsgInterval);
            _staminaMsgInterval = null;
            _staminaMsgTypingDone = true;
            if (_staminaMsgFadePending) _doFadeStaminaMsg();
        }
    }, 38);
}

function hideStaminaMessage() {
    if (!_staminaMsgActive) return;
    if (!_staminaMsgTypingDone) {
        _staminaMsgFadePending = true; // wait until typing completes
    } else {
        _doFadeStaminaMsg();
    }
}

// Scoreboard
let score = 0;
function setScore(val) {
    score = val;
    const scoreboardValue = document.getElementById('scoreboard-value');
    if (scoreboardValue) scoreboardValue.textContent = score;
    const hudScoreValue = document.getElementById('hud-score-value');
    if (hudScoreValue) hudScoreValue.textContent = score;
}

let scorePlusTimeout = null;
function showScorePlus() {
    const el = document.getElementById('score-plus');
    if (!el) return;
    // restart animation
    el.classList.remove('visible');
    // force reflow to allow restarting the transition
    void el.offsetWidth;
    el.classList.add('visible');
    if (scorePlusTimeout) clearTimeout(scorePlusTimeout);
    scorePlusTimeout = setTimeout(() => {
        el.classList.remove('visible');
        scorePlusTimeout = null;
    }, 1000); // visible for ~1s (matches requested duration)
}

// Leaderboard
function showLeaderboard() {
    const overlay = document.getElementById('leaderboard-overlay');
    const tbody = document.getElementById('leaderboard-tbody');
    if (!overlay || !tbody || !gameActive) return;
    const rows = getLeaderboardData();
    tbody.innerHTML = '';
    rows.forEach((row, i) => {
        const kd = row.deaths === 0
            ? (row.kills > 0 ? '∞' : '-')
            : (row.kills / row.deaths).toFixed(2);
        const tr = document.createElement('tr');
        if (row.isLocal) tr.className = 'lb-row-local';
        tr.innerHTML =
            `<td class="lb-rank">#${i + 1}</td>` +
            `<td><span style="color:${row.color};font-weight:700">${row.name}</span>${row.isLocal ? ' <span style="color:#4a5568;font-size:11px">(you)</span>' : ''}</td>` +
            `<td class="lb-kills">${row.kills}</td>` +
            `<td class="lb-deaths">${row.deaths}</td>` +
            `<td class="lb-kd">${kd}</td>`;
        tbody.appendChild(tr);
    });
    overlay.style.display = 'block';
}

function hideLeaderboard() {
    const overlay = document.getElementById('leaderboard-overlay');
    if (overlay) overlay.style.display = 'none';
}

function startWeaponSwitch(target) {
    if (target === activeWeapon && weaponSwitchState === 'idle') return;
    if (target === pendingWeapon) return;
    if (thrownPistol) return;
    pendingWeapon = target;
    weaponSwitchState = 'holstering';
    weaponSwitchProgress = 0;
    if (isReloading) { cancelShotgunReload(); isReloading = false; }
    isRaisingGun = false;
    reloadAnimProgress = 0;
}

// Screen shake
function setActiveWeapon(weapon) {
    activeWeapon = weapon;
    const shotgunMesh = camera.getObjectByName('Shotgun');
    const pistolMesh  = camera.getObjectByName('Pistol');
    if (shotgunMesh) shotgunMesh.visible = weapon === 'shotgun';
    if (pistolMesh)  pistolMesh.visible  = weapon === 'pistol' && !thrownPistol;
    updateAmmoDisplay();
}

function cancelShotgunReload() {
    if (_shotgunReloadInterval) {
        clearInterval(_shotgunReloadInterval);
        _shotgunReloadInterval = null;
    }
    if (shotgunReloadSound.isPlaying) shotgunReloadSound.stop();
}

function startShotgunReload() {
    isReloading = true;
    isRaisingGun = false;
    reloadAnimProgress = 0;
    cancelShotgunReload();

    shotgunReloadSound.onEnded = () => {
        if (!isReloading) return;
        if (_shotgunReloadInterval) {
            clearInterval(_shotgunReloadInterval);
            _shotgunReloadInterval = null;
        }
        isReloading = false;
        isRaisingGun = reloadAnimProgress > 0;
        updateAmmoDisplay();
    };

    shotgunReloadSound.play();

    _shotgunReloadInterval = setInterval(() => {
        if (!isReloading || shotgunAmmoCurrent >= shotgunAmmoMax || shotgunAmmoReserve <= 0) {
            if (_shotgunReloadInterval) {
                clearInterval(_shotgunReloadInterval);
                _shotgunReloadInterval = null;
            }
            isReloading = false;
            isRaisingGun = reloadAnimProgress > 0;
            if (shotgunReloadSound.isPlaying) shotgunReloadSound.stop();
            updateAmmoDisplay();
            return;
        }
        shotgunAmmoCurrent++;
        shotgunAmmoReserve--;
        updateAmmoDisplay();
    }, 440);
}

function triggerShake(intensity) {
    shakeIntensity = Math.max(shakeIntensity, intensity);
    shakeAngle = Math.random() * Math.PI * 2;
}

function showDamageIndicator(shooterId) {
    const attackerPos = getRemotePlayerPosition(shooterId);
    const container = document.getElementById('damage-indicators');
    if (!container) return;

    let angleDeg = 0;
    if (attackerPos) {
        const forward = new THREE.Vector3();
        camera.getWorldDirection(forward);
        const dx = attackerPos.x - camera.position.x;
        const dz = attackerPos.z - camera.position.z;
        const forwardAngle = Math.atan2(forward.x, forward.z);
        const attackerAngle = Math.atan2(dx, dz);
        let rel = forwardAngle - attackerAngle;
        while (rel > Math.PI) rel -= 2 * Math.PI;
        while (rel < -Math.PI) rel += 2 * Math.PI;
        angleDeg = rel * (180 / Math.PI);
    }

    const el = document.createElement('div');
    el.className = 'dmg-indicator';
    el.style.transform = `rotate(${angleDeg}deg)`;
    container.appendChild(el);

    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('fade')));
    setTimeout(() => el.remove(), 1700);
}

// ---- Grenade system ----
function updateGrenadeUI() {
    const el = document.getElementById('grenade-count');
    if (el) el.textContent = grenadeCount;
    const info = document.getElementById('grenade-info');
    if (info) info.style.opacity = grenadeCount === 0 ? '0.4' : '1';
}

function playGrenadeExplosionSound(pos) {
    if (!explosionBuffer) return;
    const sound = new THREE.PositionalAudio(listener);
    sound.setBuffer(explosionBuffer);
    sound.setVolume(explosionVolume);
    sound.setRefDistance(4);
    sound.setRolloffFactor(1.5);
    const carrier = new THREE.Object3D();
    carrier.position.copy(pos);
    scene.add(carrier);
    carrier.add(sound);
    sound.play();
    sound.onEnded = () => scene.remove(carrier);
}

function spawnGrenadeFlash(pos) {
    const geo = new THREE.SphereGeometry(0.4, 10, 10);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff7700, transparent: true, opacity: 0.9, depthWrite: false });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.position.copy(pos);
    scene.add(sphere);
    grenadeFlashes.push({ sphere, geo, mat, t: 0 });
}

function spawnGrenadeObject(pos, vel) {
    const geo = new THREE.SphereGeometry(0.1, 8, 8);
    const mat = new THREE.MeshLambertMaterial({ color: 0x3a5c3a });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.position.copy(pos);
    scene.add(mesh);
    return { mesh, geo, mat, velocity: vel.clone(), timer: 0, fuse: GRENADE_FUSE, isRemote: false };
}

function grenadeExplode(g, idx) {
    const pos = g.mesh.position.clone();
    scene.remove(g.mesh);
    g.geo.dispose();
    g.mat.dispose();
    grenades.splice(idx, 1);

    spawnGrenadeFlash(pos);
    playGrenadeExplosionSound(pos);

    const distToSelf = pos.distanceTo(camera.position);
    if (distToSelf < GRENADE_RADIUS * 1.5) {
        triggerShake(0.014 * Math.max(0, 1 - distToSelf / (GRENADE_RADIUS * 1.5)));
    }

    if (!g.isRemote) {
        // Remote players
        getPlayersInRange(pos, GRENADE_RADIUS).forEach(({ id, dist }) => {
            const t = dist / GRENADE_RADIUS;
            const dmg = Math.round(GRENADE_DMG_MAX - t * (GRENADE_DMG_MAX - GRENADE_DMG_MIN));
            broadcastPlayerHit(id, dmg);
            showHitPopup(pos, dmg, false);
        });

        // Self-damage
        if (distToSelf <= GRENADE_RADIUS && !isDead) {
            const t = distToSelf / GRENADE_RADIUS;
            const selfDmg = Math.round(GRENADE_DMG_MAX - t * (GRENADE_DMG_MAX - GRENADE_DMG_MIN));
            health = Math.max(0, health - selfDmg);
            setHealthBar(health);
            triggerShake(selfDmg * 0.0018);
            if (health <= 0) triggerDeath();
        }
    }
}

function throwGrenade() {
    if (grenadeCount <= 0 || isDead) return;
    grenadeCount--;
    updateGrenadeUI();

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    const pos = camera.position.clone().add(forward.clone().multiplyScalar(0.6));
    const vel = forward.clone().multiplyScalar(GRENADE_SPEED);
    vel.y += 5;

    grenades.push(spawnGrenadeObject(pos, vel));
    broadcastGrenadeThrow(pos, vel);
}

// Damage falloff — pistol: full ≤8 units, linear to 55% at ≥25 units
//                  shotgun: full ≤5 units, quadratic to 20% at ≥18 units (pellets lose energy fast)
function applyDamageFalloff(base, dist, isShotgun = false) {
    if (isShotgun) {
        const FULL = 5, FAR = 18, MIN_F = 0.20;
        if (dist <= FULL) return base;
        if (dist >= FAR)  return Math.max(1, Math.round(base * MIN_F));
        const t = (dist - FULL) / (FAR - FULL);
        return Math.max(1, Math.round(base * (1 - t * t * (1 - MIN_F))));
    }
    const FULL = 8, FAR = 25, MIN_F = 0.55;
    if (dist <= FULL) return base;
    if (dist >= FAR)  return Math.max(1, Math.round(base * MIN_F));
    const t = (dist - FULL) / (FAR - FULL);
    return Math.max(1, Math.round(base * (1 - t * (1 - MIN_F))));
}

// === Bullet hole decals ===
const MAX_BULLET_HOLES = 50;
const bulletHoles = [];
let bulletHoleTexture = null;

function createBulletHoleTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    grad.addColorStop(0, 'rgba(8,4,4,1)');
    grad.addColorStop(0.4, 'rgba(20,10,8,0.85)');
    grad.addColorStop(0.7, 'rgba(35,18,12,0.35)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

function spawnBulletHole(intersect) {
    if (!bulletHoleTexture) bulletHoleTexture = createBulletHoleTexture();
    const mat = new THREE.SpriteMaterial({ map: bulletHoleTexture, transparent: true, depthWrite: false });
    const sprite = new THREE.Sprite(mat);
    const pos = intersect.point.clone();
    if (intersect.face) {
        const normal = intersect.face.normal.clone().transformDirection(intersect.object.matrixWorld).normalize();
        pos.addScaledVector(normal, 0.03);
    }
    sprite.position.copy(pos);
    sprite.scale.set(0.18, 0.18, 0.18);
    scene.add(sprite);
    if (bulletHoles.length >= MAX_BULLET_HOLES) {
        const oldest = bulletHoles.shift();
        scene.remove(oldest.sprite);
        oldest.sprite.material.dispose();
    }
    bulletHoles.push({ sprite, mat, born: performance.now(), duration: 6000 });
}

// === Blood splatter ===
const bloodParticles = [];
let bloodTexture = null;

function createBloodTexture() {
    const size = 32;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');
    const cx = size / 2;
    const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
    grad.addColorStop(0, 'rgba(200,0,0,1)');
    grad.addColorStop(0.5, 'rgba(140,0,0,0.8)');
    grad.addColorStop(1, 'rgba(80,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
    return new THREE.CanvasTexture(canvas);
}

function spawnBloodEffect(position) {
    if (!bloodTexture) bloodTexture = createBloodTexture();
    const count = 5 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
        const mat = new THREE.SpriteMaterial({ map: bloodTexture, transparent: true, depthWrite: false });
        const sprite = new THREE.Sprite(mat);
        sprite.position.copy(position);
        const sz = 0.08 + Math.random() * 0.12;
        sprite.scale.set(sz, sz, sz);
        scene.add(sprite);
        const vel = new THREE.Vector3(
            (Math.random() - 0.5) * 6,
            Math.random() * 5 + 2,
            (Math.random() - 0.5) * 6
        );
        bloodParticles.push({ sprite, mat, vel, born: performance.now(), duration: 500 });
    }
}

// === Thrown pistol ===
const PISTOL_THROW_SPEED    = 18;
const PISTOL_GRAVITY        = 14;
const PISTOL_MAX_FLIGHT     = 4.5;
const PISTOL_RETURN_DELAY   = 2.0;   // wait after hitting a player
const PISTOL_RETURN_SPEED   = 24;
let thrownPistol = null;              // { mesh, velocity, age, hitSomeone, returning, returnTimer }
const remoteThrownPistols = new Map(); // playerId -> { mesh, velocity, age }

function throwPistol() {
    if (!controls.isLocked || isDead || thrownPistol) return;
    const pistolObj = camera.getObjectByName('Pistol');
    if (!pistolObj) return;

    // Capture world transform before cloning
    const worldPos = new THREE.Vector3();
    const worldQuat = new THREE.Quaternion();
    const worldScale = new THREE.Vector3();
    pistolObj.matrixWorld.decompose(worldPos, worldQuat, worldScale);

    const clone = pistolObj.clone();
    clone.position.copy(worldPos);
    clone.quaternion.copy(worldQuat);
    clone.scale.copy(worldScale);
    scene.add(clone);

    // Throw direction: forward with a slight upward arc
    const dir = new THREE.Vector3();
    camera.getWorldDirection(dir);
    dir.y += 0.15;
    dir.normalize();
    const vel = dir.clone().multiplyScalar(PISTOL_THROW_SPEED);

    thrownPistol = { mesh: clone, velocity: vel, age: 0, hitSomeone: false, returning: false, returnTimer: 0 };
    broadcastPistolThrow(worldPos, vel);
}


// Damage number popups
function showHitPopup(worldPoint, damage, isHeadshot) {
    const projected = worldPoint.clone().project(camera);
    const x = (projected.x + 1) / 2 * window.innerWidth;
    const y = (-projected.y + 1) / 2 * window.innerHeight;
    const el = document.createElement('div');
    el.className = 'hit-popup';
    el.textContent = damage;
    el.style.color = isHeadshot ? '#ff4c4c' : '#ffd700';
    el.style.left = (x + (Math.random() - 0.5) * 44) + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 800);
}

// Kill streak announcement
function showStreakAnnouncement(text, color) {
    const el = document.getElementById('streak-announcement');
    if (!el) return;
    el.textContent = text;
    el.style.color = color;
    el.classList.remove('streak-active');
    void el.offsetWidth;
    el.classList.add('streak-active');
}

document.addEventListener('my-kill', () => {
    killStreak++;
    if (killStreak === 3) showStreakAnnouncement('TRIPLE KILL', '#f6e05e');
    else if (killStreak === 5) showStreakAnnouncement('RAMPAGE', '#fc8181');
    else if (killStreak === 6) showStreakAnnouncement('UNSTOPPABLE', '#f687b3');
});

// Death and respawn
function triggerDeath() {
    isDead = true;
    health = 0;
    killStreak = 0;
    setHealthBar(0);
    velocity.set(0, 0, 0);
    deathSound.stop();
    deathSound.play();
    controls.unlock();
    broadcastDeath(lastHitBy, lastHitWasMelee);
    lastHitBy = null;
    lastHitWasMelee = false;
    isPlanting = false;
    isDefusing = false;
    plantTimer = 0;
    defuseTimer = 0;
    updateSndProgressBar(false, 0, 0);

    if (thrownPistol) {
        scene.remove(thrownPistol.mesh);
        thrownPistol = null;
        const p = camera.getObjectByName('Pistol');
        if (p) p.visible = true;
    }

    if (sndMode) {
        isSpectating = true;
        const spectateEl = document.getElementById('snd-spectate-overlay');
        if (spectateEl) spectateEl.style.display = 'flex';
        const plantEl  = document.getElementById('snd-plant-prompt');
        const defuseEl = document.getElementById('snd-defuse-prompt');
        if (plantEl)  plantEl.style.display  = 'none';
        if (defuseEl) defuseEl.style.display = 'none';
        return;
    }

    const overlay = document.getElementById('death-overlay');
    if (overlay) overlay.style.display = 'flex';
    const timerEl = document.getElementById('respawn-timer');

    let countdown = 3;
    if (timerEl) timerEl.textContent = countdown;
    const interval = setInterval(() => {
        countdown--;
        if (timerEl) timerEl.textContent = Math.max(0, countdown);
        if (countdown <= 0) {
            clearInterval(interval);
            respawn();
        }
    }, 1000);
}

function respawn() {
    isDead = false;
    health = 100;
    stamina = staminaMax;
    ammoCurrent = ammoMax;
    ammoReserve = ammoTotal - ammoMax;
    shotgunAmmoCurrent = shotgunAmmoMax;
    shotgunAmmoReserve = shotgunAmmoTotal - shotgunAmmoMax;
    velocity.set(0, 0, 0);
    controlsObject.position.copy(pickSpawnPoint());
    controls.setRotation(controls._yaw, 0); // keep current yaw, reset pitch to level
    isCrouching = false;
    cancelShotgunReload();
    isReloading = false;
    setHealthBar(100);
    setStaminaBar(100);
    updateAmmoDisplay();
    grenadeCount = GRENADE_MAX;
    grenadeRecharge = 0;
    updateGrenadeUI();
    broadcastRespawn();
    const overlay = document.getElementById('death-overlay');
    if (overlay) overlay.style.display = 'none';
}

// ===== SND helpers =====
function playSndVoice(sound) {
    if (!sound?.buffer) return;
    if (sound.isPlaying) sound.stop();
    sound.play();
}

function startBombBeep() {
    stopBombBeep();
    function tick() {
        if (sndPhase !== 'planted') return;
        if (sndBombBeep.buffer) {
            if (sndBombBeep.isPlaying) sndBombBeep.stop();
            sndBombBeep.play();
        }
        triggerC4Flash();
        // Interval shrinks linearly from 1000ms at 50s left to 150ms at ~7.5s left
        const interval = Math.max(150, 1000 * (_bombSecondsLeft / 50));
        _bombBeepTimeout = setTimeout(tick, interval);
    }
    tick();
}

function stopBombBeep() {
    if (_bombBeepTimeout) { clearTimeout(_bombBeepTimeout); _bombBeepTimeout = null; }
    if (sndBombBeep.isPlaying) sndBombBeep.stop();
    c4LightFlashTimer = 0;
    if (c4LightMesh?.material) c4LightMesh.material.emissiveIntensity = 0;
}

function triggerC4Flash() {
    c4LightFlashTimer = C4_FLASH_DURATION;
}

function startPlantingSound(position) {
    plantingAudioObj.position.set(position.x, position.y, position.z);
    if (sndBombPlanting.buffer && !sndBombPlanting.isPlaying) sndBombPlanting.play();
}

function stopPlantingSound() {
    if (sndBombPlanting.isPlaying) sndBombPlanting.stop();
}

function isInSite() {
    const p = camera.position;
    return p.x >= SND_SITE.minX && p.x <= SND_SITE.maxX &&
           p.z >= SND_SITE.minZ && p.z <= SND_SITE.maxZ;
}

function isNearBomb() {
    if (!bombWorldPos) return false;
    const dx = camera.position.x - bombWorldPos.x;
    const dz = camera.position.z - bombWorldPos.z;
    return Math.sqrt(dx * dx + dz * dz) < 2.5;
}

function spawnPlantedBomb(position) {
    removePlantedBomb(); // clean up any previous instance first
    const floorY = Math.max(0.18, position.y - 1.9);

    if (c4Template) {
        bombMesh = c4Template.clone();
        bombMesh.traverse(child => {
            if (child.isMesh && child.material) child.material = child.material.clone();
        });
        c4LightMesh = bombMesh.getObjectByName('C4_Light');
        if (c4LightMesh?.material) {
            c4LightMesh.material.emissive = new THREE.Color(0xff0000);
            c4LightMesh.material.emissiveIntensity = 0;
        }
    } else {
        // Fallback if C4 model not found in GLB
        const geo = new THREE.SphereGeometry(0.18, 10, 10);
        const mat = new THREE.MeshLambertMaterial({ color: 0xff3300 });
        bombMesh = new THREE.Mesh(geo, mat);
    }

    bombMesh.position.set(position.x, floorY, position.z);
    bombMesh.add(sndBombBeep);
    scene.add(bombMesh);
    bombWorldPos = bombMesh.position.clone();
}

function removePlantedBomb() {
    if (sndBombBeep.parent) sndBombBeep.parent.remove(sndBombBeep);
    if (bombMesh) {
        bombMesh.traverse(child => { if (child.isMesh && child.material) child.material.dispose(); });
        scene.remove(bombMesh);
        bombMesh = null;
    }
    c4LightMesh = null;
    c4LightFlashTimer = 0;
    bombWorldPos = null;
}

// ===== SND UI =====
function updateSndHud() {
    const badge        = document.getElementById('snd-team-badge');
    const timerDisp    = document.getElementById('snd-timer-display');
    const scoreDispEl  = document.getElementById('snd-score-display');
    const roundDispEl  = document.getElementById('snd-round-display');
    const show = sndMode && sndPhase !== 'match-end';

    if (badge) {
        badge.style.display = show ? 'block' : 'none';
        badge.textContent   = myTeam === 'attacker' ? 'ATTACKER' : 'DEFENDER';
        badge.className     = myTeam === 'attacker' ? 'attacker' : 'defender';
    }
    if (timerDisp)   timerDisp.style.display  = show ? 'block' : 'none';
    if (roundDispEl) roundDispEl.textContent  = `ROUND ${sndRound}`;
    if (scoreDispEl) scoreDispEl.textContent  = `${sndAttackerScore} — ${sndDefenderScore}`;
}

function updateSndTimer(roundSec, bombSec) {
    const timerEl = document.getElementById('snd-timer-value');
    if (!timerEl) return;
    if (bombSec !== null && bombSec !== undefined) {
        const m = Math.floor(bombSec / 60);
        const s = bombSec % 60;
        timerEl.textContent = m > 0
            ? `BOMB  ${m}:${String(s).padStart(2, '0')}`
            : `BOMB  ${s}s`;
        timerEl.style.color = bombSec <= 20 ? '#fc8181' : '#f6e05e';
    } else if (roundSec !== null && roundSec !== undefined) {
        const m = Math.floor(roundSec / 60);
        const s = roundSec % 60;
        timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;
        timerEl.style.color = roundSec <= 30 ? '#fc8181' : '#fff';
    }
}

function updateSndProgressBar(active, current, total) {
    const container = document.getElementById('snd-action-container');
    const fill      = document.getElementById('snd-action-bar-fill');
    const text      = document.getElementById('snd-action-text');
    if (!container || !fill) return;
    if (!active) { container.style.display = 'none'; return; }
    container.style.display = 'flex';
    fill.style.width = `${Math.min(1, current / total) * 100}%`;
    if (text) text.textContent = isPlanting ? 'Planting...' : 'Defusing...';
}

function updateSndPrompt() {
    const plantEl  = document.getElementById('snd-plant-prompt');
    const defuseEl = document.getElementById('snd-defuse-prompt');
    const showPlant  = sndMode && hasBomb && sndPhase === 'active'  && isInSite()  && !isPlanting;
    const showDefuse = sndMode && myTeam === 'defender' && sndPhase === 'planted' && isNearBomb() && !isDefusing;
    if (plantEl)  plantEl.style.display  = showPlant  ? 'block' : 'none';
    if (defuseEl) defuseEl.style.display = showDefuse ? 'block' : 'none';
}


function showSndRoundStartOverlay(round, team, bombCarrier) {
    const overlay  = document.getElementById('snd-round-start-overlay');
    const text     = document.getElementById('snd-round-start-text');
    const sub      = document.getElementById('snd-round-start-sub');
    const bombLine = document.getElementById('snd-round-start-bomb');
    if (!overlay) return;
    if (text)     text.textContent       = `ROUND ${round}`;
    if (sub)      sub.textContent        = team === 'attacker' ? 'ATTACKING' : 'DEFENDING';
    if (bombLine) bombLine.style.display = bombCarrier ? 'block' : 'none';
    overlay.style.display = 'flex';
    if (_sndRoundStartTimeout) clearTimeout(_sndRoundStartTimeout);
    _sndRoundStartTimeout = setTimeout(() => { overlay.style.display = 'none'; }, 3000);
}

function showSndRoundEndOverlay(winner, reason, aScore, dScore) {
    const overlay   = document.getElementById('snd-round-end-overlay');
    const winnerEl  = document.getElementById('snd-round-winner');
    const reasonEl  = document.getElementById('snd-round-reason');
    const scoreEl   = document.getElementById('snd-round-score-display');
    if (!overlay) return;
    if (winnerEl) winnerEl.textContent = winner === 'attacker' ? 'ATTACKERS WIN' : 'DEFENDERS WIN';
    const labels = { elimination: 'Elimination', defused: 'Bomb Defused', explosion: 'Bomb Exploded', timeout: 'Time Out' };
    if (reasonEl) reasonEl.textContent = labels[reason] || reason;
    if (scoreEl)  scoreEl.textContent  = `${aScore} — ${dScore}`;
    overlay.style.display = 'flex';
    if (_sndRoundEndTimeout) clearTimeout(_sndRoundEndTimeout);
    _sndRoundEndTimeout = setTimeout(() => { overlay.style.display = 'none'; }, 5000);
}

function showSndMatchEndOverlay(winner, aScore, dScore, isHost) {
    const overlay    = document.getElementById('snd-match-end-overlay');
    const winnerEl   = document.getElementById('snd-match-winner');
    const scoreEl    = document.getElementById('snd-match-score');
    const actionsEl  = document.getElementById('snd-match-actions');
    const waitingEl  = document.getElementById('snd-match-waiting');
    const rematchBtn = document.getElementById('snd-rematch-btn');
    const quitBtn    = document.getElementById('snd-quit-btn');
    if (!overlay) return;
    const labels = { attacker: 'ATTACKERS WIN', defender: 'DEFENDERS WIN', draw: 'DRAW' };
    if (winnerEl) winnerEl.textContent = labels[winner] || 'MATCH OVER';
    if (scoreEl)  scoreEl.textContent  = `${aScore} — ${dScore}`;
    if (actionsEl) actionsEl.style.display = isHost ? 'flex' : 'none';
    if (waitingEl) waitingEl.style.display = isHost ? 'none' : 'block';
    if (rematchBtn) rematchBtn.disabled = false;
    if (quitBtn)    quitBtn.disabled    = false;
    overlay.style.display = 'flex';
}

// ===== SND DOM event listeners =====
document.addEventListener('snd-round-start', e => {
    const d = e.detail;
    sndMode          = true;
    myTeam           = d.myTeam;
    hasBomb          = d.hasBomb;
    sndPhase         = 'active';
    sndRound         = d.round;
    sndAttackerScore = d.attackerScore;
    sndDefenderScore = d.defenderScore;
    isDead           = false;
    isSpectating     = false;
    isPlanting       = false;
    isDefusing       = false;
    plantTimer       = 0;
    defuseTimer      = 0;
    removePlantedBomb();

    const spawns = myTeam === 'attacker' ? ATTACKER_SPAWNS : DEFENDER_SPAWNS;
    camera.position.copy(spawns[Math.floor(Math.random() * spawns.length)]);

    health = 100;
    stamina = staminaMax;
    ammoCurrent = ammoMax;
    ammoReserve = ammoTotal - ammoMax;
    shotgunAmmoCurrent = shotgunAmmoMax;
    shotgunAmmoReserve = shotgunAmmoTotal - shotgunAmmoMax;
    grenadeCount = GRENADE_MAX;
    grenadeRecharge = 0;
    velocity.set(0, 0, 0);
    isCrouching = false;
    cancelShotgunReload();
    isReloading = false;

    setHealthBar(100);
    setStaminaBar(100);
    updateAmmoDisplay();
    updateGrenadeUI();
    updateSndProgressBar(false, 0, 0);

    const deathEl    = document.getElementById('death-overlay');
    const spectateEl = document.getElementById('snd-spectate-overlay');
    const matchEndEl = document.getElementById('snd-match-end-overlay');
    if (deathEl)    deathEl.style.display    = 'none';
    if (spectateEl) spectateEl.style.display = 'none';
    if (matchEndEl) matchEndEl.style.display = 'none';

    broadcastRespawn();
    updateSndHud();
    updateSndTimer(300, null); // seed display to 5:00 before first server tick

    if (hasBomb)                    playSndVoice(sndVoiceYouHaveTheBomb);
    else if (myTeam === 'attacker') playSndVoice(sndVoiceAttackerIntro);
    else                            playSndVoice(sndVoiceDefenderIntro);

    showSndRoundStartOverlay(d.round, myTeam, hasBomb);
});

document.addEventListener('snd-round-end', e => {
    const d = e.detail;
    sndPhase         = 'round-end';
    sndAttackerScore = d.attackerScore;
    sndDefenderScore = d.defenderScore;
    isPlanting  = false;
    isDefusing  = false;
    plantTimer  = 0;
    defuseTimer = 0;
    updateSndProgressBar(false, 0, 0);
    stopPlantingSound();
    stopBombBeep();
    if (d.winner === 'attacker') {
        playSndVoice(sndVoiceAttackersWin);
    } else {
        playSndVoice(sndVoiceDefendersWin[Math.floor(Math.random() * sndVoiceDefendersWin.length)]);
    }
    updateSndHud();
    showSndRoundEndOverlay(d.winner, d.reason, d.attackerScore, d.defenderScore);
});

document.addEventListener('snd-match-end', e => {
    const d = e.detail;
    sndPhase = 'match-end';
    updateSndHud(); // hides badge + timer display (phase is now 'match-end')
    showSndMatchEndOverlay(d.winner, d.attackerScore, d.defenderScore, d.isHost);
});

document.addEventListener('snd-timer', e => {
    const d = e.detail;
    if (d.bombSeconds !== null && d.bombSeconds !== undefined) _bombSecondsLeft = d.bombSeconds;
    updateSndTimer(d.roundSeconds, d.bombSeconds);
});

document.addEventListener('snd-bomb-planting-start', e => {
    const p = e.detail.position;
    startPlantingSound(p);
});

document.addEventListener('snd-bomb-planting-stop', () => {
    stopPlantingSound();
});

document.addEventListener('snd-bomb-planted', e => {
    const d = e.detail;
    sndPhase = 'planted';
    hasBomb  = false;
    _bombSecondsLeft = d.bombSeconds ?? 50;
    spawnPlantedBomb(d.position);
    playSndVoice(sndVoiceBombPlanted);
    stopPlantingSound();
    startBombBeep();
    updateSndPrompt();
});

document.addEventListener('snd-bomb-defused', () => {
    removePlantedBomb();
    updateSndPrompt();
});

document.addEventListener('snd-bomb-exploded', e => {
    if (bombWorldPos) {
        spawnGrenadeFlash(bombWorldPos.clone());
        playGrenadeExplosionSound(bombWorldPos.clone());
    }
    removePlantedBomb();
    updateSndPrompt();
});

document.addEventListener('snd-quit', () => {
    sndMode      = false;
    myTeam       = null;
    hasBomb      = false;
    isSpectating = false;
    sndPhase     = 'waiting';
    isPlanting   = false;
    isDefusing   = false;
    plantTimer   = 0;
    defuseTimer  = 0;
    stopPlantingSound();
    stopBombBeep();
    removePlantedBomb();
    updateSndProgressBar(false, 0, 0);
    cancelShotgunReload();
    isReloading = false;

    if (isDead) {
        isDead = false;
        health = 100;
        stamina = staminaMax;
        ammoCurrent = ammoMax;
        ammoReserve = ammoTotal - ammoMax;
        shotgunAmmoCurrent = shotgunAmmoMax;
        shotgunAmmoReserve = shotgunAmmoTotal - shotgunAmmoMax;
        velocity.set(0, 0, 0);
        controlsObject.position.copy(pickSpawnPoint());
        setHealthBar(100);
        setStaminaBar(100);
        updateAmmoDisplay();
    }

    const hideIds = [
        'snd-team-badge', 'snd-timer-display', 'snd-match-end-overlay', 'snd-spectate-overlay',
        'snd-round-start-overlay', 'snd-round-end-overlay',
        'snd-plant-prompt', 'snd-defuse-prompt', 'death-overlay',
    ];
    hideIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
});

document.addEventListener('player-left-room', () => {
    cancelShotgunReload();
    isReloading  = false;
    isDead       = false;
    health       = 100;
    stamina      = staminaMax;
    ammoCurrent  = ammoMax;
    ammoReserve  = ammoTotal - ammoMax;
    shotgunAmmoCurrent = shotgunAmmoMax;
    shotgunAmmoReserve = shotgunAmmoTotal - shotgunAmmoMax;
    velocity.set(0, 0, 0);
    controlsObject.position.copy(pickSpawnPoint());
    setHealthBar(100);
    setStaminaBar(100);
    updateAmmoDisplay();

    // Cancel thrown pistol
    if (thrownPistol) {
        scene.remove(thrownPistol.mesh);
        thrownPistol = null;
        const p = camera.getObjectByName('Pistol');
        if (p) p.visible = true;
    }

    // Reset SND state
    sndMode      = false;
    myTeam       = null;
    hasBomb      = false;
    isSpectating = false;
    sndPhase     = 'waiting';
    isPlanting   = false;
    isDefusing   = false;
    plantTimer   = 0;
    defuseTimer  = 0;
    stopPlantingSound();
    stopBombBeep();
    removePlantedBomb();
    updateSndProgressBar(false, 0, 0);

    const hideIds = [
        'snd-team-badge', 'snd-timer-display', 'snd-match-end-overlay', 'snd-spectate-overlay',
        'snd-round-start-overlay', 'snd-round-end-overlay',
        'snd-plant-prompt', 'snd-defuse-prompt', 'death-overlay',
    ];
    hideIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
});

// Animation loop
const clock = new THREE.Clock();
function animate() {
    requestAnimationFrame(animate);

    // Cap delta to prevent huge position jumps when the tab was in the background
    const delta = Math.min(clock.getDelta(), 0.05);

    // Weapon switch animation
    if (weaponSwitchState !== 'idle') {
        weaponSwitchProgress = Math.min(1, weaponSwitchProgress + WEAPON_SWITCH_SPEED * delta);
        if (weaponSwitchProgress >= 1) {
            if (weaponSwitchState === 'holstering') {
                setActiveWeapon(pendingWeapon);
                weaponSwitchState = 'drawing';
                weaponSwitchProgress = 0;
            } else {
                weaponSwitchState = 'idle';
                weaponSwitchProgress = 0;
                pendingWeapon = null;
            }
        }
    }

    // While dead: spectate (SND) or drop to floor (FFA), keep networking
    if (isDead) {
        if (isSpectating) {
            const spectateSpeed = 9;
            const camDir = new THREE.Vector3();
            camera.getWorldDirection(camDir);
            const camRight = new THREE.Vector3();
            camRight.setFromMatrixColumn(camera.matrix, 0);
            if (move.forward)  camera.position.addScaledVector(camDir,   spectateSpeed * delta);
            if (move.backward) camera.position.addScaledVector(camDir,  -spectateSpeed * delta);
            if (move.right)    camera.position.addScaledVector(camRight,  spectateSpeed * delta);
            if (move.left)     camera.position.addScaledVector(camRight, -spectateSpeed * delta);
        } else {
            controlsObject.position.y += (0.3 - controlsObject.position.y) * 5 * delta;
        }
        updateRemotePlayers(delta);
        broadcastState(controlsObject, health, activeWeapon);
        renderer.render(scene, camera);
        return;
    }

    if (fireCooldown > 0) fireCooldown -= delta;

    // Dampen velocity
    velocity.x -= velocity.x * 10.0 * delta;
    velocity.z -= velocity.z * 10.0 * delta;

    // Movement direction
    direction.z = Number(move.forward) - Number(move.backward);
    direction.x = Number(move.right) - Number(move.left);
    direction.normalize();

    // Speed logic
    const speed = isWalking ? 30.0 : 60.0;
    const crouchSpeed = 15;
    const finalSpeed = isCrouching ? crouchSpeed : speed;

    if (move.forward || move.backward) velocity.z -= direction.z * finalSpeed * delta;
    if (move.left || move.right) velocity.x -= direction.x * finalSpeed * delta;

    // Gravity
    velocity.y -= 30 * delta;

    // --- WALL COLLISION DETECTION ---
    // Predict next position for X and Z separately
    const nextPositionX = controlsObject.position.clone();
    nextPositionX.x += -velocity.x * delta;
    const nextPositionZ = controlsObject.position.clone();
    nextPositionZ.z += -velocity.z * delta;

    const playerSphereX = new THREE.Sphere(nextPositionX, 0.5);
    const playerSphereZ = new THREE.Sphere(nextPositionZ, 0.5);

    let collidesX = false, collidesZ = false;
    for (const box of wallBoxes) {
        if (box.intersectsSphere(playerSphereX)) collidesX = true;
        if (box.intersectsSphere(playerSphereZ)) collidesZ = true;
    }

    // Move along X if no collision
    if (!collidesX) controls.moveRight(-velocity.x * delta);
    // Move along Z if no collision
    if (!collidesZ) controls.moveForward(-velocity.z * delta);

    // Push out if stuck inside a wall
    const playerSphere = new THREE.Sphere(controlsObject.position, 0.5);
    for (const box of wallBoxes) {
        if (box.intersectsSphere(playerSphere)) {
            // Push out along X
            if (controlsObject.position.x < box.min.x) controlsObject.position.x -= 0.1;
            else if (controlsObject.position.x > box.max.x) controlsObject.position.x += 0.1;
            // Push out along Z
            if (controlsObject.position.z < box.min.z) controlsObject.position.z -= 0.1;
            else if (controlsObject.position.z > box.max.z) controlsObject.position.z += 0.1;
        }
    }

    // Vertical movement (jump/fall)
    controlsObject.position.y += velocity.y * delta;

    // Ground/crouch height
    const targetHeight = isCrouching ? crouchingHeight : standingHeight;
    if (controlsObject.position.y < targetHeight) {
        velocity.y = 0;
        controlsObject.position.y = targetHeight;
        canJump = true;
    }

    // Pistol recoil recovery
    recoil += (0 - recoil) * recoilRecover * delta;
    shotgunRecoil += (0 - shotgunRecoil) * (recoilRecover * 0.7) * delta;

    // Reload animation
    if (isReloading && reloadAnimProgress < 1) {
        reloadAnimProgress += reloadAnimSpeed * delta;
        if (reloadAnimProgress > 1) reloadAnimProgress = 1;
    } else if (isRaisingGun && reloadAnimProgress > 0) {
        reloadAnimProgress -= reloadAnimSpeed * delta;
        if (reloadAnimProgress <= 0) {
            reloadAnimProgress = 0;
            isRaisingGun = false;
        }
    }

    // Stamina logic
    const isMoving = move.forward || move.backward || move.left || move.right;
    if (!isWalking && !isCrouching && isMoving) {
        stamina -= staminaDepleteRate * delta;
        if (stamina < 0) stamina = 0;
    } else {
        stamina += staminaDepleteRate * delta * 1.3;
        if (stamina > staminaMax) stamina = staminaMax;
    }

    if (stamina <= 5) showStaminaMessage();
    if (stamina >= 15) hideStaminaMessage();

    // Health loss when running with zero stamina
    if (!isWalking && !isCrouching && isMoving && stamina === 0) {
        healthDepleteTimer += delta;
        if (healthDepleteTimer >= 2.5) {
            health -= 15;
            if (health < 0) health = 0;
            setHealthBar(health);
            healthDepleteTimer = 0;
            playRandomOuch();
        }
    } else {
        healthDepleteTimer = 0;
    }

    // Death check
    if (health <= 0 && !isDead) triggerDeath();

    // Health regeneration (suspended while dead)
    if (health < 100 && !isDead) {
        health += (5 / 3) * delta;
        if (health > 100) health = 100;
    }

    // Walking logic
    if (shiftPressed) isWalking = true;
    if (!shiftPressed && stamina > 0 && isWalking && !staminaDepleted) isWalking = false;

    // UI updates
    setStaminaBar((stamina / staminaMax) * 100);
    setHealthBar(health);

    // Update impact effects (fade & scale)
    const now = performance.now();
    for (let i = impactEffects.length - 1; i >= 0; i--) {
        const eff = impactEffects[i];
        const elapsed = now - eff.createdAt;
        const t = Math.min(1, elapsed / eff.duration);
        if (eff.sprite && eff.sprite.material) {
            eff.sprite.material.opacity = 1 - t;
            const s = eff.baseScale * (1 + t * 0.6); // slight grow
            eff.sprite.scale.set(s, s, s);
        }
        if (t >= 1) {
            // remove
            if (eff.sprite) {
                if (eff.sprite.material.map) {
                    // don't dispose shared impactTexture, only material
                    // eff.sprite.material.map.dispose(); // keep texture cached
                }
                scene.remove(eff.sprite);
                if (eff.sprite.material) eff.sprite.material.dispose();
                // sprite geometry is internal to Sprite, no dispose needed
            }
            impactEffects.splice(i, 1);
        }
    }

    // Blood particles
    for (let i = bloodParticles.length - 1; i >= 0; i--) {
        const p = bloodParticles[i];
        const elapsed = now - p.born;
        const t = elapsed / p.duration;
        if (t >= 1) {
            scene.remove(p.sprite);
            p.mat.dispose();
            bloodParticles.splice(i, 1);
            continue;
        }
        p.vel.y -= 18 * delta;
        p.sprite.position.addScaledVector(p.vel, delta);
        p.sprite.material.opacity = 1 - t;
    }

    // Bullet hole fade
    for (let i = bulletHoles.length - 1; i >= 0; i--) {
        const h = bulletHoles[i];
        const elapsed = now - h.born;
        const t = elapsed / h.duration;
        if (t >= 1) {
            scene.remove(h.sprite);
            h.mat.dispose();
            bulletHoles.splice(i, 1);
            continue;
        }
        if (t > 0.8) h.sprite.material.opacity = 1 - (t - 0.8) / 0.2;
    }

    // Pistol bobbing effect (hidden while pistol is in flight)
    const pistol = camera.children.find(obj => obj.name === "Pistol");
    if (pistol) {
        pistol.visible = activeWeapon === 'pistol' && !thrownPistol;
        if (!thrownPistol) {
            let basePosition = new THREE.Vector3(0.4, -0.3, -0.8);

            if (!isReloading && !isRaisingGun && isMoving) {
                const time = clock.getElapsedTime();
                const bobAmount = 0.05;
                let bobSpeed = isWalking ? 4 : isCrouching ? 2 : 8;
                basePosition.x += Math.sin(time * bobSpeed) * 0.03;
                basePosition.y += Math.abs(Math.sin(time * bobSpeed)) * bobAmount;
            }

            if (reloadAnimProgress > 0) basePosition.y += -0.7 * reloadAnimProgress;

            // Weapon switch drop/rise
            const _pt = weaponSwitchProgress;
            const _pe = _pt * _pt * (3 - 2 * _pt); // smoothstep
            if (weaponSwitchState === 'holstering' && activeWeapon === 'pistol')
                basePosition.y -= 0.9 * _pe;
            else if (weaponSwitchState === 'drawing' && activeWeapon === 'pistol')
                basePosition.y -= 0.9 * (1 - _pe);

            pistol.position.set(basePosition.x, basePosition.y, basePosition.z);
            pistol.rotation.set(0 + recoil, -Math.PI / 2, 0);
        }
    }

    // Shotgun bobbing & recoil
    const shotgunMesh = camera.children.find(obj => obj.name === "Shotgun");
    if (shotgunMesh) {
        let basePos = new THREE.Vector3(0.3, -0.38, -0.75);
        if (!isReloading && !isRaisingGun && isMoving) {
            const time = clock.getElapsedTime();
            const bobSpeed = isWalking ? 4 : isCrouching ? 2 : 8;
            basePos.x += Math.sin(time * bobSpeed) * 0.03;
            basePos.y += Math.abs(Math.sin(time * bobSpeed)) * 0.05;
        }
        if (reloadAnimProgress > 0 && activeWeapon === 'shotgun') basePos.y += -0.7 * reloadAnimProgress;

        // Weapon switch drop/rise
        const _st = weaponSwitchProgress;
        const _se = _st * _st * (3 - 2 * _st); // smoothstep
        if (weaponSwitchState === 'holstering' && activeWeapon === 'shotgun')
            basePos.y -= 0.9 * _se;
        else if (weaponSwitchState === 'drawing' && activeWeapon === 'shotgun')
            basePos.y -= 0.9 * (1 - _se);

        shotgunMesh.position.set(basePos.x, basePos.y, basePos.z);
        shotgunMesh.rotation.set(shotgunRecoil, Math.PI, 0);
    }

    // Thrown pistol physics & return
    if (thrownPistol) {
        const tp = thrownPistol;
        tp.age += delta;

        if (!tp.returning) {
            tp.velocity.y -= PISTOL_GRAVITY * delta;
            const tpNext = tp.mesh.position.clone().addScaledVector(tp.velocity, delta);

            // Floor bounce
            if (tpNext.y < 0.3) {
                tpNext.y = 0.3;
                tp.velocity.y = Math.abs(tp.velocity.y) * 0.45;
                tp.velocity.x *= 0.8;
                tp.velocity.z *= 0.8;
            }

            // Wall bounce — same AABB resolution as grenades
            const PR = 0.12;
            for (const box of wallBoxes) {
                const ox = tpNext.x, oy = tpNext.y, oz = tpNext.z;
                if (ox < box.min.x || ox > box.max.x || oy < box.min.y || oy > box.max.y || oz < box.min.z || oz > box.max.z) continue;
                const dxP = (ox+PR)-box.min.x, dxN = box.max.x-(ox-PR);
                const dyP = (oy+PR)-box.min.y, dyN = box.max.y-(oy-PR);
                const dzP = (oz+PR)-box.min.z, dzN = box.max.z-(oz-PR);
                const mX = Math.min(dxP,dxN), mY = Math.min(dyP,dyN), mZ = Math.min(dzP,dzN);
                if (mX <= mY && mX <= mZ) { tpNext.x += dxP<dxN?-dxP:dxN; tp.velocity.x = -tp.velocity.x * 0.5; }
                else if (mZ <= mX && mZ <= mY) { tpNext.z += dzP<dzN?-dzP:dzN; tp.velocity.z = -tp.velocity.z * 0.5; }
                else { tpNext.y += dyP<dyN?-dyP:dyN; tp.velocity.y = -tp.velocity.y * 0.5; }
            }

            tp.mesh.position.copy(tpNext);
            const tpSpeed = tp.velocity.length();
            tp.mesh.rotation.x += tpSpeed * 0.5 * delta;
            tp.mesh.rotation.z += tpSpeed * 0.2 * delta;

            // Player proximity hit — deal damage then bounce off like a wall
            if (!tp.hitSomeone) {
                const hits = getPlayersInRange(tp.mesh.position, 0.8);
                if (hits.length > 0) {
                    broadcastPlayerHit(hits[0].id, 35, true);
                    showHitPopup(tp.mesh.position, 35, false);
                    tp.hitSomeone = true;
                    // Bounce: reverse horizontal velocity, add slight upward kick
                    tp.velocity.x *= -0.3;
                    tp.velocity.z *= -0.3;
                    tp.velocity.y = Math.abs(tp.velocity.y) * 0.2 + 1.2;
                }
            }

            // Max flight time → begin return
            if (!tp.returning && tp.age >= PISTOL_MAX_FLIGHT) {
                tp.returning = true;
                tp.returnTimer = 0;
                broadcastPistolReturn();
            }
        } else {
            // Wait out delay (after hitting a player), then fly back
            if (tp.returnTimer > 0) {
                tp.returnTimer -= delta;
            } else {
                const handTarget = new THREE.Vector3(0.4, -0.3, -0.8).applyMatrix4(camera.matrixWorld);
                const toHand = handTarget.sub(tp.mesh.position);
                const dist = toHand.length();
                if (dist < 0.35) {
                    scene.remove(tp.mesh);
                    thrownPistol = null;
                } else {
                    tp.mesh.position.addScaledVector(toHand.normalize(), PISTOL_RETURN_SPEED * delta);
                    tp.mesh.rotation.x += 15 * delta;
                }
            }
        }
    }

    // Remote thrown pistols — simulate physics so other players see them fly
    remoteThrownPistols.forEach((rp, id) => {
        rp.age += delta;
        if (rp.age > PISTOL_MAX_FLIGHT + PISTOL_RETURN_DELAY + 3) {
            scene.remove(rp.mesh);
            remoteThrownPistols.delete(id);
            return;
        }
        rp.velocity.y -= PISTOL_GRAVITY * delta;
        const rpNext = rp.mesh.position.clone().addScaledVector(rp.velocity, delta);

        if (rpNext.y < 0.3) {
            rpNext.y = 0.3;
            rp.velocity.y = Math.abs(rp.velocity.y) * 0.45;
            rp.velocity.x *= 0.8;
            rp.velocity.z *= 0.8;
        }

        const RPR = 0.12;
        for (const box of wallBoxes) {
            const ox = rpNext.x, oy = rpNext.y, oz = rpNext.z;
            if (ox < box.min.x || ox > box.max.x || oy < box.min.y || oy > box.max.y || oz < box.min.z || oz > box.max.z) continue;
            const dxP = (ox+RPR)-box.min.x, dxN = box.max.x-(ox-RPR);
            const dyP = (oy+RPR)-box.min.y, dyN = box.max.y-(oy-RPR);
            const dzP = (oz+RPR)-box.min.z, dzN = box.max.z-(oz-RPR);
            const mX = Math.min(dxP,dxN), mY = Math.min(dyP,dyN), mZ = Math.min(dzP,dzN);
            if (mX <= mY && mX <= mZ) { rpNext.x += dxP<dxN?-dxP:dxN; rp.velocity.x = -rp.velocity.x * 0.5; }
            else if (mZ <= mX && mZ <= mY) { rpNext.z += dzP<dzN?-dzP:dzN; rp.velocity.z = -rp.velocity.z * 0.5; }
            else { rpNext.y += dyP<dyN?-dyP:dyN; rp.velocity.y = -rp.velocity.y * 0.5; }
        }

        rp.mesh.position.copy(rpNext);
        const rpSpeed = rp.velocity.length();
        rp.mesh.rotation.x += rpSpeed * 0.5 * delta;
        rp.mesh.rotation.z += rpSpeed * 0.2 * delta;
    });

    // Grenade recharge
    if (grenadeCount < GRENADE_MAX) {
        grenadeRecharge += delta;
        if (grenadeRecharge >= GRENADE_RECHARGE) {
            grenadeRecharge = 0;
            grenadeCount = Math.min(GRENADE_MAX, grenadeCount + 1);
            updateGrenadeUI();
        }
    }

    // Grenade physics
    const G_R = 0.1;
    for (let i = grenades.length - 1; i >= 0; i--) {
        const g = grenades[i];
        g.timer += delta;

        if (g.timer >= g.fuse) { grenadeExplode(g, i); continue; }

        // Flash red in last 0.8s
        if (g.timer > g.fuse - 0.8) {
            g.mat.color.setHex(Math.floor(g.timer * 12) % 2 ? 0xff2200 : 0x3a5c3a);
        }

        g.velocity.y -= 14 * delta;
        const next = g.mesh.position.clone().addScaledVector(g.velocity, delta);

        if (next.y < G_R + 0.05) {
            next.y = G_R + 0.05;
            g.velocity.y = Math.abs(g.velocity.y) * GRENADE_BOUNCE_F;
            g.velocity.x *= 0.82; g.velocity.z *= 0.82;
        }

        for (const box of wallBoxes) {
            const ox = next.x, oy = next.y, oz = next.z;
            if (ox + G_R <= box.min.x || ox - G_R >= box.max.x) continue;
            if (oy + G_R <= box.min.y || oy - G_R >= box.max.y) continue;
            if (oz + G_R <= box.min.z || oz - G_R >= box.max.z) continue;
            const dxP = (ox+G_R)-box.min.x, dxN = box.max.x-(ox-G_R);
            const dyP = (oy+G_R)-box.min.y, dyN = box.max.y-(oy-G_R);
            const dzP = (oz+G_R)-box.min.z, dzN = box.max.z-(oz-G_R);
            const mX = Math.min(dxP,dxN), mY = Math.min(dyP,dyN), mZ = Math.min(dzP,dzN);
            if (mX <= mY && mX <= mZ) { next.x += dxP<dxN?-dxP:dxN; g.velocity.x = -g.velocity.x * GRENADE_BOUNCE_W; }
            else if (mZ <= mX && mZ <= mY) { next.z += dzP<dzN?-dzP:dzN; g.velocity.z = -g.velocity.z * GRENADE_BOUNCE_W; }
            else { next.y += dyP<dyN?-dyP:dyN; g.velocity.y = -g.velocity.y * GRENADE_BOUNCE_W; }
        }

        g.mesh.position.copy(next);
        g.mesh.rotation.x += g.velocity.length() * delta * 4;
    }

    // Grenade explosion flashes
    for (let i = grenadeFlashes.length - 1; i >= 0; i--) {
        const f = grenadeFlashes[i];
        f.t += delta;
        f.sphere.scale.setScalar(1 + f.t * 28);
        f.mat.opacity = Math.max(0, 0.9 - f.t * 3);
        if (f.t >= 0.35) {
            scene.remove(f.sphere);
            f.geo.dispose(); f.mat.dispose();
            grenadeFlashes.splice(i, 1);
        }
    }

    // Muzzle flash timer
    if (muzzleFlashTimer > 0) {
        muzzleFlashTimer -= delta;
        if (muzzleFlashTimer <= 0) {
            const pFlash = camera.getObjectByName('PistolMuzzleFlash');
            const sgFlash = camera.getObjectByName('ShotgunMuzzleFlash');
            if (pFlash) pFlash.visible = false;
            if (sgFlash) sgFlash.visible = false;
        }
    }

    // SND plant / defuse / prompt logic
    if (sndMode) {
        if (isPlanting && hasBomb && sndPhase === 'active' && isInSite()) {
            plantTimer += delta;
            updateSndProgressBar(true, plantTimer, PLANT_DURATION);
            if (plantTimer >= PLANT_DURATION) {
                isPlanting = false;
                plantTimer = 0;
                broadcastBombPlantingStop();
                broadcastBombPlanted(camera.position);
                updateSndProgressBar(false, 0, 0);
            }
        } else if (isPlanting) {
            isPlanting = false;
            plantTimer = 0;
            broadcastBombPlantingStop();
            stopPlantingSound();
            updateSndProgressBar(false, 0, 0);
        }

        if (isDefusing && myTeam === 'defender' && sndPhase === 'planted' && isNearBomb()) {
            defuseTimer += delta;
            updateSndProgressBar(true, defuseTimer, DEFUSE_DURATION);
            if (defuseTimer >= DEFUSE_DURATION) {
                isDefusing = false;
                defuseTimer = 0;
                broadcastBombDefused();
                updateSndProgressBar(false, 0, 0);
            }
        } else if (isDefusing) {
            isDefusing = false;
            defuseTimer = 0;
            updateSndProgressBar(false, 0, 0);
        }

        if (c4LightMesh?.material) {
            if (c4LightFlashTimer > 0) {
                c4LightFlashTimer = Math.max(0, c4LightFlashTimer - delta);
                c4LightMesh.material.emissiveIntensity = c4LightFlashTimer / C4_FLASH_DURATION;
            } else {
                c4LightMesh.material.emissiveIntensity = 0;
            }
        }

        updateSndPrompt();
    }

    // Multiplayer: interpolate remote players and broadcast local state
    updateRemotePlayers(delta);
    broadcastState(controlsObject, health, activeWeapon);

    // Screen shake
    if (shakeIntensity > 0.0005) {
        camera.rotation.x += Math.cos(shakeAngle) * shakeIntensity;
        camera.rotation.y += Math.sin(shakeAngle) * shakeIntensity;
        shakeAngle += 3.5;
        shakeIntensity *= 0.75;
    }

    renderer.render(scene, camera);
}
animate();

initNetwork(
    scene,
    () => { gameActive = true; },
    (damage, shooterId, isMelee) => {
        if (isDead) return;
        lastHitBy = shooterId;
        lastHitWasMelee = !!isMelee;
        health -= damage;
        if (health < 0) health = 0;
        setHealthBar(health);
        triggerShake(damage * 0.0018);
        showDamageIndicator(shooterId);
        if (health <= 0) triggerDeath();
        else playRandomOuch();
    }
);