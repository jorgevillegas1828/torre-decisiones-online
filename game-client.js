
// game-client.js - cliente para Torre de Decisiones 3D (simplificado)
// Requiere servidor socket.io corriendo en el mismo host
const socket = io();

// UI
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const startBtn = document.getElementById('startBtn');
const roomIdInput = document.getElementById('roomId');
const playerNameInput = document.getElementById('playerName');
const playersList = document.getElementById('playersList');
const turnInfo = document.getElementById('turnInfo');
const stabilityInfo = document.getElementById('stabilityInfo');
const canvasHolder = document.getElementById('canvasHolder');
const resetViewBtn = document.getElementById('resetView');

let currentRoom = null;
let localPlayerId = null;
let scene, camera, renderer, controls;
let blocks = []; // mesh objects
let roomState = null;

// Inicializar Three.js
function initThree() {
  const width = canvasHolder.clientWidth || window.innerWidth - 320;
  const height = canvasHolder.clientHeight || window.innerHeight;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, width/height, 0.1, 1000);
  camera.position.set(6,10,12);
  renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
  renderer.setSize(width, height);
  canvasHolder.innerHTML = '';
  canvasHolder.appendChild(renderer.domElement);
  controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0,6,0);
  // luz
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
  hemi.position.set(0,50,0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(0,20,10);
  scene.add(dir);
  // suelo
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40,40), new THREE.MeshStandardMaterial({color:0xf3f4f6}));
  ground.rotation.x = -Math.PI/2;
  ground.position.y = 0;
  scene.add(ground);
  animate();
}

// construir torre en escena basada en estado
function buildTowerFromState(state) {
  // limpiar anterior
  blocks.forEach(m => scene.remove(m));
  blocks = [];
  const NIVELES = 18;
  const W = 3, H = 0.6, D = 1;
  for (let lvl=0; lvl<NIVELES; lvl++) {
    const y = 0.6/2 + lvl * (H + 0.02) + 0.2;
    const horizontal = lvl % 2 === 0;
    for (let i=0;i<3;i++) {
      const geom = new THREE.BoxGeometry(W, H, D);
      let color = 0x2c84d7;
      const globalId = lvl*3 + i + 1;
      // color by id ranges
      if (globalId <= 18) color = 0x2c84d7;
      else if (globalId <= 36) color = 0x2d9b57;
      else if (globalId <= 45) color = 0xb8332a;
      else color = 0xf1c40f;
      const mat = new THREE.MeshStandardMaterial({color});
      const mesh = new THREE.Mesh(geom, mat);
      mesh.position.y = y;
      if (horizontal) {
        mesh.position.x = (i-1) * 3.2;
      } else {
        mesh.position.z = (i-1) * 1.2;
        mesh.rotation.y = Math.PI/2;
      }
      mesh.userData = { id: globalId };
      // hidden if removed in state
      const blockState = state.blocks.find(b=>b.id===globalId);
      if (blockState && blockState.removed) mesh.visible = false;
      mesh.castShadow = true;
      scene.add(mesh);
      blocks.push(mesh);
      // interaction raycast
      mesh.cursor = 'pointer';
    }
  }
}

// Raycasting click
function setupRaycast() {
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('click', (ev)=>{
    if (!roomState || !roomState.started) return;
    const rect = renderer.domElement.getBoundingClientRect();
    mouse.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(blocks.filter(b=>b.visible));
    if (intersects.length>0) {
      const mesh = intersects[0].object;
      const id = mesh.userData.id;
      // ask server to remove block
      socket.emit('removeBlock', { roomId: currentRoom, blockId: id }, (resp)=>{
        if (!resp.ok) {
          Swal.fire('Error', resp.error || 'No se pudo', 'error');
        }
      });
    }
  });
}

// render loop
function animate() {
  requestAnimationFrame(animate);
  renderer.render(scene, camera);
}

