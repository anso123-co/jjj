# Lumina — Tienda online (mobile-first) + Admin (Supabase)

Proyecto completo **Vanilla JS (sin frameworks)**, súper rápido y optimizado para móviles Android gama media/baja.

- **Front directo a Supabase** (Auth + Postgres + Storage).  
- **Sin endpoints inventados** (no Edge Functions, no servidor).
- Diseño **claro**, colorido, con “aurora” **ligera** (sin imágenes de fondo, sin blur pesado, sin sliders).
- Accesibilidad: `aria-label`, foco en modal/drawer, **ESC** cierra modal y carrito.

---

## 1) Requisitos

- Un proyecto en **Supabase** (gratuito sirve).
- Un servidor local (por módulos ES):  
  - VS Code **Live Server** o  
  - `python -m http.server 5173`

---

## 2) Supabase Setup (OBLIGATORIO)

### 2.1 Crear el bucket (Storage)

1. Supabase → **Storage** → **Create bucket**
2. Bucket: `product-images`
3. **Public bucket**: ON

> El frontend usa URL pública para mostrar imágenes.

### 2.2 Ejecutar tus 3 SQL (tal cual)

En Supabase → **SQL Editor**, ejecuta en este orden:

1) **SQL 1** (schema + triggers + RLS + policies + seed)  
2) **SQL 2** (policies de Storage sobre `storage.objects`)  
3) **SQL 3** (marcar tu usuario como admin en `profiles`)

> Nota: si pegas SQL1 y te da error por líneas “humanas” que no empiezan con `--`, conviértelas en comentario o empieza desde `create extension ...`. El contenido está aquí **tal cual** lo enviaste.

#### SQL 1 (PEGAR EN SQL EDITOR)
```sql
3) SQL completo (tablas, índices, triggers, RLS + policies, seed 5 productos)
- =========================
-- EXTENSIONS
-- =========================
create extension if not exists "pgcrypto";

-- =========================
-- TABLES
-- =========================
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null,
  "desc" text not null default '',
  base_price int not null default 0,
  discount_percent int not null default 0,
  featured boolean not null default false,
  colors text[] not null default '{}'::text[],
  image_url text,
  image_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_sizes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  label text not null,
  extra_price int not null default 0,
  created_at timestamptz not null default now()
);

-- Admin profiles (is_admin)
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================
-- INDEXES
-- =========================
create index if not exists idx_products_category on public.products (category);
create index if not exists idx_products_featured on public.products (featured);
create index if not exists idx_products_created_at on public.products (created_at desc);
create index if not exists idx_sizes_product_id on public.product_sizes (product_id);

-- =========================
-- updated_at trigger
-- =========================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_products_updated_at on public.products;
create trigger trg_products_updated_at
before update on public.products
for each row
execute function public.set_updated_at();

-- =========================
-- Helper function: is_admin(auth.uid())
-- =========================
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
as $$
  select coalesce(
    (select p.is_admin from public.profiles p where p.user_id = uid),
    false
  );
$$;

-- =========================
-- RLS ENABLE
-- =========================
alter table public.products enable row level security;
alter table public.product_sizes enable row level security;
alter table public.profiles enable row level security;

-- =========================
-- POLICIES: PRODUCTS
-- Public can read catalog
drop policy if exists "products_public_read" on public.products;
create policy "products_public_read"
on public.products
for select
to anon, authenticated
using (true);

-- Only admins can write
drop policy if exists "products_admin_insert" on public.products;
create policy "products_admin_insert"
on public.products
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "products_admin_update" on public.products;
create policy "products_admin_update"
on public.products
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "products_admin_delete" on public.products;
create policy "products_admin_delete"
on public.products
for delete
to authenticated
using (public.is_admin(auth.uid()));

-- =========================
-- POLICIES: PRODUCT_SIZES
-- Public read (para que la tienda calcule variantes)
drop policy if exists "sizes_public_read" on public.product_sizes;
create policy "sizes_public_read"
on public.product_sizes
for select
to anon, authenticated
using (true);

-- Only admins can write
drop policy if exists "sizes_admin_insert" on public.product_sizes;
create policy "sizes_admin_insert"
on public.product_sizes
for insert
to authenticated
with check (public.is_admin(auth.uid()));

drop policy if exists "sizes_admin_update" on public.product_sizes;
create policy "sizes_admin_update"
on public.product_sizes
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

drop policy if exists "sizes_admin_delete" on public.product_sizes;
create policy "sizes_admin_delete"
on public.product_sizes
for delete
to authenticated
using (public.is_admin(auth.uid()));

-- =========================
-- POLICIES: PROFILES
-- Only the user can read their own profile (so admin.js can verify is_admin)
drop policy if exists "profiles_self_read" on public.profiles;
create policy "profiles_self_read"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

-- Optional: allow user to create their own profile row on first login
drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert"
on public.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

-- Admins can update profiles (to grant admin, recommended to do via SQL too)
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_admin(auth.uid()))
with check (public.is_admin(auth.uid()));

-- =========================
-- SEED DATA (5 products)
-- =========================
-- NOTE: Puedes ejecutar esto después de crear bucket/policies también.
-- Usaremos imágenes vacías (null) si aún no subes.
with p as (
  insert into public.products (name, category, "desc", base_price, discount_percent, featured, colors, image_url, image_path)
  values
    ('Manilla Minimal Negra', 'manillas', 'Manilla minimalista con acabado mate, ideal para uso diario.', 35000, 10, true,  array['Negro','Gris'], null, null),
    ('Pulsera Trenzada Premium', 'pulseras', 'Pulsera trenzada con estilo elegante. Cómoda y resistente.', 42000, 0, true,  array['Café','Negro'], null, null),
    ('Anillo Acero Inoxidable', 'anillos', 'Anillo elegante en acero, brillo sutil y durabilidad alta.', 38000, 15, false, array['Plateado','Negro'], null, null),
    ('Collar Cadena Delgada', 'collares', 'Cadena delgada y elegante, perfecta para combinar.', 46000, 5, false, array['Dorado','Plateado'], null, null),
    ('Pulsera Perlas Urban', 'pulseras', 'Perlas estilo urbano, look moderno y limpio.', 50000, 20, true, array['Blanco','Negro'], null, null)
  returning id, name, category
)
insert into public.product_sizes (product_id, label, extra_price)
select id, 'S', 0 from p
union all select id, 'M', 5000 from p
union all select id, 'L', 10000 from p;

-- Si quieres que algunos productos tengan talla única, luego puedes editar desde admin y dejar solo "Única".
```

