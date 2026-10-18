var modeloMoto = null;
var vehiculos = [];
var jugador = null;

const VEL_MAX = 26;
const VEL_MAX_ATRAS = 6;
const ACELERACION = 11;
const FRENADA = 25;
const ROZAMIENTO = 4;
const VEL_GIRO = 1.8;
const GRAVEDAD = 9.8;
const PENDIENTE_MAX = 0.62;
const RADIO_MOTO = 1.4;
const PUNTOS_ROBO = 2;

var datosVehiculos = [
  { nombre: 'Tú',     color: 0x1e88ff, css: '#1e88ff', esJugador: true },
  { nombre: 'Rojo',   color: 0xff3030, css: '#ff3030', esJugador: false },
  { nombre: 'Verde',  color: 0x2ecc40, css: '#2ecc40', esJugador: false },
  { nombre: 'Morado', color: 0xb04ce0, css: '#b04ce0', esJugador: false }
];

function cargarModeloMoto(alTerminar)
{
  const loader = new THREE.FBXLoader();
  // el fbx tarda en cargar, por eso le paso alTerminar y sigo cuando ya esta
  loader.load('models/moto/SnowmobileFULL.fbx', function(objeto) {
    objeto.traverse(function(hijo) {
      if (!hijo.isMesh) return;
      hijo.castShadow = true;
      hijo.receiveShadow = true;

      // unas piezas tienen 1 material y otras varios, asi lo trato siempre como lista
      const materiales = Array.isArray(hijo.material) ? hijo.material : [hijo.material];
      for (let i = 0; i < materiales.length; i++) {
        if (materiales[i].name === 'Glass') {
          materiales[i].transparent = true;
          materiales[i].opacity = 0.35;
        }

        if (materiales[i].name === 'mirror') {
          materiales[i].envMap = mapaEntorno;
          materiales[i].color.set(0xffffff);
        }
      }
    });

    modeloMoto = objeto;
    alTerminar();
  });
}

// Las piezas del FBX giran respecto al origen del modelo, no sobre si mismas.
// Meto la pieza dentro de un Object3D puesto en su centro y giro ese nodo
// (attach la cambia de padre sin que se mueva de sitio)
function crearPivote(pieza, padre)
{
  padre.updateMatrixWorld(true);
  const caja = new THREE.Box3().setFromObject(pieza);
  const centro = new THREE.Vector3();
  caja.getCenter(centro);

  const pivote = new THREE.Object3D();
  padre.add(pivote);
  pivote.position.copy(padre.worldToLocal(centro));
  pivote.updateMatrixWorld(true);
  pivote.attach(pieza);
  return pivote;
}

function crearVehiculo(datos)
{
  const v = {
    nombre: datos.nombre,
    color: datos.color,
    css: datos.css,
    esJugador: datos.esJugador,
    activo: true,
    puntos: 0,
    angulo: 0,
    velocidad: 0,
    giro: 0,
    enfriamiento: 0,

    objetivo: null,
    marchaAtras: 0
  };

  // Grafo: nodo (posicion y rumbo) -> carroceria (cabeceo, alabeo, vibracion) -> modelo y piezas
  v.nodo = new THREE.Object3D();
  v.carroceria = new THREE.Object3D();
  v.nodo.add(v.carroceria);

  // clone pa' no cargar el fbx una vez por cada moto. el modelo viene en cm, lo paso a metros
  const modelo = modeloMoto.clone();
  modelo.scale.set(0.01, 0.01, 0.01);
  v.carroceria.add(modelo);

  v.esquiIzq = crearPivote(modelo.getObjectByName('SteerL'), v.carroceria);
  v.esquiDer = crearPivote(modelo.getObjectByName('SteerR'), v.carroceria);
  v.manillar = crearPivote(modelo.getObjectByName('Handlebars'), v.carroceria);

  v.banderin = new THREE.Object3D();
  v.banderin.position.set(-0.35, 0.9, -1.55);
  v.carroceria.add(v.banderin);

  const palo = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.6, 6),
                              new THREE.MeshPhongMaterial({ color: 0x222222 }));
  palo.position.y = 0.8;
  v.banderin.add(palo);

  // banderin triangular hecho a mano con 3 vertices
  const geoBandera = new THREE.BufferGeometry();
  geoBandera.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 1.6, 0,
    0, 1.2, 0,
    0, 1.4, -0.7
  ], 3));
  geoBandera.computeVertexNormals();
  const bandera = new THREE.Mesh(geoBandera, new THREE.MeshLambertMaterial({ color: v.color, side: THREE.DoubleSide }));
  bandera.castShadow = true;
  v.banderin.add(bandera);

  // flecha gigante que solo sale en el minimapa (capa 1)
  const flecha = new THREE.Mesh(new THREE.ConeGeometry(11, 26, 3),
                                new THREE.MeshBasicMaterial({ color: v.color }));
  flecha.rotation.x = Math.PI / 2;
  flecha.position.y = 6;
  flecha.layers.set(1);
  v.nodo.add(flecha);

  // Foco delantero (luz focal como en la P5), solo en la moto del jugador.
  // Va colgado de la carroceria, asi se mueve y gira con la moto sin hacer nada mas
  if (v.esJugador) {
    // color, intensidad, distancia, angulo del cono y penumbra (borde suave)
    v.foco = new THREE.SpotLight(0xfff2cc, 1.5, 45, Math.PI / 6, 0.4);
    v.foco.position.set(0, 1.2, 2.2);
    v.foco.castShadow = true;
    v.foco.shadow.camera.near = 0.5;
    v.foco.shadow.camera.far = 45;
    v.carroceria.add(v.foco);
    // el foco ilumina hacia su target, lo pongo delante de la moto
    v.foco.target.position.set(0, 0, 14);
    v.carroceria.add(v.foco.target);
  }

  scene.add(v.nodo);
  return v;
}

