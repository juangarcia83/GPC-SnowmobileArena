// ---------- terreno (heightmap) ----------

var terreno = null;

var hm_data = null, hm_ancho, hm_alto;

const escalaY = 70 / 255;
const escalaXZ = 4.0;
const repeticionNieve = 40;

const LIMITE_MAPA = 230;

// Pinta la imagen en un canvas 2D que no se ve, solo para poder leer sus pixeles (rgba seguidos)
function getImagePixelData(image)
{
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = image.width;
  canvas.height = image.height;
  context.drawImage(image, 0, 0, image.width, image.height);
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function cargarTerreno(alTerminar)
{
  const loader = new THREE.TextureLoader();

  // las cargas son asincronas, por eso anido los callbacks: asi tengo las 2 imagenes antes de seguir
  loader.load('images/heightmap.png', function(texturaHM) {
    loader.load('images/nieve.jpg', function(texturaNieve) {
      texturaNieve.wrapS = THREE.RepeatWrapping;
      texturaNieve.wrapT = THREE.RepeatWrapping;
      texturaNieve.encoding = THREE.sRGBEncoding;

      const ancho = texturaHM.image.width;
      const alto = texturaHM.image.height;
      const numVertices = ancho * alto;

      const datos = getImagePixelData(texturaHM.image);
      hm_data = new Float32Array(numVertices);
      hm_ancho = ancho;
      hm_alto = alto;
      // cada pixel son 4 valores (r,g,b,a); paso a gris y lo escalo a metros
      for (let i = 0; i < numVertices; i++) {
        const p = i * 4;
        const brillo = datos[p] * 0.299 + datos[p+1] * 0.587 + datos[p+2] * 0.114;
        hm_data[i] = brillo * escalaY;
      }

      const geometria = new THREE.BufferGeometry();
      const vertices = new Float32Array(numVertices * 3);
      const coords_uv = new Float32Array(numVertices * 2);

      // Un vertice por pixel, centrado en el origen. La uv se repite para que la nieve no se vea estirada
      for (let i = 0; i < alto; i++) {
        for (let j = 0; j < ancho; j++) {
          const index = i * ancho + j;
          vertices[index*3+0] = (i - alto/2) * escalaXZ;
          vertices[index*3+1] = hm_data[index];
          vertices[index*3+2] = (j - ancho/2) * escalaXZ;
          coords_uv[index*2+0] = i / alto * repeticionNieve;
          coords_uv[index*2+1] = j / ancho * repeticionNieve;
        }
      }

      // cada cuadradito de la malla son 2 triangulos (orden antihorario pa' que miren arriba)
      const indices = [];
      for (let i = 0; i < alto-1; i++) {
        for (let j = 0; j < ancho-1; j++) {
          const v0 = i * ancho + j;
          const v1 = (i+1) * ancho + j;
          const v2 = (i+1) * ancho + (j+1);
          const v3 = i * ancho + (j+1);
          indices.push(v0, v2, v1);
          indices.push(v0, v3, v2);
        }
      }

      geometria.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
      geometria.setAttribute('uv', new THREE.BufferAttribute(coords_uv, 2));
      geometria.setIndex(indices);

      geometria.computeVertexNormals();

      // Phong y no Lambert: Lambert calcula la luz solo en los vertices (Gouraud) y como hay uno
      // cada 4 m el foco de la moto casi no se veia. Phong la calcula en cada pixel
      const material = new THREE.MeshPhongMaterial({ map: texturaNieve, specular: 0x222222, shininess: 10 });
      terreno = new THREE.Mesh(geometria, material);
      terreno.receiveShadow = true;
      scene.add(terreno);

      alTerminar();
    });
  });
}

// Altura del suelo en cualquier punto: busco en que celda cae y en cual de sus 2 triangulos,
// y mezclo las alturas de sus 3 vertices (como las baricentricas de teoria)
function alturaTerreno(x, z)
{
  if (hm_data == null)
    return 0;

  const fi = THREE.MathUtils.clamp(x / escalaXZ + hm_alto/2, 0, hm_alto - 1.001);
  const fj = THREE.MathUtils.clamp(z / escalaXZ + hm_ancho/2, 0, hm_ancho - 1.001);
  const i = Math.floor(fi);
  const j = Math.floor(fj);
  const di = fi - i;
  const dj = fj - j;

  const h0 = hm_data[i * hm_ancho + j];
  const h1 = hm_data[(i+1) * hm_ancho + j];
  const h2 = hm_data[(i+1) * hm_ancho + (j+1)];
  const h3 = hm_data[i * hm_ancho + (j+1)];

  if (di >= dj) {
    return h0 * (1 - di) + h1 * (di - dj) + h2 * dj;
  }
  else {
    return h0 * (1 - dj) + h3 * (dj - di) + h2 * di;
  }
}

// normal aproximada mirando la altura un poco a cada lado (diferencias finitas)
function normalTerreno(x, z, resultado)
{
  const d = 1.5;
  const dx = alturaTerreno(x + d, z) - alturaTerreno(x - d, z);
  const dz = alturaTerreno(x, z + d) - alturaTerreno(x, z - d);
  return resultado.set(-dx, 2 * d, -dz).normalize();
}

// pendiente = lo que se inclina la normal respecto a la vertical (0 es llano)
function pendienteTerreno(x, z)
{
  const n = normalTerreno(x, z, new THREE.Vector3());
  return Math.sqrt(n.x * n.x + n.z * n.z) / n.y;
}


// ---------- cielo, luces y arboles ----------

var skybox, materialesCielo = [];
var mapaEntorno;
var luzAmbiente, sol;
var obstaculos = [];

var imagenesCielo = [
  'images/cielo_px.jpg', 'images/cielo_nx.jpg',
  'images/cielo_py.jpg', 'images/cielo_ny.jpg',
  'images/cielo_pz.jpg', 'images/cielo_nz.jpg'
];

function crearCielo()
{
  const cargador = new THREE.TextureLoader();
  for (let i = 0; i < imagenesCielo.length; i++) {
    const textura = cargador.load(imagenesCielo[i]);
    textura.encoding = THREE.sRGBEncoding;

    // BackSide pa' ver la caja desde dentro, y sin escribir en el z-buffer para que no tape nada
    materialesCielo.push(new THREE.MeshBasicMaterial({ map: textura, side: THREE.BackSide, depthWrite: false }));
  }
  skybox = new THREE.Mesh(new THREE.BoxGeometry(1500, 1500, 1500), materialesCielo);
  scene.add(skybox);

  // las mismas 6 fotos como cubemap para los reflejos (espejo de la moto, canto de las monedas)
  mapaEntorno = new THREE.CubeTextureLoader().load(imagenesCielo);
  mapaEntorno.encoding = THREE.sRGBEncoding;
}

function crearLuces()
{
  luzAmbiente = new THREE.AmbientLight(0xb8c8e0, 0.4);
  scene.add(luzAmbiente);

  sol = new THREE.DirectionalLight(0xfff1dd, 0.75);
  sol.position.set(-60, 70, 60);
  sol.castShadow = true;
  // Caja de la camara de sombras pequeña (sigue al jugador), asi las sombras salen mas nitidas
  sol.shadow.camera.left = -45;
  sol.shadow.camera.right = 45;
  sol.shadow.camera.top = 45;
  sol.shadow.camera.bottom = -45;
  sol.shadow.camera.near = 1;
  sol.shadow.camera.far = 300;
  sol.shadow.mapSize.set(2048, 2048);
  sol.shadow.bias = -0.0005;  // quita las rayitas raras (shadow acne)
  scene.add(sol);
  scene.add(sol.target);
}

// busca un sitio libre pa' un arbol: no muy lejos, no en la salida, sin cuesta y sin pisar otro
function posicionObstaculo(radio)
{
  for (let intento = 0; intento < 200; intento++) {
    const x = (Math.random() * 2 - 1) * 200;
    const z = (Math.random() * 2 - 1) * 200;
    if (x * x + z * z > 195 * 195) continue;
    if (Math.abs(x) < 30 && Math.abs(z) < 30) continue;
    if (pendienteTerreno(x, z) > 0.45) continue;
    if (chocaConObstaculo(x, z, radio + 5) !== null) continue;
    return { x: x, z: z };
  }
  return null;
}

// Colision circulo-circulo en el plano XZ. Devuelve el arbol con el que choca o null
function chocaConObstaculo(x, z, radio)
{
  for (let k = 0; k < obstaculos.length; k++) {
    const o = obstaculos[k];
    const dx = x - o.x;
    const dz = z - o.z;
    if (dx * dx + dz * dz < (o.radio + radio) * (o.radio + radio))
      return o;
  }
  return null;
}

function crearArboles(cantidad)
{
  const geoTronco = new THREE.CylinderGeometry(0.35, 0.5, 2.4, 8);
  const geoCopa = new THREE.ConeGeometry(2.6, 3.6, 10);
  const geoNieve = new THREE.ConeGeometry(1.0, 1.3, 10);
  const matTronco = new THREE.MeshLambertMaterial({ color: 0x5a3d26 });
  const matCopa = new THREE.MeshLambertMaterial({ color: 0x1f4d34 });
  const matNieve = new THREE.MeshLambertMaterial({ color: 0xf4f8ff });

  for (let n = 0; n < cantidad; n++) {
    const escala = 0.8 + Math.random() * 0.8;
    const pos = posicionObstaculo(1.3 * escala);
    if (pos === null) continue;

    const arbol = new THREE.Object3D();

    const tronco = new THREE.Mesh(geoTronco, matTronco);
    tronco.position.y = 1.2;
    arbol.add(tronco);

    // 3 conos apilados, cada uno mas pequeño, para hacer el pino
    for (let p = 0; p < 3; p++) {
      const copa = new THREE.Mesh(geoCopa, matCopa);
      copa.position.y = 3.0 + p * 1.7;
      copa.scale.setScalar(1 - p * 0.25);
      arbol.add(copa);
    }
    const nieve = new THREE.Mesh(geoNieve, matNieve);
    nieve.position.y = 7.3;
    arbol.add(nieve);

    // traverse recorre todos los hijos del arbol
    arbol.traverse(function(objeto) {
      if (objeto.isMesh) objeto.castShadow = true;
    });

    arbol.scale.setScalar(escala);
    arbol.rotation.y = Math.random() * Math.PI * 2;
    arbol.position.set(pos.x, alturaTerreno(pos.x, pos.z) - 0.2, pos.z);
    scene.add(arbol);

    obstaculos.push({ x: pos.x, z: pos.z, radio: 1.3 * escala });
  }
}
