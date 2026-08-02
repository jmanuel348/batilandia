# Guía de Batilandia — publicar y administrar

> **Estado:** el sitio ya está en línea en `batilandia.josemanuelleivadiaz4.workers.dev` y el panel funciona. Falta comprar el dominio (Parte 3) y cargar el contenido real: horario, dirección, Facebook, descripciones y fotos.

## Cómo queda organizado el repositorio

Cloudflare cambió el sistema: ahora publica *Workers*, y necesita saber qué carpeta servir. Por eso los archivos del sitio van dentro de una carpeta `public`, y afuera queda un archivo de configuración.

```
batilandia/
├── wrangler.jsonc        ← le dice a Cloudflare qué publicar
├── src/
│   └── index.js          ← guarda los pedidos y cuenta los más vendidos
└── public/
    ├── index.html        ← el sitio que ven tus clientes
    ├── admin.html        ← tu panel
    ├── datos.json        ← batidos, precios, horario
    ├── manifest.json     ← deja guardar el sitio como app
    ├── sw.js             ← hace que abra sin señal
    ├── icono-192.png     ← el ícono de la app
    ├── icono-512.png
    ├── icono-180.png     ← el que usa iPhone
    └── fotos/            ← se crea sola cuando subís la primera foto
```

Vos nunca editás estos archivos a mano. Todo se maneja desde el panel.

---

## Parte 1 — Acomodar el repositorio

Ya tenés el repositorio `jmanuel348/batilandia` creado. Falta acomodar los archivos.

### Paso 1. Mover los archivos a `public`

GitHub no tiene botón de "mover", pero renombrar un archivo con una barra crea la carpeta sola. Sirve igual desde la computadora o el teléfono.

**Desde la computadora**

1. Entrá al repositorio y hacé clic en `index.html`.
2. Arriba a la derecha, clic en el ícono del **lápiz** (*Edit this file*).
3. Clic en la **casilla del nombre**, donde dice `index.html`.
4. Escribí `public/` justo adelante → queda `public/index.html`.
5. Botón verde **Commit changes…** → **Commit changes**.

**Desde el teléfono**

Igual, pero el lapicito puede no aparecer en Safari. Si pasa, tocá **AA** en la barra de direcciones → **Solicitar sitio web para computadora**.

Repetí con `admin.html` y `datos.json`. Al terminar, en la raíz del repositorio no debe quedar ningún `.html` ni `.json` suelto.

### Paso 2. Agregar `wrangler.jsonc`

1. En el repositorio, tocá **Add file** → **Create new file**.
2. Nombre del archivo: `wrangler.jsonc` — en la **raíz**, no dentro de `public`.
3. Pegá el contenido del archivo que te pasé.
4. **Commit changes**.

> Si más adelante cambiás el nombre del proyecto en Cloudflare, tiene que coincidir con el `"name"` de este archivo.

---

## Parte 2 — Desplegar en Cloudflare

Volvé a la pantalla **Set up your application** y llenala así:

| Campo | Qué poner |
|---|---|
| Repositorio | `jmanuel348/batilandia` |
| Project name | `batilandia` |
| Build command | **Vacío** |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | Dejalo como viene |
| Path | `/` |
| API token | Dejá *Create new token* |
| API token name | Vacío (si te lo exige, poné `batilandia`) |
| Variable name / value | **Vacíos** |

Tocá **Deploy**. Tarda uno o dos minutos y te va mostrando el registro. Si termina en verde, te da una dirección tipo `batilandia.jmanuel348.workers.dev`.

**Abrila y probá todo**: agregá batidos, mandate un pedido de prueba a tu propio WhatsApp.

> **Si el despliegue falla** con *Missing entry-point*, es que `wrangler.jsonc` no está en la raíz o la carpeta `public` está mal escrita. Revisá el Paso 1 y volvé a intentar — cada commit dispara un despliegue nuevo automáticamente.

---

## Parte 3 — El dominio

