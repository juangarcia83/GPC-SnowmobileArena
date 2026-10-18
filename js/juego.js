var renderer, scene, camera;
var cameraControls;

var camaraMapa;

var textCanvas, ctx;

var clock = new THREE.Clock();
var tiempo = 0;

// Estados del juego: cargando -> inicio -> cuenta -> jugando -> fin
var estado = 'cargando';
var cuentaAtras = 0;
var tiempoRestante = 0;
var pausa = false;
var camaraOrbital = false;

var mensaje = '';
var colorMensaje = '#ffffff';
var tiempoMensaje = 0;

var distanciaCamara = 7;
var alturaCamara = 2.8;
var miradaCamara = new THREE.Vector3();

var ajustes = {
  duracion: 120,
  rivales: 3,
  reiniciar: function() { if (estado !== 'cargando') reiniciarPartida(); }  // lil-gui lo pinta como boton
};

const controls = {
  moveForward: false,
  moveBackward: false,
  moveLeft: false,
  moveRight: false
};

// al pulsar marco la tecla como apretada y al soltar la desmarco, en update() miro cuales lo estan
document.addEventListener('keydown', (event) => {
  switch (event.code) {
    case 'ArrowUp':
    case 'KeyW':
      controls.moveForward = true;
      break;
    case 'ArrowDown':
    case 'KeyS':
      controls.moveBackward = true;
      break;
    case 'ArrowLeft':
    case 'KeyA':
      controls.moveLeft = true;
      break;
    case 'ArrowRight':
    case 'KeyD':
      controls.moveRight = true;
      break;
  }
});

document.addEventListener('keyup', (event) => {
  switch (event.code) {
    case 'ArrowUp':
    case 'KeyW':
      controls.moveForward = false;
      break;
    case 'ArrowDown':
    case 'KeyS':
      controls.moveBackward = false;
      break;
    case 'ArrowLeft':
    case 'KeyA':
      controls.moveLeft = false;
      break;
    case 'ArrowRight':
    case 'KeyD':
      controls.moveRight = false;
      break;
    case 'Enter':
      if (estado === 'inicio' || estado === 'fin') reiniciarPartida();
      break;
    case 'KeyR':
      if (estado !== 'cargando') reiniciarPartida();
      break;
    case 'KeyC':
      cambiarCamara();
      break;
    case 'KeyP':
      cambiarPausa();
      break;
  }
});

init();
loadScene();
setupGUI();
render();

function init()
{
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(new THREE.Color(0xdde8f2));

  renderer.autoClear = false;  // borro yo a mano, pa' poder pintar el minimapa encima

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  renderer.outputEncoding = THREE.sRGBEncoding;
  document.getElementById('container').appendChild(renderer.domElement);

  textCanvas = document.getElementById('text_canvas');
  ctx = textCanvas.getContext('2d');
  textCanvas.width = window.innerWidth;
  textCanvas.height = window.innerHeight;

  scene = new THREE.Scene();

  const aspectRatio = window.innerWidth / window.innerHeight;
  camera = new THREE.PerspectiveCamera(60, aspectRatio, 0.1, 3000);
  camera.position.set(0, 40, -80);

  cameraControls = new THREE.OrbitControls(camera, renderer.domElement);
  cameraControls.enabled = false;

  // Camara del minimapa: ortografica mirando desde arriba, y ademas ve la capa 1 (marcadores)
  camaraMapa = new THREE.OrthographicCamera(-240, 240, 240, -240, 1, 1000);
  camaraMapa.position.set(0, 400, 0);
  camaraMapa.up.set(0, 0, 1);
  camaraMapa.lookAt(0, 0, 0);
  camaraMapa.layers.enable(1);

  window.addEventListener('resize', updateAspectRatio);
}

function loadScene()
{
  crearCielo();
  crearLuces();

  // en cadena: primero el terreno (los arboles necesitan su altura), luego la moto y ya se puede jugar
  cargarTerreno(function() {
    crearArboles(75);
    crearColeccionables();

    cargarModeloMoto(function() {
      crearVehiculos();
      prepararPartida();
      estado = 'inicio';
    });
  });
}

function setupGUI()
{
  const gui = new lil.GUI({ title: 'Opciones' });
  gui.add(ajustes, 'duracion', 30, 300, 10).name('Duración (s)');
  gui.add(ajustes, 'rivales', 0, 3, 1).name('Rivales');
  gui.add(ajustes, 'reiniciar').name('Reiniciar partida');
  // cambio la intensidad del sol directamente; si la bajo se nota mas el foco de la moto
  gui.add(sol, 'intensity', 0, 1, 0.05).name('Luz del sol');
  gui.close();
}

