var coleccionables = [];

const NUM_MONEDAS = 30;
const NUM_BANDERAS = 5;
const RADIO_RECOGIDA = 2.6;

function crearColeccionables()
{
  const cargador = new THREE.TextureLoader();

  const texMoneda = cargador.load('images/moneda.png');
  texMoneda.encoding = THREE.sRGBEncoding;

  // giro la textura 90º sobre su centro pa' que la moneda no salga torcida
  texMoneda.center.set(0.5, 0.5);
  texMoneda.rotation = Math.PI / 2;

  const matCanto = new THREE.MeshPhongMaterial({ color: 0xd9a020, specular: 0xffffff, shininess: 100,
                                                 envMap: mapaEntorno, reflectivity: 0.25 });
  const matCara = new THREE.MeshPhongMaterial({ map: texMoneda, specular: 0xffffff, shininess: 100,
                                                emissive: 0x332200 });

  // el cilindro sale de pie, lo tumbo para que parezca una moneda
  const geoMoneda = new THREE.CylinderGeometry(1, 1, 0.22, 32);
  geoMoneda.rotateX(Math.PI / 2);

  const geoMarcador = new THREE.CylinderGeometry(9, 9, 0.5, 12);
  const matMarcadorMoneda = new THREE.MeshBasicMaterial({ color: 0xffd400 });
  const matMarcadorBandera = new THREE.MeshBasicMaterial({ color: 0xff2020 });

  for (let n = 0; n < NUM_MONEDAS; n++) {
    const nodo = new THREE.Object3D();
    // Un material por cada parte del cilindro: el canto, la cara de arriba y la de abajo
    const moneda = new THREE.Mesh(geoMoneda, [matCanto, matCara, matCara]);
    moneda.position.y = 1.6;
    moneda.rotation.y = Math.random() * Math.PI;
    moneda.castShadow = true;
    nodo.add(moneda);

    // capa 1: solo lo pinta la camara del minimapa, la normal no lo ve
    const marcador = new THREE.Mesh(geoMarcador, matMarcadorMoneda);
    marcador.layers.set(1);
    nodo.add(marcador);

    scene.add(nodo);
    // guardo la malla pa' poder girarla luego en la animacion
    coleccionables.push({ tipo: 'moneda', puntos: 1, nodo: nodo, malla: moneda,
                          activo: false, espera: 0, base: new THREE.Vector3() });
  }

  // La senyera de la Comunitat Valenciana como textura de la tela
  const texBandera = cargador.load('images/bandera.png');
  texBandera.encoding = THREE.sRGBEncoding;

  const matTela = new THREE.MeshLambertMaterial({ map: texBandera, side: THREE.DoubleSide });
  const matMastil = new THREE.MeshPhongMaterial({ color: 0xcccccc, specular: 0xffffff, shininess: 60 });
  const geoMastil = new THREE.CylinderGeometry(0.08, 0.1, 4.6, 8);
  const geoTela = new THREE.PlaneGeometry(2.4, 1.6);  // 3:2 como la imagen
  // muevo la geometria pa' que su borde izq quede en el origen, asi al rotarla gira sobre el mastil
  geoTela.translate(1.2, 0, 0);

  for (let n = 0; n < NUM_BANDERAS; n++) {
    const nodo = new THREE.Object3D();

    const mastil = new THREE.Mesh(geoMastil, matMastil);
    mastil.position.y = 2.3;
    mastil.castShadow = true;
    nodo.add(mastil);

    const tela = new THREE.Mesh(geoTela, matTela);
    tela.position.set(0, 3.7, 0);  // la franja azul queda pegada al mastil
    tela.castShadow = true;
    nodo.add(tela);

    const marcador = new THREE.Mesh(geoMarcador, matMarcadorBandera);
    marcador.scale.set(1.6, 1, 1.6);
    marcador.layers.set(1);
    nodo.add(marcador);

    scene.add(nodo);
    coleccionables.push({ tipo: 'bandera', puntos: 5, nodo: nodo, malla: tela,
                          activo: false, espera: 0, base: new THREE.Vector3() });
  }
}

function colocarTodosLosObjetos()
{
  for (let k = 0; k < coleccionables.length; k++)
    colocarObjeto(coleccionables[k]);
}

function colocarObjeto(obj)
{
  // Pruebo sitios al azar hasta dar con uno bueno: dentro del valle, sin mucha cuesta y sin arboles
  let x = 0, z = 0;
  for (let intento = 0; intento < 300; intento++) {
    const cx = (Math.random() * 2 - 1) * 185;
    const cz = (Math.random() * 2 - 1) * 185;
    if (cx * cx + cz * cz > 185 * 185) continue;
    if (pendienteTerreno(cx, cz) > 0.4) continue;
    if (chocaConObstaculo(cx, cz, 3) !== null) continue;
    // las banderas intento que salgan arriba de las colinas (si tras 250 intentos no hay manera, da igual)
    if (obj.tipo === 'bandera' && intento < 250 && alturaTerreno(cx, cz) < 24) continue;

    x = cx;
    z = cz;
    if (lejosDeOtros(obj, x, z)) break;
  }

  obj.base.set(x, alturaTerreno(x, z), z);
  obj.nodo.position.copy(obj.base);
  obj.nodo.visible = true;
  obj.activo = true;
}

function lejosDeOtros(obj, x, z)
{
  for (let k = 0; k < coleccionables.length; k++) {
    const otro = coleccionables[k];
    if (otro === obj || !otro.activo) continue;
    if (Math.abs(otro.base.x - x) < 10 && Math.abs(otro.base.z - z) < 10) return false;
  }
  return true;
}

function comprobarRecogida(vehiculo)
{
  const p = vehiculo.nodo.position;
  for (let k = 0; k < coleccionables.length; k++) {
    const obj = coleccionables[k];
    if (!obj.activo) continue;
    // Comparo distancias al cuadrado, asi no hace falta hacer la raiz
    const dx = p.x - obj.base.x;
    const dz = p.z - obj.base.z;
    if (dx * dx + dz * dz < RADIO_RECOGIDA * RADIO_RECOGIDA) {
      obj.activo = false;
      obj.nodo.visible = false;
      obj.espera = (obj.tipo === 'moneda') ? 2 : 6;  // segs hasta q vuelve a salir en otro sitio
      return obj;
    }
  }
  return null;
}

function actualizarColeccionables(dt)
{
  for (let k = 0; k < coleccionables.length; k++) {
    const obj = coleccionables[k];
    if (!obj.activo) {
      obj.espera -= dt;
      if (obj.espera <= 0) colocarObjeto(obj);
    }
    else if (obj.tipo === 'moneda') {
      // la moneda gira sobre el eje y (2 rad por segundo)
      obj.malla.rotation.y += 2 * dt;
    }
    else {
      // la bandera va y viene con un seno, como si hiciera viento
      obj.malla.rotation.y = Math.sin(tiempo * 2) * 0.3;
    }
  }
}

function objetoMasCercano(posicion)
{
  let mejor = null;
  let mejorDistancia = Infinity;
  for (let k = 0; k < coleccionables.length; k++) {
    const obj = coleccionables[k];
    if (!obj.activo) continue;
    const distancia = posicion.distanceTo(obj.base);
    if (distancia < mejorDistancia) {
      mejorDistancia = distancia;
      mejor = obj;
    }
  }
  return mejor;
}

function objetoAlAzar()
{
  const k = Math.floor(Math.random() * coleccionables.length);
  if (coleccionables[k].activo) return coleccionables[k];
  return null;
}