1. En Cloudflare, menú izquierdo → **Registro de dominios** → **Registrar dominio** → `batilandia.net`.
2. Volvé a tu proyecto en **Workers y Pages** → pestaña **Settings** → **Domains & Routes** → **Add** → **Custom domain**.
3. Escribí `batilandia.net`. Repetí con `www.batilandia.net`.

Cloudflare configura el DNS y el HTTPS solo.

Necesitás Visa o Mastercard habilitada para compras internacionales. Si la tuya no pasa, comprá en **namecheap.com** o **porkbun.com** y después agregás el dominio a Cloudflare.

---

## Parte 4 — Activar el panel

El panel necesita permiso para guardar en tu repositorio. Ese permiso es una **llave de acceso** que se genera una sola vez.

### Paso 3. Crear la llave

1. En GitHub: tu foto (arriba a la derecha) → **Settings**.
2. Al final del menú izquierdo → **Developer settings**.
3. **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.
4. Llenalo así:
   - **Token name:** `panel batilandia`
   - **Expiration:** 1 año (anotá la fecha en el calendario del teléfono)
   - **Repository access:** *Only select repositories* → `batilandia`
   - **Permissions** → *Repository permissions* → **Contents** → **Read and write**
5. **Generate token**.
6. **Copiá la llave ahora.** GitHub la muestra una sola vez. Guardala en Notas o en el llavero.

### Paso 4. Entrar

1. Abrí `batilandia.josemanuelleivadiaz4.workers.dev/admin.html` — cuando conectés el dominio, también va a funcionar en `batilandia.net/admin.html`
2. **Repositorio:** `jmanuel348/batilandia`
3. **Llave de acceso:** la que copiaste
4. **Entrar**

Queda guardada en ese teléfono, así que la próxima vez entra sola.

> **¿Es riesgoso que el panel esté público?** No. Sin la llave, quien abra esa dirección solo ve la pantalla de entrada. Si querés más discreción, renombrá el archivo a algo como `public/panel-8k2.html`.

---

## Parte 5 — Usar el panel

Tres pestañas: **Batidos**, **Categorías**, **Negocio**.

**Agregar un batido.** *Batidos* → **+ Nuevo** → categoría, nombre, precio, descripción y **Elegir foto** (te abre el rollo de cámara). Las fotos se achican solas antes de subir.

**Marcar agotado o popular.** En la lista, cada batido tiene dos botones: **★** para popular (sello dorado) y **✕** para agotado (se apaga y no se puede pedir). Un toque prende, otro apaga.

**Crear categorías.** *Categorías* → **+ Nueva**. Las flechas ↑↓ cambian el orden en el sitio. Para eliminar una, primero movés sus batidos a otra.

**Horario.** *Negocio* → tabla de los siete días. El sitio calcula solo si estás abierto. Los pedidos entran igual a toda hora; cuando está cerrado aparece un aviso de que lo confirmás al abrir.

**Publicar.** Nada sale al aire hasta que tocás **Publicar**. De ahí, cerca de un minuto.

---

## Parte 6 — Los pedidos

Hasta acá el sitio armaba el mensaje y lo abría en WhatsApp, pero no anotaba nada. Ahora sí: cada pedido queda guardado, vos confirmás cuáles entregaste, y con eso el sitio marca **solo** cuáles son los más pedidos. No tenés que andar poniendo la estrellita a mano.

Esto necesita una configuración de una sola vez. Son dos cosas: una base de datos y una clave.

### Paso 5. Crear la base de datos

1. En Cloudflare, menú izquierdo → **Almacenamiento y bases de datos** → **D1**.
2. **Crear** → nombre: `batilandia-pedidos` → **Crear**.
3. Cuando se abra, copiá el **Database ID** (una tira larga de letras y números).

### Paso 6. Encender la base en el repositorio

1. En GitHub, abrí `wrangler.jsonc` → lapicito.
2. Buscá el bloque que dice `BASE DE PEDIDOS`. Abajo hay cinco líneas que empiezan con `//`.
3. Borrá las `//` del principio de esas cinco líneas.
4. Donde dice `PEGAR-ACA-EL-ID-QUE-DA-CLOUDFLARE`, pegá el Database ID entre las comillas.
5. **Commit changes**.