function prepararPartida()
{
  for (let k = 0; k < vehiculos.length; k++) {
    const v = vehiculos[k];

    v.activo = v.esJugador || k <= ajustes.rivales;  // solo juegan los rivales que diga la gui
    v.nodo.visible = v.activo;
    colocarEnSalida(v, k);
  }
  colocarTodosLosObjetos();
  tiempoRestante = ajustes.duracion;
  tiempoMensaje = 0;

  const p = jugador.nodo.position;
  camera.position.set(p.x, p.y + alturaCamara, p.z - distanciaCamara);
  miradaCamara.set(p.x, p.y + 1.5, p.z);
}

function reiniciarPartida()
{
  prepararPartida();
  estado = 'cuenta';
  cuentaAtras = 3;
  if (pausa) cambiarPausa();
}

function cambiarCamara()
{
  if (estado === 'cargando') return;
  camaraOrbital = !camaraOrbital;
  cameraControls.enabled = camaraOrbital;
  if (camaraOrbital) {
    cameraControls.target.copy(jugador.nodo.position);
    cameraControls.update();
  }
}

function cambiarPausa()
{
  if (estado === 'cargando') return;
  pausa = !pausa;
  if (pausa !== camaraOrbital) cambiarCamara();
}

function mostrarMensaje(texto, color)
{
  mensaje = texto;
  colorMensaje = color;
  tiempoMensaje = 2;
}

function avisarRobo(ladron, victima, robados)
{
  if (robados === 0) return;
  if (ladron.esJugador)
    mostrarMensaje('¡Has robado ' + robados + ' puntos a ' + victima.nombre + '!', '#7CFC00');
  else if (victima.esJugador)
    mostrarMensaje('¡' + ladron.nombre + ' te ha robado ' + robados + ' puntos!', '#ff5050');
  else
    mostrarMensaje(ladron.nombre + ' roba ' + robados + ' puntos a ' + victima.nombre, ladron.css);
}

function updateAspectRatio()
{
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  textCanvas.width = window.innerWidth;
  textCanvas.height = window.innerHeight;
}

// Camara en 3a persona: se pone detras de la moto y la sigue suave con lerp, sin meterse en el suelo
function actualizarCamara()
{
  const p = jugador.nodo.position;
  const objetivo = new THREE.Vector3(
    p.x - Math.sin(jugador.angulo) * distanciaCamara,
    p.y + alturaCamara,
    p.z - Math.cos(jugador.angulo) * distanciaCamara
  );

  const suelo = alturaTerreno(objetivo.x, objetivo.z) + 1.5;
  if (objetivo.y < suelo) objetivo.y = suelo;

  camera.position.lerp(objetivo, 0.08);
  if (camera.position.y < alturaTerreno(camera.position.x, camera.position.z) + 1)
    camera.position.y = alturaTerreno(camera.position.x, camera.position.z) + 1;

  miradaCamara.lerp(new THREE.Vector3(p.x, p.y + 1.5, p.z), 0.3);
  camera.lookAt(miradaCamara);
}

