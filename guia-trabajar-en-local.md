# Trabajar en local antes de subir

Sirve para probar cambios al instante: guardás el archivo, refrescás el navegador, y ya. Sin esperar el minuto de Cloudflare ni ensuciar el historial de GitHub con veinte commits de prueba.

---

## Armar la carpeta

En tu computadora, creá una carpeta `batilandia` con esto adentro:

```
batilandia/
├── wrangler.jsonc
├── ver-sitio.bat
└── public/
    ├── index.html
    ├── admin.html
    ├── datos.json
    └── fotos/          ← si ya subiste fotos, bajalas de GitHub
```

Es la misma estructura que tenés en GitHub, más el `.bat`.

> Para bajar todo de una: en GitHub, botón verde **Code** → **Download ZIP**. Descomprimís y ya tenés la carpeta armada; solo agregás el `.bat`.

---

## Levantar el sitio

Doble clic en **`ver-sitio.bat`**. Se abre una ventana negra y el navegador en:

- Sitio: `http://localhost:8000`
- Panel: `http://localhost:8000/admin.html`

Dejá la ventana negra abierta mientras trabajás. Para apagar el servidor, cerrala.

**Si dice que no encuentra Python**, probá cambiando `python` por `py` dentro del `.bat`, o instalalo desde python.org marcando *Add Python to PATH*.

**Si el puerto 8000 está ocupado**, cambiá el `8000` por `8080` en las dos líneas del `.bat`.

### ¿Por qué no basta con doble clic en index.html?

Porque el navegador bloquea la lectura de `datos.json` cuando el sitio se abre como archivo suelto (`file://`). El sitio no se rompe: usa una copia de respaldo que trae adentro. El problema es que editarías `datos.json` y no verías ningún cambio, sin entender por qué.

---

## Qué probar en local

Todo lo visual y de contenido:

- Colores, tamaños, textos → `index.html`
- Precios, batidos, categorías, horario → `datos.json`
- Fotos → poné los archivos en `public/fotos/` y en `datos.json` escribí `"foto": "fotos/nombre.jpg"`

Refrescás con **Ctrl+F5** y ves el cambio al toque.

---

## Cuidado con el panel en local

El panel abierto en `localhost` **no es una prueba aislada**: sigue guardando en tu repositorio real de GitHub, porque ahí es donde vive la información. Si subís una foto desde el panel local, esa foto se sube a GitHub y el sitio público se actualiza.

Entonces, para probar sin tocar nada real, editá `datos.json` a mano. Para cambios de verdad, usá el panel — da igual si lo abrís en local o en el sitio publicado.

---

## Subir los cambios a GitHub

Cuando estés conforme, en GitHub: entrá a la carpeta **public** → **Add file** → **Upload files** → arrastrá los archivos que modificaste → **Commit changes**.

Cloudflare republica solo en cerca de un minuto.

> **El `.bat` no lo subas.** Y si lo subís por error, que sea a la raíz, nunca dentro de `public` — ahí quedaría publicado junto al sitio.

---

## El orden importa

`datos.json` vive en dos lados: tu computadora y GitHub. El panel **siempre lee y escribe la versión de GitHub**.

Si editás el archivo local y después usás el panel sin haber subido esos cambios, el panel publica lo que tenía GitHub y tus ediciones locales se pierden.

La regla simple: **terminá lo local, subilo, y recién ahí volvé al panel.**