Tiene que quedar así:

```jsonc
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "batilandia-pedidos",
      "database_id": "aquí va la tira larga que copiaste"
    }
  ],
```

### Paso 7. Crear la clave del panel

Es una contraseña que inventás vos. Sirve para que solo vos puedas ver los pedidos.

1. En Cloudflare → **Workers y Pages** → tu proyecto `batilandia`.
2. **Settings** → **Variables and Secrets** → **Add**.
3. Tipo: **Secret**. Nombre: `CLAVE_PANEL` — escrito igual, todo en mayúsculas.
4. Valor: la contraseña que quieras. Larga y que no sea tu cumpleaños.
5. **Save**. Anotala donde anotaste la llave de GitHub.

### Paso 8. Entrar

En el panel, la pantalla de entrada ahora tiene un tercer campo, **Clave de pedidos**. Poné ahí la que acabás de crear. Queda guardada igual que la otra.

Si lo dejás vacío, el panel sigue funcionando para todo lo demás; solo que la pestaña de Pedidos te va a decir que falta la clave.

### Cómo se usa

La pestaña **Pedidos** es la primera, y arriba te muestra cuántos entregaste hoy y cuánto vendiste.

Cada pedido que entra aparece en **Sin confirmar**, con el nombre, lo que pidió, el total, la dirección y la nota. Dos botones:

- **Entregado** — se lo diste y te pagó. Este es el que cuenta para las estadísticas.
- **No se concretó** — nunca llegó, se arrepintió, o fue una prueba.

Abajo de la lista está **Lo que más se vende**: el ranking de los últimos 30 días, contando solo lo que confirmaste como entregado. Los primeros seis salen marcados como **populares** en el sitio, automáticamente. Tarda hasta cinco minutos en reflejarse, y no hace falta publicar nada.

Pide un mínimo de tres vendidos para entrar. Es a propósito: sin ese piso, al principio un batido que se vendió una sola vez saldría coronado como el más pedido.

> **Importante.** El pedido se anota cuando el cliente toca *Enviar pedido por WhatsApp*, no cuando de verdad te llega el mensaje. Alguien puede tocar el botón y después no mandarlo. Por eso está el botón *No se concretó*: lo que manda es lo que vos confirmás, no lo que el sitio anotó.
>
> Y por lo mismo, **WhatsApp sigue siendo el canal real**. El pedido te llega ahí como siempre. Esta lista es tu cuaderno, no tu bandeja de entrada.

### Si todavía no hiciste esto

El sitio funciona igual que antes: los pedidos llegan por WhatsApp y la estrellita de popular la ponés a mano desde la pestaña Batidos. Nada se rompe. La pestaña Pedidos te va a avisar qué falta.

---

## Parte 7 — Guardar el sitio como app

El sitio se puede guardar en la pantalla de inicio del teléfono. Queda con su ícono, abre sin la barra del navegador, y el menú se ve aunque no haya señal. No es una app de la tienda de aplicaciones: no hay que descargar nada ni pagar nada.

Esto no necesita configuración. Solo hay que subir cinco archivos nuevos a `public`, junto a los demás:

| Archivo | Para qué |
|---|---|
| `manifest.json` | El nombre, los colores y el ícono de la app |
| `sw.js` | Guarda el menú en el teléfono para que abra sin señal |
| `icono-192.png` · `icono-512.png` | El ícono en Android |
| `icono-180.png` | El ícono en iPhone |

**Cómo lo ve tu cliente.** Abajo a la derecha, arriba del botón verde de WhatsApp, aparece un botón vino con una flecha hacia abajo.

- **En Android:** lo toca y el teléfono le pregunta si quiere instalarla. Un toque y listo.
- **En iPhone:** Apple no deja instalarla de un botón. Al tocarlo le aparece un cartelito que le explica el camino: tocar **Compartir** abajo en Safari y elegir **Añadir a pantalla de inicio**. Son dos toques más, pero funciona igual.
- Si ya la tiene guardada, el botón no aparece.