function update()
{
  // segs desde el frame anterior (con tope, x si la pestaña se queda parada y luego pega un salto)
  const dt = Math.min(clock.getDelta(), 0.05);
  tiempo += dt;

  if (estado === 'cargando') return;

  if (pausa) {
    cameraControls.update();
    return;
  }

  actualizarColeccionables(dt);

  if (estado === 'cuenta') {
    cuentaAtras -= dt;
    if (cuentaAtras <= 0) {
      estado = 'jugando';
      mostrarMensaje('¡YA!', '#ffd400');
    }
  }
  else if (estado === 'jugando') {
    // paso las teclas a -1, 0 o 1 (si se pulsan las 2 se anulan)
    const acelerar = (controls.moveForward ? 1 : 0) - (controls.moveBackward ? 1 : 0);
    const girar = (controls.moveLeft ? 1 : 0) - (controls.moveRight ? 1 : 0);
    moverVehiculo(jugador, acelerar, girar, dt);

    for (let k = 0; k < vehiculos.length; k++) {
      const v = vehiculos[k];
      if (v.activo && !v.esJugador) actualizarIA(v, dt);
    }

    for (let k = 0; k < vehiculos.length; k++) {
      const v = vehiculos[k];
      if (!v.activo) continue;
      const obj = comprobarRecogida(v);
      if (obj !== null) {
        v.puntos += obj.puntos;
        if (v.esJugador)
          mostrarMensaje('+' + obj.puntos + (obj.tipo === 'bandera' ? '  ¡Bandera!' : ''), '#ffd400');
      }
    }

    comprobarChoquesEntreMotos();

    tiempoRestante -= dt;
    if (tiempoRestante <= 0) {
      tiempoRestante = 0;
      estado = 'fin';
    }
  }
  else if (estado === 'fin') {
    for (let k = 0; k < vehiculos.length; k++)
      if (vehiculos[k].activo) moverVehiculo(vehiculos[k], 0, 0, dt);
  }

  for (let k = 0; k < vehiculos.length; k++)
    if (vehiculos[k].activo) animarMoto(vehiculos[k], dt, tiempo);

  const p = jugador.nodo.position;
  // El sol se mueve con el jugador para que siempre haya sombras a su alrededor
  sol.target.position.copy(p);
  sol.position.set(p.x - 50, p.y + 80, p.z + 40);

  if (camaraOrbital) cameraControls.update();
  else actualizarCamara();

  skybox.position.copy(camera.position);  // el cielo va con la camara, asi nunca se llega al borde

  if (tiempoMensaje > 0) tiempoMensaje -= dt;
}

function render()
{
  requestAnimationFrame(render);
  update();

  const ancho = window.innerWidth;
  const alto = window.innerHeight;

  renderer.setViewport(0, 0, ancho, alto);
  renderer.setScissorTest(false);
  renderer.clear();
  renderer.render(scene, camera);

  // minimapa: vuelvo a pintar la escena en un cuadrado abajo a la izq con la camara de arriba
  // (scissor pa' que el clear solo borre ese trozo, y quito el cielo porque si no lo tapa todo)
  if (estado !== 'cargando') {
    const lado = Math.floor(Math.min(ancho, alto) / 4);
    renderer.setViewport(10, 10, lado, lado);
    renderer.setScissor(10, 10, lado, lado);
    renderer.setScissorTest(true);
    renderer.clear();
    skybox.visible = false;
    renderer.render(scene, camaraMapa);
    skybox.visible = true;
    renderer.setScissorTest(false);
  }

  dibujarHUD();
}

// De 3D a pixeles de pantalla (como en s4-gui-text). delante = false si el punto queda detras de la camara
function projectVertexTo2D(vertex, camera)
{
  const vector = vertex.clone();
  vector.project(camera);
  return {
    x: (vector.x * 0.5 + 0.5) * textCanvas.width,
    y: (-vector.y * 0.5 + 0.5) * textCanvas.height,
    delante: vector.z < 1
  };
}

function textoConSombra(texto, x, y, color)
{
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(texto, x + 2, y + 2);
  ctx.fillStyle = color;
  ctx.fillText(texto, x, y);
}

function formatoTiempo(s)
{
  const min = Math.floor(s / 60);
  const seg = Math.floor(s % 60);
  return min + ':' + (seg < 10 ? '0' : '') + seg;  // pone el 0 delante: 1:05 y no 1:5
}

function ranking()
{
  const lista = [];
  for (let k = 0; k < vehiculos.length; k++)
    if (vehiculos[k].activo) lista.push(vehiculos[k]);
  lista.sort(function(a, b) { return b.puntos - a.puntos; });  // de mas a menos puntos
  return lista;
}

