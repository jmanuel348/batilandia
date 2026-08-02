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

/* =========================================================
   Base de datos
   ========================================================= */
let tablasListas = false;

async function asegurarTablas(db){
  if (tablasListas) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS pedidos (
      id        TEXT PRIMARY KEY,
      creado    INTEGER NOT NULL,
      estado    TEXT NOT NULL DEFAULT 'nuevo',
      cliente   TEXT,
      direccion TEXT,
      nota      TEXT,
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
  tablasListas = true;
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

  if (ruta === "/api/populares" && metodo === "GET")  return populares(env, url);
  if (ruta === "/api/pedidos"   && metodo === "POST") return crearPedido(request, env, url);
  if (ruta === "/api/pedidos"   && metodo === "GET")  return listarPedidos(request, env, url);

  const uno = ruta.match(/^\/api\/pedidos\/([a-z0-9]{1,40})$/);
  if (uno && metodo === "PATCH") return cambiarEstado(request, env, uno[1]);

  return problema("Esa dirección no existe.", 404);
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

  const sentencias = [
    env.DB.prepare(
      `INSERT INTO pedidos (id, creado, estado, cliente, direccion, nota, total, unidades, items, huella)
       VALUES (?, ?, 'nuevo', ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, creado, recortar(cuerpo.cliente), recortar(cuerpo.direccion),
           recortar(cuerpo.nota), total, unidades, JSON.stringify(items), huella)
  ];
  for (const it of items){
    sentencias.push(env.DB.prepare(
      `INSERT INTO lineas (pedido, producto, nombre, precio, cantidad, creado) VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(id, it.id, it.nombre, it.precio, it.cantidad, creado));
  }
  await env.DB.batch(sentencias);

  return responder({ id: id, total: total });
}

/* ---------- la lista del panel (privado) ---------- */
async function listarPedidos(request, env, url){
  if (!autorizado(request, env)) return problema("Clave incorrecta.", 401);
  if (!env.DB) return problema("Todavía no está creada la base de pedidos.", 503);
  await asegurarTablas(env.DB);

  const pedido = url.searchParams.get("estado") || "nuevo";
  const filtro = ["nuevo","entregado","cancelado","todos"].includes(pedido) ? pedido : "nuevo";

  const lista = await env.DB.prepare(
    `SELECT id, creado, estado, cliente, direccion, nota, total, unidades, items
       FROM pedidos
      WHERE (?1 = 'todos' OR estado = ?1)
      ORDER BY creado DESC
      LIMIT ?2`
  ).bind(filtro, PAGINA).all();

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