function crearVehiculos()
{
  for (let k = 0; k < datosVehiculos.length; k++) {
    const v = crearVehiculo(datosVehiculos[k]);
    vehiculos.push(v);
    if (v.esJugador) jugador = v;
  }
}

function colocarEnSalida(v, k)
{
  const x = -9 + k * 6;
  const z = -12;
  v.angulo = 0;
  v.velocidad = 0;
  v.puntos = 0;
  v.giro = 0;
  v.enfriamiento = 0;
  v.objetivo = null;
  v.marchaAtras = 0;
  v.nodo.position.set(x, alturaTerreno(x, z), z);
  v.nodo.rotation.y = 0;
}

// deja el angulo entre -pi y pi, pa' que la ia gire x el lado mas corto
function normalizarAngulo(a)
{
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

function moverVehiculo(v, acelerar, girar, dt)
{
  const pos = v.nodo.position;

  let velMax = VEL_MAX;
  if (!v.esJugador) velMax = VEL_MAX * 0.9;

  if (acelerar > 0) {
    v.velocidad += ACELERACION * dt;
  }
  else if (acelerar < 0) {
    if (v.velocidad > 0) v.velocidad -= FRENADA * dt;
    else v.velocidad -= ACELERACION * 0.5 * dt;
  }
  else {
    if (v.velocidad > 0) v.velocidad = Math.max(0, v.velocidad - ROZAMIENTO * dt);
    else v.velocidad = Math.min(0, v.velocidad + ROZAMIENTO * dt);
  }

  // vector hacia donde mira la moto. Con el desnivel delante-detras se frena en subida y acelera en bajada
  const adelante = new THREE.Vector3(Math.sin(v.angulo), 0, Math.cos(v.angulo));
  const desnivel = (alturaTerreno(pos.x + adelante.x, pos.z + adelante.z) -
                    alturaTerreno(pos.x - adelante.x, pos.z - adelante.z)) / 2;
  v.velocidad -= GRAVEDAD * desnivel * 0.7 * dt;
  v.velocidad = THREE.MathUtils.clamp(v.velocidad, -VEL_MAX_ATRAS, velMax);

  // parada no gira, y marcha atras gira al reves (como un coche)
  const factorGiro = THREE.MathUtils.clamp(v.velocidad / 6, -1, 1);
  v.angulo += girar * VEL_GIRO * factorGiro * dt;
  v.giro = girar;
  adelante.set(Math.sin(v.angulo), 0, Math.cos(v.angulo));

  // Calculo la posicion nueva y, antes de moverme, miro si se puede (cuesta, arboles)
  const nueva = pos.clone().addScaledVector(adelante, v.velocidad * dt);
  nueva.x = THREE.MathUtils.clamp(nueva.x, -LIMITE_MAPA, LIMITE_MAPA);
  nueva.z = THREE.MathUtils.clamp(nueva.z, -LIMITE_MAPA, LIMITE_MAPA);
  nueva.y = alturaTerreno(nueva.x, nueva.z);

  let resultado = 'ok';
  const avance = pos.distanceTo(new THREE.Vector3(nueva.x, pos.y, nueva.z));

  if (avance > 0 && (nueva.y - pos.y) / avance > PENDIENTE_MAX) {
    v.velocidad = 0;
    resultado = 'pendiente';
  }
  else if (seAcercaAUnArbol(pos, nueva)) {
    v.velocidad = -v.velocidad * 0.3;
    resultado = 'choque';
  }
  else {
    pos.copy(nueva);
  }

  v.nodo.rotation.y = v.angulo;

  return resultado;
}

// solo cuenta como choque si me acerco al arbol, asi si ya estoy pegado puedo irme
function seAcercaAUnArbol(actual, nueva)
{
  const o = chocaConObstaculo(nueva.x, nueva.z, RADIO_MOTO);
  if (o === null) return false;
  const dNueva = (nueva.x - o.x) * (nueva.x - o.x) + (nueva.z - o.z) * (nueva.z - o.z);
  const dActual = (actual.x - o.x) * (actual.x - o.x) + (actual.z - o.z) * (actual.z - o.z);
  return dNueva < dActual;
}

function animarMoto(v, dt, tiempo)
{
  const pos = v.nodo.position;
  const factorVel = Math.min(Math.abs(v.velocidad) / VEL_MAX, 1);

  // miro la altura delante/detras y a izq/dcha pa' sacar cuanto se inclina la moto con el terreno
  const ax = Math.sin(v.angulo), az = Math.cos(v.angulo);
  const ix = Math.cos(v.angulo), iz = -Math.sin(v.angulo);
  const hDelante = alturaTerreno(pos.x + ax * 1.5, pos.z + az * 1.5);
  const hDetras = alturaTerreno(pos.x - ax * 1.5, pos.z - az * 1.5);
  const hIzq = alturaTerreno(pos.x + ix, pos.z + iz);
  const hDer = alturaTerreno(pos.x - ix, pos.z - iz);
  const cabeceo = Math.atan2(hDetras - hDelante, 3);
  const alabeo = Math.atan2(hIzq - hDer, 2);

  const inclinacionCurva = -v.giro * 0.2 * factorVel;

  // lerp: cada frame me acerco un 20% al valor objetivo, asi no pega saltos
  v.carroceria.rotation.x = THREE.MathUtils.lerp(v.carroceria.rotation.x, cabeceo, 0.2);
  v.carroceria.rotation.z = THREE.MathUtils.lerp(v.carroceria.rotation.z, alabeo + inclinacionCurva, 0.2);

  v.esquiIzq.rotation.y = THREE.MathUtils.lerp(v.esquiIzq.rotation.y, v.giro * 0.35, 0.2);
  v.esquiDer.rotation.y = THREE.MathUtils.lerp(v.esquiDer.rotation.y, v.giro * 0.35, 0.2);
  v.manillar.rotation.y = THREE.MathUtils.lerp(v.manillar.rotation.y, v.giro * 0.4, 0.2);

  v.carroceria.position.y = Math.sin(tiempo * 30) * 0.02 * factorVel;  // vibracion del motor

  v.banderin.rotation.x = -0.5 * factorVel;

  if (v.enfriamiento > 0) v.enfriamiento -= dt;
}

// IA sencilla: va a por el objeto mas cercano, esquiva arboles y si se atasca va marcha atras un rato
function actualizarIA(v, dt)
{
  const pos = v.nodo.position;

  if (v.marchaAtras > 0) {
    v.marchaAtras -= dt;
    moverVehiculo(v, -1, 0, dt);
    return;
  }

  if (v.objetivo === null || !v.objetivo.activo)
    v.objetivo = objetoMasCercano(pos);

  let acelerar = 1;
  let girar = 0;

  if (v.objetivo !== null) {
    // angulo hacia el objetivo y cuanto me falta girar
    const deseado = Math.atan2(v.objetivo.base.x - pos.x, v.objetivo.base.z - pos.z);
    const dif = normalizarAngulo(deseado - v.angulo);
    if (dif > 0.1) girar = 1;
    if (dif < -0.1) girar = -1;
    if (Math.abs(dif) > 0.7 && v.velocidad > 10) acelerar = -1;
  }

  // miro 7 m x delante, si hay arbol giro
  const px = pos.x + Math.sin(v.angulo) * 7;
  const pz = pos.z + Math.cos(v.angulo) * 7;
  if (chocaConObstaculo(px, pz, 2.5) !== null) girar = -1;

  const resultado = moverVehiculo(v, acelerar, girar, dt);

  if (resultado !== 'ok') {
    v.marchaAtras = 1.0;
    v.objetivo = objetoAlAzar();
  }
}

function comprobarChoquesEntreMotos()
{
  const distMin = RADIO_MOTO * 2;

  // todas las parejas de motos una sola vez (j empieza en i+1)
  for (let i = 0; i < vehiculos.length; i++) {
    for (let j = i + 1; j < vehiculos.length; j++) {
      const a = vehiculos[i];
      const b = vehiculos[j];
      if (!a.activo || !b.activo) continue;

      const pa = a.nodo.position;
      const pb = b.nodo.position;
      const dx = pb.x - pa.x;
      const dz = pb.z - pa.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d >= distMin || d === 0) continue;

      // Si se solapan, separo cada una la mitad del solape en direccion contraria
      const solape = (distMin - d) / 2;
      pa.x -= dx / d * solape;
      pa.z -= dz / d * solape;
      pb.x += dx / d * solape;
      pb.z += dz / d * solape;

      // enfriamiento: pa' que no roben puntos en todos los frames que estan pegadas
      if (a.enfriamiento > 0 || b.enfriamiento > 0) continue;

      // roba el q iba mas rapido
      let ladron = a, victima = b;
      if (b.velocidad > a.velocidad) {
        ladron = b;
        victima = a;
      }

      const robados = Math.min(PUNTOS_ROBO, victima.puntos);
      ladron.puntos += robados;
      victima.puntos -= robados;
      a.enfriamiento = 2.5;
      b.enfriamiento = 2.5;
      victima.velocidad *= 0.3;
      avisarRobo(ladron, victima, robados);
    }
  }
}
