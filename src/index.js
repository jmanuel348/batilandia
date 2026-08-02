/* =========================================================
   BATILANDIA — servidor
   Hace dos cosas:
     1. Sirve el sitio (la carpeta public).
     2. Guarda los pedidos y calcula cuáles se venden más.

   El menú sigue viviendo en datos.json y se edita desde el
   panel. Acá solo viven los pedidos.
   ========================================================= */

const CABECERAS = { "content-type": "application/json; charset=utf-8" };
const responder = (datos, estado) => new Response(JSON.stringify(datos), { status: estado || 200, headers: CABECERAS });
const problema  = (texto, estado) => responder({ error: texto }, estado || 400);

/* Cuánto mira hacia atrás para decidir qué es popular */
const DIAS_POPULARES = 30;
const CUANTOS_POPULARES = 6;
/* Piso para no coronar a un batido que se vendió una sola vez */
const MINIMO_POPULAR = 3;

/* Topes, para que nadie llene la base de basura */
const MAX_LINEAS   = 40;
const MAX_CANTIDAD = 99;
const MAX_TEXTO    = 300;
const TOPE_POR_IP  = 12;
const VENTANA_TOPE = 10 * 60 * 1000;

/* Cuántos pedidos devuelve la lista del panel */
const PAGINA = 80;

const DIA = 24 * 60 * 60 * 1000;

/* Carpeta del repositorio donde vive el sitio */
const CARPETA = "public/";

/* =========================================================
   GitHub, desde acá y no desde el teléfono
   El token vive como secreto en Cloudflare. Así el panel solo
   necesita una contraseña corta, y la llave con permiso de
   escritura nunca baja al teléfono de nadie.
   ========================================================= */
function faltaConfigurar(env){
  const faltan = [];
  if (!env.CLAVE_PANEL)  faltan.push("CLAVE_PANEL");
  if (!env.GITHUB_TOKEN) faltan.push("GITHUB_TOKEN");
  if (!env.GITHUB_REPO)  faltan.push("GITHUB_REPO");
  return faltan;
}

async function github(env, ruta, opciones){
  const url = "https://api.github.com/repos/" + env.GITHUB_REPO + "/contents/" + ruta;
  const r = await fetch(url, Object.assign({}, opciones, {
    headers: Object.assign({
      "Authorization": "Bearer " + env.GITHUB_TOKEN,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "batilandia"
    }, (opciones && opciones.headers) || {})
  }));
  if (!r.ok){
    let detalle = "";
    try { detalle = (await r.json()).message || ""; } catch(e){}
    if (r.status === 401) throw new Error("La llave de GitHub guardada en Cloudflare no sirve o ya venció.");
    if (r.status === 404) throw new Error("No se encontró el repositorio o el archivo. Revisá GITHUB_REPO.");
    throw new Error("GitHub respondió " + r.status + (detalle ? ": " + detalle : ""));
  }
  return r.json();
}