#### SQL 2 (PEGAR EN SQL EDITOR)
```sql
-4) Policies de Storage (bucket product-images) — lectura pública, escritura/borrado solo admin
Esto se configura en Storage. Primero crea el bucket y luego aplica policies sobre storage.objects.

- =========================
-- STORAGE POLICIES
-- Bucket: product-images
-- =========================

-- 1) Public read for images in bucket
drop policy if exists "product_images_public_read" on storage.objects;
create policy "product_images_public_read"
on storage.objects
for select
to anon, authenticated
using (bucket_id = 'product-images');

-- 2) Only admins can upload
drop policy if exists "product_images_admin_insert" on storage.objects;
create policy "product_images_admin_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and public.is_admin(auth.uid())
);

-- 3) Only admins can update (optional)
drop policy if exists "product_images_admin_update" on storage.objects;
create policy "product_images_admin_update"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_admin(auth.uid())
)
with check (
  bucket_id = 'product-images'
  and public.is_admin(auth.uid())
);

-- 4) Only admins can delete
drop policy if exists "product_images_admin_delete" on storage.objects;
create policy "product_images_admin_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and public.is_admin(auth.uid())
);
```

#### SQL 3 (REEMPLAZA UUID_DEL_USUARIO_AQUI y pega)
```sql
insert into public.profiles (user_id, is_admin)
values ('UUID_DEL_USUARIO_AQUI'::uuid, true)
on conflict (user_id) do update set is_admin = true;
```

### 2.3 Crear usuario admin (Auth)

1. Supabase → **Authentication** → **Users**
2. Crea/invita un usuario con email/contraseña.
3. Copia el `user_id` (UUID) y úsalo en **SQL3**.

---

## 3) Configurar el cliente Supabase

Abre `supabaseClient.js` y pega:

- **Project URL**
- **anon public key**

Ruta: Supabase → Project Settings → API.

---

## 4) Correr local

En la carpeta del proyecto:

```bash
python -m http.server 5173
```

Abre:

- Tienda: `http://localhost:5173/index.html`
- Admin: `http://localhost:5173/admin.html`

---

## 5) Cómo usar

### Tienda (público)

- Carga catálogo desde `products` y `product_sizes`
- Busca por **nombre / categoría / descripción**
- Filtros:
  - categoría (select)
  - solo destacados (checkbox)
  - precio máximo (COP) usando precio final **“desde”**
- Orden:
  - destacados + recientes
  - precio asc/desc
  - nombre A–Z / Z–A
- Modal:
  - talla + color
  - precio final + precio tachado si hay descuento
  - Agregar al carrito / Comprar ahora
- Carrito (drawer):
  - persiste en `localStorage`
  - envío simulado 12.000 COP, gratis desde 150.000
  - finalizar compra simulado (toast)

### Acceso Admin oculto (IMPORTANTE)

En la tienda:
1) Escribe **admin** en el buscador → entra a `./admin.html`  
   (detecta `input`, `change`, `search`, `submit`, Enter)
2) Mantén presionado el logo **1200ms** → entra a Admin

### Panel Admin

- Login con Supabase Auth (email/password)
- Verifica `profiles.is_admin`:
  - si es `false` → cierra sesión y bloquea acceso
- CRUD productos:
  - products: `name, category, desc, base_price, discount_percent, featured, colors, image_url, image_path`
  - product_sizes: `label, extra_price` (si no agregas tallas → crea Única, 0)
- Imagen:
  - sube a bucket `product-images`
  - intenta **convertir a WebP (q≈0.75)**, **máx 1200px** y objetivo **<300KB**
  - si falla, sube el original con advertencia

---

## 6) Checklist final (prueba rápida)

- [ ] Login admin exitoso (usuario marcado con SQL3)
- [ ] Crear producto (con o sin tallas) + colores
- [ ] Subir imagen (ver que la URL se guarda)
- [ ] Ver producto en tienda
- [ ] Abrir modal
- [ ] Agregar al carrito + cambiar qty
- [ ] Filtros / orden funcionando
- [ ] Acceso admin escribiendo “admin” (móvil OK)
- [ ] ESC cierra modal y carrito

---

## 7) Recomendaciones de rendimiento

- Imágenes:
  - Ideal **WebP < 300KB** por producto
  - Evita subir imágenes gigantes sin compresión
- UI:
  - Se usa `content-visibility:auto` en cards (mejora scroll en móviles).
  - Sin `backdrop-filter` ni blur repetido en listas largas.
- Hosting:
  - Cualquier hosting estático (Netlify, Vercel static, GitHub Pages*).  
    *Ojo: para Auth, revisa la URL permitida en Supabase Auth settings.

---

Si quieres, después te lo dejo también empaquetado en ZIP (listo para subir a hosting) con tu nombre/branding exacto.