function dibujarHUD()
{
  const w = textCanvas.width;
  const h = textCanvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.textBaseline = 'alphabetic';

  if (estado === 'cargando') {
    ctx.fillStyle = 'rgba(10,20,35,0.85)';
    ctx.fillRect(0, 0, w, h);
    ctx.font = 'bold 32px Arial';
    ctx.textAlign = 'center';
    textoConSombra('Cargando...', w / 2, h / 2, '#ffffff');
    return;
  }

  // nombre y puntos encima de cada rival q este cerca
  ctx.font = 'bold 15px Arial';
  ctx.textAlign = 'center';
  for (let k = 0; k < vehiculos.length; k++) {
    const v = vehiculos[k];
    if (!v.activo || v.esJugador) continue;
    if (v.nodo.position.distanceTo(camera.position) > 120) continue;
    const punto = v.nodo.position.clone();
    punto.y += 2.6;
    const p2d = projectVertexTo2D(punto, camera);
    if (p2d.delante)
      textoConSombra(v.nombre + ' (' + v.puntos + ')', p2d.x, p2d.y, v.css);
  }

  ctx.textAlign = 'left';
  ctx.font = 'bold 30px Arial';
  textoConSombra('Tiempo ' + formatoTiempo(tiempoRestante), 20, 42,
                 tiempoRestante < 10 && estado === 'jugando' ? '#ff5050' : '#ffffff');
  ctx.font = 'bold 20px Arial';
  textoConSombra(Math.round(Math.abs(jugador.velocidad) * 3.6) + ' km/h', 20, 72, '#ffffff');  // m/s * 3.6 = km/h

  const lista = ranking();
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(w - 210, 40, 195, 18 + lista.length * 28);
  ctx.font = 'bold 20px Arial';
  for (let k = 0; k < lista.length; k++) {
    const v = lista[k];
    const y = 66 + k * 28;
    ctx.fillStyle = v.css;
    ctx.fillRect(w - 198, y - 15, 16, 16);
    ctx.textAlign = 'left';
    textoConSombra((k + 1) + '. ' + v.nombre, w - 174, y, '#ffffff');
    ctx.textAlign = 'right';
    textoConSombra(String(v.puntos), w - 28, y, '#ffd400');
  }

  const lado = Math.floor(Math.min(w, h) / 4);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = 2;
  ctx.strokeRect(10, h - 10 - lado, lado, lado);

  ctx.textAlign = 'right';
  ctx.font = '14px Arial';
  textoConSombra('WASD/flechas: conducir   C: cámara libre   P: pausa   R: reiniciar',
                 w - 15, h - 15, '#ffffff');

  ctx.textAlign = 'center';
  ctx.font = 'bold 26px Arial';
  if (tiempoMensaje > 0)
    textoConSombra(mensaje, w / 2, h * 0.28, colorMensaje);

  if (estado === 'inicio') {
    panel(w, h, 520, 250);
    ctx.font = 'bold 40px Arial';
    textoConSombra('Carrera en la nieve', w / 2, h / 2 - 70, '#ffffff');
    ctx.font = '19px Arial';
    textoConSombra('Recoge monedas (1 punto) y banderas (5 puntos)', w / 2, h / 2 - 25, '#ffffff');
    textoConSombra('antes de que se acabe el tiempo.', w / 2, h / 2 + 1, '#ffffff');
    textoConSombra('Si embistes a un rival le robas ' + PUNTOS_ROBO + ' puntos... y ellos a ti.', w / 2, h / 2 + 33, '#ffffff');
    ctx.font = 'bold 24px Arial';
    textoConSombra('Pulsa ENTER para empezar', w / 2, h / 2 + 80, '#ffd400');
  }
  else if (estado === 'cuenta') {
    ctx.font = 'bold 110px Arial';
    textoConSombra(String(Math.ceil(cuentaAtras)), w / 2, h / 2, '#ffffff');
  }
  else if (estado === 'fin') {
    panel(w, h, 460, 140 + lista.length * 40);
    ctx.font = 'bold 40px Arial';
    const gana = lista[0];
    textoConSombra(gana.esJugador ? '¡Has ganado!' : 'Gana ' + gana.nombre, w / 2, h / 2 - 50 - lista.length * 20 + 20, '#ffd400');
    ctx.font = 'bold 24px Arial';
    for (let k = 0; k < lista.length; k++)
      textoConSombra((k + 1) + '.  ' + lista[k].nombre + '   ' + lista[k].puntos + ' pts',
                     w / 2, h / 2 - lista.length * 20 + 40 + k * 40, lista[k].css);
    ctx.font = '20px Arial';
    textoConSombra('Pulsa ENTER o R para jugar otra vez', w / 2, h / 2 + lista.length * 20 + 50, '#ffffff');
  }

  if (pausa) {
    ctx.font = 'bold 48px Arial';
    textoConSombra('PAUSA', w / 2, h / 2, '#ffffff');
    ctx.font = '18px Arial';
    textoConSombra('Puedes mover la cámara con el ratón. P para continuar.', w / 2, h / 2 + 36, '#ffffff');
  }
}

function panel(w, h, pw, ph)
{
  ctx.fillStyle = 'rgba(10,25,45,0.65)';
  ctx.fillRect(w / 2 - pw / 2, h / 2 - ph / 2, pw, ph);
}
