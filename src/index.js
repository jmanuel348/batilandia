/* =========================================================
   BATILANDIA — servidor
   Hace dos cosas:
     1. Sirve el sitio (la carpeta public).
     2. Guarda el menú, las fotos y los pedidos en la base.

   Antes el menú se guardaba en GitHub y Cloudflare republicaba
   el sitio. Desde agosto de 2026 todo vive en la base de
   Cloudflare: el datos.json de la carpeta public queda solo
   como copia de arranque, para cuando el panel todavía no
   guardó nada.
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

/* =========================================================
   Configuración
   Antes hacían falta tres secretos: la clave del panel y dos
   de GitHub. Ahora el menú y las fotos viven en la base, así
   que con la clave del panel alcanza.
   ========================================================= */
function faltaConfigurar(env){
  const faltan = [];
  if (!env.CLAVE_PANEL) faltan.push("CLAVE_PANEL");
  return faltan;
}

/* La foto viaja como base64; para servirla hay que volverla bytes */
const aBytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));

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
    db.prepare(`CREATE TABLE IF NOT EXISTS contenido (
      clave       TEXT PRIMARY KEY,
      valor       TEXT NOT NULL,
      actualizado INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS fotos (
      ruta   TEXT PRIMARY KEY,
      imagen TEXT NOT NULL,
      creado INTEGER NOT NULL
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

/* El menú que guardó el panel, como texto JSON. Null si todavía no
   guardó ninguno: entonces vale el datos.json que viene con el sitio.
   Si la base falla, también null — el sitio nunca se queda en blanco. */
async function menuGuardado(env){
  if (!env.DB) return null;
  try {
    await asegurarTablas(env.DB);
    const fila = await env.DB.prepare(`SELECT valor FROM contenido WHERE clave = 'menu'`).first();
    return fila ? fila.valor : null;
  } catch(e){ return null; }
}

/* Lee el menú vigente. Sirve para no creerle los precios al
   navegador: el total siempre se recalcula acá. */
async function leerMenu(env, url){
  const guardado = await menuGuardado(env);
  if (guardado){
    try { return JSON.parse(guardado); } catch(e){ /* roto: vale el respaldo */ }
  }
  try {
    const r = await env.ASSETS.fetch(new Request(new URL("/datos.json", url.origin)));
    if (!r.ok) return null;
    return await r.json();
  } catch(e){ return null; }
}

/* Una foto guardada desde el panel, lista para mandar al navegador.
   El nombre es único (lleva la fecha), así que puede quedarse
   guardada en el teléfono para siempre. */
async function buscarFoto(env, ruta){
  if (!env.DB) return null;
  try {
    await asegurarTablas(env.DB);
    const fila = await env.DB.prepare(`SELECT imagen FROM fotos WHERE ruta = ?`).bind(ruta).first();
    if (!fila) return null;
    return new Response(aBytes(fila.imagen), {
      headers: {
        "content-type": "image/jpeg",
        "cache-control": "public, max-age=31536000, immutable"
      }
    });
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

    /* Todo lo que no sea /api/ es el sitio de siempre, salvo dos
       cosas que ahora viven en la base: el menú y las fotos. */
    if (!url.pathname.startsWith("/api/")){
      const lectura = request.method === "GET" || request.method === "HEAD";
      if (lectura && url.pathname === "/datos.json"){
        const guardado = await menuGuardado(env);
        if (guardado) return new Response(guardado, {
          headers: Object.assign({ "cache-control": "no-cache" }, CABECERAS)
        });
        /* nada guardado todavía: sigue el datos.json del sitio */
      }
      if (lectura && url.pathname.startsWith("/fotos/")){
        const foto = await buscarFoto(env, url.pathname.slice(1));
        if (foto) return foto;
        /* no está en la base: por si era una foto vieja del sitio */
      }
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
  /* Primero lo que falta configurar, y recién después la clave.
     Al revés, cuando no existe CLAVE_PANEL el panel decía "clave
     incorrecta" y mandaba a buscar un problema de contraseña que
     no era: lo que faltaba era la configuración entera. */
  const faltan = faltaConfigurar(env);
  if (faltan.length) return problema("Falta configurar en Cloudflare: " + faltan.join(", "), 503);
  if (!autorizado(request, env)) return problema("Clave incorrecta.", 401);
  return null;
}

/* Lo mismo para los pedidos, que además necesitan la base */
function revisarPedidos(request, env){
  if (!env.CLAVE_PANEL) return problema("Falta configurar en Cloudflare: CLAVE_PANEL", 503);
  if (!autorizado(request, env)) return problema("Clave incorrecta.", 401);
  if (!env.DB) return problema("Todavía no está creada la base de pedidos.", 503);
  return null;
}

async function leerContenido(request, env){
  const mal = revisarPanel(request, env);
  if (mal) return mal;
  const guardado = await menuGuardado(env);
  if (guardado) return responder({ datos: JSON.parse(guardado) });
  /* El panel todavía no guardó nada: vale la copia que trae el sitio */
  const r = await env.ASSETS.fetch(new Request(new URL("/datos.json", request.url)));
  if (!r.ok) return problema("No se pudo leer el menú.", 503);
  return responder({ datos: await r.json() });
}

async function guardarContenido(request, env){
  const mal = revisarPanel(request, env);
  if (mal) return mal;
  if (!env.DB) return problema("Todavía no está creada la base de datos; no hay dónde guardar el menú.", 503);

  let cuerpo;
  try { cuerpo = await request.json(); }
  catch(e){ return problema("El contenido llegó mal armado."); }
  const d = cuerpo.datos;
  /* Un guardado con la forma rota dejaría el sitio en blanco */
  if (!d || !Array.isArray(d.productos) || !Array.isArray(d.categorias) || !d.negocio)
    return problema("Ese contenido no tiene la forma de un menú.");

  await asegurarTablas(env.DB);
  await env.DB.prepare(
    `INSERT INTO contenido (clave, valor, actualizado) VALUES ('menu', ?, ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado = excluded.actualizado`
  ).bind(JSON.stringify(d), Date.now()).run();
  return responder({ ok: true });
}

const resbalar = s => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "foto";

async function subirFoto(request, env){
  const mal = revisarPanel(request, env);
  if (mal) return mal;
  if (!env.DB) return problema("Todavía no está creada la base de datos; no hay dónde guardar la foto.", 503);

  let cuerpo;
  try { cuerpo = await request.json(); }
  catch(e){ return problema("La foto llegó mal armada."); }
  const b64 = String(cuerpo.base64 || "").replace(/\s/g, "");
  if (!b64 || !/^[A-Za-z0-9+/=]+$/.test(b64)) return problema("Eso no parece una foto.");
  /* El panel las achica antes de mandar; este tope es por si acaso,
     y además una fila de la base no puede pasar de 2 MB. */
  if (b64.length > 1500 * 1024) return problema("La foto pesa demasiado.");

  await asegurarTablas(env.DB);
  const ruta = "fotos/" + resbalar(String(cuerpo.nombre || "")) + "-" + Date.now().toString(36) + ".jpg";
  await env.DB.prepare(`INSERT INTO fotos (ruta, imagen, creado) VALUES (?, ?, ?)`)
    .bind(ruta, b64, Date.now()).run();
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
  const mal = revisarPedidos(request, env);
  if (mal) return mal;
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
  const mal = revisarPedidos(request, env);
  if (mal) return mal;
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