/* En tandas: con un solo spread, un archivo grande revienta la pila */
function aBase64(txt){
  const bytes = new TextEncoder().encode(txt);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const deBase64 = b64 => new TextDecoder().decode(
  Uint8Array.from(atob(String(b64).replace(/\s/g, "")), c => c.charCodeAt(0)));

async function escribirEnGitHub(env, ruta, base64, mensaje){
  let sha = null;
  try { sha = (await github(env, ruta + "?t=" + Date.now())).sha; } catch(e){ /* no existe: se crea */ }
  const cuerpo = { message: mensaje, content: base64 };
  if (sha) cuerpo.sha = sha;
  return github(env, ruta, { method:"PUT", body: JSON.stringify(cuerpo) });
}

/* =========================================================
   Base de datos
   ========================================================= */
let tablasListas = false;

async function asegurarTablas(db){
  if (tablasListas) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pedidos (
      id        TEXT PRIMARY KEY,
      codigo    TEXT,
      creado    INTEGER NOT NULL,
      estado    TEXT NOT NULL DEFAULT 'nuevo',
      cliente   TEXT,
      direccion TEXT,
      nota      TEXT,
      pago      TEXT,
      lat       REAL,
      lon       REAL,
      total     INTEGER NOT NULL,
      unidades  INTEGER NOT NULL,
      items     TEXT NOT NULL,
      huella    TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS lineas (
      pedido   TEXT NOT NULL,
      producto TEXT NOT NULL,
      nombre   TEXT NOT NULL,
      precio   INTEGER NOT NULL,
      cantidad INTEGER NOT NULL,
      creado   INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS i_pedidos_creado ON pedidos(creado)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS i_pedidos_estado ON pedidos(estado)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS i_lineas_creado  ON lineas(creado)`)
  ]);
  /* Para bases creadas antes de que existiera el código de pedido.
     Si la columna ya está, SQLite se queja y no pasa nada. */
  for (const col of ["codigo TEXT", "pago TEXT", "lat REAL", "lon REAL"]){
    try { await db.prepare(`ALTER TABLE pedidos ADD COLUMN ${col}`).run(); } catch(e){}
  }
  tablasListas = true;
}

/* Código corto para poder cruzar el chat de WhatsApp con el panel.
   Sin O ni 0 ni I ni 1, que se confunden al leerlos. */
const LETRAS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function codigoNuevo(){
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return Array.from(a, n => LETRAS[n % LETRAS.length]).join("");
}

/* =========================================================
   Utilidades
   ========================================================= */

/* Lee el menú publicado. Sirve para no creerle los precios al
   navegador: el total siempre se recalcula acá. */
async function leerMenu(env, url){
  try {
    const r = await env.ASSETS.fetch(new Request(new URL("/datos.json", url.origin)));
    if (!r.ok) return null;
    return await r.json();
  } catch(e){ return null; }
}

/* Compara sin filtrar por dónde falla, para no dar pistas */
function claveValida(dada, real){
  if (!real || !dada || dada.length !== real.length) return false;
  let dif = 0;
  for (let i = 0; i < dada.length; i++) dif |= dada.charCodeAt(i) ^ real.charCodeAt(i);
  return dif === 0;
}

function autorizado(request, env){
  const cabecera = request.headers.get("Authorization") || "";
  const dada = cabecera.replace(/^Bearer\s+/i, "").trim();
  return claveValida(dada, env.CLAVE_PANEL);
}

/* Guardamos una huella corta de la IP, no la IP. Alcanza para
   frenar a alguien mandando cien pedidos falsos. */
async function huellaDe(ip){
  if (!ip) return null;
  const bytes = new TextEncoder().encode("batilandia:" + ip);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash)).slice(0, 8)
    .map(b => b.toString(16).padStart(2, "0")).join("");
}

const recortar = t => String(t == null ? "" : t).trim().slice(0, MAX_TEXTO);
const idNuevo = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* Comienzo del día de hoy, en la hora del negocio */
function arranqueDelDia(zona){
  const desfase = (zona || 0) * 60 * 60 * 1000;
  const ahora = Date.now() + desfase;
  return Math.floor(ahora / DIA) * DIA - desfase;
}

/* =========================================================
   Rutas
   ========================================================= */
export default {
  async fetch(request, env, ctx){
    const url = new URL(request.url);

    /* Todo lo que no sea /api/ es el sitio de siempre */
    if (!url.pathname.startsWith("/api/")){
      return env.ASSETS ? env.ASSETS.fetch(request) : new Response("No encontrado", { status:404 });
    }

    try {
      return await despachar(request, env, url);
    } catch(e){
      return problema("Falló el servidor: " + e.message, 500);
    }
  }
};

async function despachar(request, env, url){
  const ruta = url.pathname;
  const metodo = request.method;

  if (ruta === "/api/populares"  && metodo === "GET")  return populares(env, url);
  if (ruta === "/api/pedidos"    && metodo === "POST") return crearPedido(request, env, url);
  if (ruta === "/api/pedidos"    && metodo === "GET")  return listarPedidos(request, env, url);

  /* Qué falta configurar. Público a propósito: la pantalla de entrada
     necesita poder avisar antes de que nadie escriba una contraseña. */
  if (ruta === "/api/estado" && metodo === "GET")
    return responder({ falta: faltaConfigurar(env), conBase: !!env.DB });

  if (ruta === "/api/contenido" && metodo === "GET") return leerContenido(request, env);
  if (ruta === "/api/contenido" && metodo === "PUT") return guardarContenido(request, env);
  if (ruta === "/api/foto"      && metodo === "POST") return subirFoto(request, env);

  const uno = ruta.match(/^\/api\/pedidos\/([a-z0-9]{1,40})$/);
  if (uno && metodo === "PATCH") return cambiarEstado(request, env, uno[1]);

  return problema("Esa dirección no existe.", 404);
}

/* ---------- el menú, leído y guardado por el servidor ---------- */
function revisarPanel(request, env){
  if (!autorizado(request, env)) return problema("Clave incorrecta.", 401);
  const faltan = faltaConfigurar(env);
  if (faltan.length) return problema("Falta configurar en Cloudflare: " + faltan.join(", "), 503);
  return null;
}

async function leerContenido(request, env){
  const mal = revisarPanel(request, env);
  if (mal) return mal;
  const j = await github(env, CARPETA + "datos.json?t=" + Date.now());
  return responder({ datos: JSON.parse(deBase64(j.content)) });
}

async function guardarContenido(request, env){
  const mal = revisarPanel(request, env);
  if (mal) return mal;

  let cuerpo;
  try { cuerpo = await request.json(); }
  catch(e){ return problema("El contenido llegó mal armado."); }
  const d = cuerpo.datos;
  /* Un guardado con la forma rota dejaría el sitio en blanco */
  if (!d || !Array.isArray(d.productos) || !Array.isArray(d.categorias) || !d.negocio)
    return problema("Ese contenido no tiene la forma de un menú.");

  await escribirEnGitHub(env, CARPETA + "datos.json",
    aBase64(JSON.stringify(d, null, 2)), "Actualización desde el panel");
  return responder({ ok: true });
}

const resbalar = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "foto";

async function subirFoto(request, env){
  const mal = revisarPanel(request, env);
  if (mal) return mal;

  let cuerpo;
  try { cuerpo = await request.json(); }
  catch(e){ return problema("La foto llegó mal armada."); }
  const b64 = String(cuerpo.base64 || "").replace(/\s/g, "");
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return problema("Eso no parece una foto.");
  if (b64.length > 8 * 1024 * 1024) return problema("La foto pesa demasiado.");

  const ruta = "fotos/" + resbalar(String(cuerpo.nombre || "")) + "-" + Date.now().toString(36) + ".jpg";
  await escribirEnGitHub(env, CARPETA + ruta, b64, "Foto: " + String(cuerpo.nombre || "").slice(0, 60));
  return responder({ ruta: ruta });
}

/* ---------- lo más vendido (público) ---------- */
async function populares(env, url){
  /* Sin base todavía: el sitio se comporta como antes */
  if (!env.DB) return responder({ ids: [] });
  await asegurarTablas(env.DB);

  const desde = Date.now() - DIAS_POPULARES * DIA;
  const { results } = await env.DB.prepare(
    `SELECT l.producto AS id, SUM(l.cantidad) AS vendidos
       FROM lineas l JOIN pedidos p ON p.id = l.pedido
      WHERE p.estado = 'entregado' AND l.creado > ?
      GROUP BY l.producto
      HAVING vendidos >= ?
      ORDER BY vendidos DESC
      LIMIT ?`
  ).bind(desde, MINIMO_POPULAR, CUANTOS_POPULARES).all();

  return new Response(JSON.stringify({ ids: (results || []).map(r => r.id) }), {
    headers: Object.assign({ "cache-control": "public, max-age=300" }, CABECERAS)
  });
}

/* ---------- entra un pedido (público) ---------- */
async function crearPedido(request, env, url){
  if (!env.DB) return problema("Todavía no está creada la base de pedidos.", 503);
  await asegurarTablas(env.DB);

  let cuerpo;
  try { cuerpo = await request.json(); }
  catch(e){ return problema("El pedido llegó mal armado."); }

  const pedidas = Array.isArray(cuerpo.lineas) ? cuerpo.lineas.slice(0, MAX_LINEAS) : [];
  if (!pedidas.length) return problema("El pedido venía vacío.");

  const menu = await leerMenu(env, url);
  if (!menu) return problema("No se pudo leer el menú.", 503);
  const porId = new Map(menu.productos.map(p => [p.id, p]));

  /* Precios y nombres salen del menú, no de lo que mandó el navegador */
  const items = [];
  let total = 0, unidades = 0;
  for (const linea of pedidas){
    const p = porId.get(String(linea.id));
    const cantidad = Math.min(Math.max(parseInt(linea.cantidad, 10) || 0, 0), MAX_CANTIDAD);
    if (!p || !cantidad) continue;
    items.push({ id:p.id, nombre:p.nombre, precio:p.precio, cantidad:cantidad });
    total += p.precio * cantidad;
    unidades += cantidad;
  }
  if (!items.length) return problema("Ninguno de esos batidos está en el menú.");

  const huella = await huellaDe(request.headers.get("CF-Connecting-IP"));
  if (huella){
    const { results } = await env.DB.prepare(
      `SELECT COUNT(*) AS cuantos FROM pedidos WHERE huella = ? AND creado > ?`
    ).bind(huella, Date.now() - VENTANA_TOPE).all();
    if (results && results[0] && results[0].cuantos >= TOPE_POR_IP){
      return problema("Demasiados pedidos seguidos. Esperá un momento.", 429);
    }
  }

  const id = idNuevo();
  const creado = Date.now();
  /* El sitio manda el código que ya escribió en el mensaje de WhatsApp;
     si no vino, generamos uno para que el pedido nunca quede sin. */
  const codigo = /^[A-Z0-9]{4,8}$/.test(String(cuerpo.codigo || ""))
    ? String(cuerpo.codigo) : codigoNuevo();

  /* Forma de pago: solo las dos que el sitio ofrece */
  const pago = ["efectivo","transferencia"].includes(cuerpo.pago) ? cuerpo.pago : "efectivo";

  /* La ubicación se guarda como dos números, nunca como un enlace que
     mandó el navegador: así el panel arma el suyo y nadie puede colar
     una dirección web cualquiera. */
  const punto = { lat:null, lon:null };
  const la = parseFloat(cuerpo.lat), lo = parseFloat(cuerpo.lon);
  if (isFinite(la) && isFinite(lo) && Math.abs(la) <= 90 && Math.abs(lo) <= 180){
    punto.lat = la; punto.lon = lo;
  }

  const sentencias = [
    env.DB.prepare(
      `INSERT INTO pedidos (id, codigo, creado, estado, cliente, direccion, nota, pago, lat, lon,
                            total, unidades, items, huella)
       VALUES (?, ?, ?, 'nuevo', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, codigo, creado, recortar(cuerpo.cliente), recortar(cuerpo.direccion),
           recortar(cuerpo.nota), pago, punto.lat, punto.lon,
           total, unidades, JSON.stringify(items), huella)
  ];
  for (const it of items){
    sentencias.push(env.DB.prepare(
      `INSERT INTO lineas (pedido, producto, nombre, precio, cantidad, creado) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, it.id, it.nombre, it.precio, it.cantidad, creado));
  }
  await env.DB.batch(sentencias);

  return responder({ id: id, codigo: codigo, total: total });
}

/* ---------- la lista del panel (privado) ---------- */
async function listarPedidos(request, env, url){
  if (!autorizado(request, env)) return problema("Clave incorrecta.", 401);
  if (!env.DB) return problema("Todavía no está creada la base de pedidos.", 503);
  await asegurarTablas(env.DB);

  const pedido = url.searchParams.get("estado") || "nuevo";
  const filtro = ["nuevo","entregado","cancelado","todos"].includes(pedido) ? pedido : "nuevo";

  /* Buscar por el código que sale en el chat, o por el nombre.
     Cuando se busca, el estado no filtra: si escribís el código
     querés ese pedido, esté donde esté. */
  const buscar = (url.searchParams.get("buscar") || "").trim().slice(0, 40);
  const como = "%" + buscar + "%";

  const lista = await env.DB.prepare(
    `SELECT id, codigo, creado, estado, cliente, direccion, nota, pago, lat, lon, total, unidades, items
       FROM pedidos
      WHERE (?1 <> '' OR ?2 = 'todos' OR estado = ?2)
        AND (?1 = '' OR codigo LIKE ?3 OR cliente LIKE ?3)
      ORDER BY creado DESC
      LIMIT ?4`
  ).bind(buscar, filtro, como, PAGINA).all();

  const menu = await leerMenu(env, url);
  const zona = menu && menu.horario ? menu.horario.zona : 0;
  const desdeHoy = arranqueDelDia(zona);

  const resumen = await env.DB.batch([
    env.DB.prepare(`SELECT COUNT(*) AS cuantos, COALESCE(SUM(total),0) AS plata
                      FROM pedidos WHERE estado = 'entregado' AND creado >= ?`).bind(desdeHoy),
    env.DB.prepare(`SELECT COUNT(*) AS cuantos FROM pedidos WHERE estado = 'nuevo'`),
    env.DB.prepare(`SELECT l.nombre AS nombre, SUM(l.cantidad) AS vendidos
                      FROM lineas l JOIN pedidos p ON p.id = l.pedido
                     WHERE p.estado = 'entregado' AND l.creado > ?
                     GROUP BY l.producto
                     HAVING vendidos >= ?
                     ORDER BY vendidos DESC
                     LIMIT ?`)
      .bind(Date.now() - DIAS_POPULARES * DIA, MINIMO_POPULAR, CUANTOS_POPULARES)
  ]);

  const hoy = resumen[0].results[0] || { cuantos:0, plata:0 };

  return responder({
    pedidos: (lista.results || []).map(p => Object.assign({}, p, { items: JSON.parse(p.items) })),
    resumen: {
      hoyCuantos: hoy.cuantos,
      hoyPlata:   hoy.plata,
      sinConfirmar: (resumen[1].results[0] || {}).cuantos || 0,
      dias: DIAS_POPULARES,
      minimo: MINIMO_POPULAR
    },
    top: resumen[2].results || []
  });
}

/* ---------- confirmar o cancelar (privado) ---------- */
async function cambiarEstado(request, env, id){
  if (!autorizado(request, env)) return problema("Clave incorrecta.", 401);
  if (!env.DB) return problema("Todavía no está creada la base de pedidos.", 503);
  await asegurarTablas(env.DB);

  let cuerpo;
  try { cuerpo = await request.json(); }
  catch(e){ return problema("Faltó decir el estado nuevo."); }

  const estado = String(cuerpo.estado || "");
  if (!["nuevo","entregado","cancelado"].includes(estado)) return problema("Ese estado no existe.");

  const r = await env.DB.prepare(`UPDATE pedidos SET estado = ? WHERE id = ?`).bind(estado, id).run();
  if (!r.meta || !r.meta.changes) return problema("No se encontró ese pedido.", 404);

  return responder({ id: id, estado: estado });
}