**Lo de la señal.** Una vez que alguien abrió el sitio, el menú le queda guardado en el teléfono. Si después se queda sin datos, igual puede mirar los batidos y los precios. Lo que sí necesita señal es mandar el pedido, porque eso va por WhatsApp.

> **Nada de esto guarda los pedidos en el teléfono.** Los pedidos siempre viajan al servidor. Lo único que queda guardado es el menú.

---

## Si algo no funciona

**«La llave de acceso no es válida o ya venció».** Generá una nueva (Paso 3).

**«No se encontró el repositorio o el archivo».** Dos causas: el campo *Repositorio* mal escrito (va `jmanuel348/batilandia`, sin `https://`), o `datos.json` no está dentro de `public`.

**Publiqué pero el sitio se ve igual.** Esperá un minuto y recargá. Si sigue igual, probá en modo privado.

**La foto no sube.** Casi siempre es señal débil. Reintentá con wifi.

**«La clave de pedidos no es correcta».** La que pusiste en el panel no coincide con la de Cloudflare. Revisá en *Settings* → *Variables and Secrets* que el nombre sea exactamente `CLAVE_PANEL`. Si no te acordás del valor, creá el secret de nuevo con otra contraseña: se reemplaza sin problema.

**«Todavía no está creada la base de pedidos».** Faltan los Pasos 5 y 6. O quedaron las `//` en `wrangler.jsonc`, o el Database ID está mal pegado.

**«No encontré el servidor de pedidos».** Estás mirando el sitio en local. Los pedidos solo funcionan en el sitio publicado.

**No aparece el botón de guardar la app.** Tres causas: ya la tenés guardada (entonces no tiene sentido mostrarlo), faltan los archivos de la Parte 7, o estás abriendo el sitio en local. Solo funciona en el sitio publicado, porque necesita HTTPS.

**Publiqué un batido nuevo y en un teléfono se sigue viendo el menú viejo.** Es la copia guardada para cuando no hay señal. Se actualiza sola en cuanto el teléfono tenga datos y se recargue la página.

**Los pedidos entran pero el ranking no cambia.** El ranking cuenta solo los que marcaste **Entregado**. Si están todos en *Sin confirmar*, no suma nada. Y hace falta que un batido llegue a tres vendidos para aparecer.

**Publiqué algo mal.** En GitHub → pestaña **Commits**: ahí está cada cambio con su fecha, y podés restaurar la versión anterior de `datos.json`.

---

## Cuánto espacio tenés

| Dónde | Límite | Tu uso |
|---|---|---|
| GitHub | 1 GB recomendado por repositorio | ~5 MB con los 38 batidos con foto |
| GitHub | 100 MB por archivo (25 MB si lo subís desde el navegador) | ~130 KB por foto |
| Cloudflare gratis | 20,000 archivos por versión del sitio | 42 archivos |
| Cloudflare gratis | 25 MiB por archivo | ~130 KB por foto |
| Base de pedidos (D1) | 5 GB | ~1 KB por pedido |
| Base de pedidos (D1) | 100,000 escrituras por día | 1 escritura por pedido |

El panel achica cada foto a 900 píxeles antes de subirla, por eso pesan tan poco. Con ese tamaño podrías cargar unas 7,000 fotos antes de acercarte a cualquier límite. Cloudflare no cobra por almacenar los archivos ni por las visitas a ellos.

**Un detalle:** Git guarda el historial completo. Si reemplazás la foto de un batido, la vieja queda archivada aunque ya no se use. No es problema a esta escala, pero explica por qué el repositorio crece de a poco aunque la cantidad de archivos no cambie.

---

## Lo que pagás

| Concepto | Costo |
|---|---|
| Hosting en Cloudflare | Gratis |
| Certificado de seguridad (HTTPS) | Incluido |
| GitHub y el panel | Gratis |
| Dominio `.net` | Entre US$12 y US$18 al año |

Lo único que se renueva es el dominio, una vez al año. La llave de acceso también vence al año: cuando pase, generás otra.