// socket events
socket.on('connect', ()=>{
  localPlayerId = socket.id;
});

socket.on('roomUpdate', (room)=>{
  roomState = room;
  currentRoom = room.roomId || currentRoom;
  updatePlayers(room);
  if (!scene) initThree();
  buildTowerFromState(room);
  updateHUD(room);
});

socket.on('gameStarted', (room)=>{
  roomState = room;
  buildTowerFromState(room);
  updateHUD(room);
});

socket.on('blockRemoved', ({ blockId, color, stability })=>{
  // hide block in local scene
  const mesh = blocks.find(b=>b.userData.id===blockId);
  if (mesh) {
    gsap.to(mesh.position, { x: mesh.position.x + 4, duration: 0.45 });
    gsap.to(mesh, { opacity: 0, duration: 0.5, onComplete: ()=> mesh.visible = false });
  }
  stabilityInfo.textContent = 'Estabilidad: ' + stability;
  // show question modal for the active player
  Swal.fire({ title:'Bloque retirado', text: 'Responde o realiza el reto. Presiona "Confirmar cumplido" cuando lo hagas.', showCancelButton:true, confirmButtonText:'Confirmar cumplido' }).then(res=>{
    if (res.isConfirmed) {
      socket.emit('confirmAction', { roomId: currentRoom }, ()=>{});
    }
  });
});

socket.on('turnAdvanced', ({ turnIndex })=>{
  turnInfo.textContent = 'Turno de ' + (turnIndex+1);
});

socket.on('collapse', ({ message })=>{
  Swal.fire({ title:'La torre cayó', text: message, icon:'warning' });
});

// UI events
createBtn.addEventListener('click', ()=>{
  const roomId = roomIdInput.value.trim();
  const name = playerNameInput.value.trim() || 'Jugador';
  if (!roomId) return Swal.fire('Error','Escribe código de sala','error');
  socket.emit('createRoom', { roomId, name }, (resp)=>{
    if (!resp.ok) return Swal.fire('Error', resp.error || 'No creado','error');
    currentRoom = roomId;
    updatePlayers(resp.room);
    startBtn.disabled = false;
  });
});

joinBtn.addEventListener('click', ()=>{
  const roomId = roomIdInput.value.trim();
  const name = playerNameInput.value.trim() || 'Jugador';
  if (!roomId) return Swal.fire('Error','Escribe código de sala','error');
  socket.emit('joinRoom', { roomId, name }, (resp)=>{
    if (!resp.ok) return Swal.fire('Error', resp.error || 'No se unió','error');
    currentRoom = roomId;
    updatePlayers(resp.room);
    startBtn.disabled = true;
  });
});

startBtn.addEventListener('click', ()=>{
  if (!currentRoom) return;
  socket.emit('startGame', { roomId: currentRoom }, (resp)=>{
    if (!resp.ok) Swal.fire('Error','No se pudo empezar','error');
  });
});

function updatePlayers(room) {
  playersList.innerHTML = '';
  (room.players||[]).forEach(p=>{
    const d = document.createElement('div');
    d.textContent = p.name + (p.id === localPlayerId ? ' (Tú)' : '');
    playersList.appendChild(d);
  });
}

function updateHUD(room) {
  stabilityInfo.textContent = 'Estabilidad: ' + (room.stability || 100);
  turnInfo.textContent = 'Turno: ' + ((room.turnIndex || 0) + 1);
}

resetViewBtn.addEventListener('click', ()=>{
  controls.target.set(0,6,0);
  camera.position.set(6,10,12);
});

// resize handling
window.addEventListener('resize', ()=>{
  if (!renderer) return;
  const width = canvasHolder.clientWidth || window.innerWidth - 320;
  const height = canvasHolder.clientHeight || window.innerHeight;
  renderer.setSize(width, height);
  camera.aspect = width/height;
  camera.updateProjectionMatrix();
});

// start minimal
initThree();
setupRaycast();
