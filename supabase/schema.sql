-- ==========================================================================
--  Deneyap Ev Koruma — Supabase şeması
--  Supabase Dashboard → SQL Editor → "New query" → bu dosyanın TAMAMINI
--  yapıştır → "Run" (Ctrl+Enter). Yaklaşık 30 saniye sürer.
--
--  Ne yapar:
--    1) profiles  : her kayıtlı kullanıcı + rolü (admin / user)
--    2) device_bindings : hangi cihazın (DK-XXXX) hangi hesaba ait olduğu
--    3) kaydolan ilk kişi otomatik ADMIN olur
--    4) RLS: kullanıcılar sadece kendilerini, admin herkesi görebilir
--
--  NOT: Bu şema çalıştırılmadan paneldeki "Hesap" bölümü kurulum bekler
--       uyarısını gösterir. Çalıştırıldıktan sonra otomatik etkinleşir.
-- ==========================================================================

-- ---------- 1) Tablolar ----------------------------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text not null,
  role         text not null default 'user'
               check (role in ('admin', 'user')),
  display_name text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz
);

create table if not exists public.device_bindings (
  device_id text primary key check (device_id ~ '^DK-[0-9A-Fa-f]{4,8}$'),
  owner_id  uuid not null references public.profiles(id) on delete cascade,
  label     text,
  bound_at  timestamptz not null default now(),
  bound_by  uuid references public.profiles(id)
);

create index if not exists device_bindings_owner_idx
  on public.device_bindings (owner_id);

-- ---------- 2) Yardımcı: mevcut kullanıcının rolü --------------------------
--  TABLOLARDAN SONRA tanımlanmalı: PostgreSQL "language sql" fonksiyonun
--  gövdesini oluştururken tablo adını çözer; profiles henüz yoksa
--  "relation public.profiles does not exists" (42P01) hatası verir.
create or replace function public.current_role_of(_uid uuid)
returns text
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = _uid;
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(public.current_role_of(auth.uid()), 'user') = 'admin';
$$;

-- ---------- 3) Kayıt sırasında profil satırı otomatik oluşsun --------------
--  İlk kaydolan kullanıcı ADMIN olur. (Sistemi kuran sizsiniz; sonra
--  Admin menüsünden diğer hesapları da admin yapabilirsiniz.)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  /* KENDİ E-POSTANIZI YAZIN (opsiyonel ama önerilir):
     bu adres her koşulda admin olur. Boş bırakılırsa sisteme İLK KAYIT
     OLAN kullanıcı admin olur. İki satırı da değiştirmeyin. */
  bootstrap_admin constant text := '';
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;

  insert into public.profiles (id, email, role, display_name)
  values (
    new.id,
    new.email,
    case when is_first
           or (bootstrap_admin <> ''
               and lower(new.email) = lower(bootstrap_admin))
         then 'admin' else 'user' end,
    coalesce(new.raw_user_meta_data ->> 'display_name',
             split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- 4) RLS: satır düzeyinde erişim --------------------------------
alter table public.profiles        enable row level security;
alter table public.device_bindings enable row level security;

drop policy if exists "kendi profilini gor"   on public.profiles;
drop policy if exists "admin her profili gor" on public.profiles;
drop policy if exists "admin profil guncelle" on public.profiles;
drop policy if exists "admin profil sil"      on public.profiles;

create policy "kendi profilini gor"
  on public.profiles for select
  using (id = auth.uid());

create policy "admin her profili gor"
  on public.profiles for select
  using (public.is_admin());

create policy "admin profil guncelle"
  on public.profiles for update
  using (public.is_admin())
  with check (public.is_admin());

--  Admin bir kullanıcının profilini silerse o hesap giriş yapamaz
--  (auth.users durur ama yetkilendirme kaynağı olan profil satırı gider).
--  Bu, "kullanıcıyı engelle / sil" karşılığıdır.
create policy "admin profil sil"
  on public.profiles for delete
  using (public.is_admin());

drop policy if exists "sahibi veya admin baglantiyi gor" on public.device_bindings;
drop policy if exists "sahibi veya admin baglanti yaz"   on public.device_bindings;
drop policy if exists "sahibi veya admin baglanti sil"   on public.device_bindings;

create policy "sahibi veya admin baglantiyi gor"
  on public.device_bindings for select
  using (owner_id = auth.uid() or public.is_admin());

--  Bağlama işlemi: giriş yapmış kullanıcı kendi adına bağlayabilir,
--  admin başkası adına da bağlayabilir. Halihazırda bağlı bir cihazı
--  yalnızca admin ya da sahibi yeniden bağlayabilir (mülkiyet gaspı yok).
create policy "sahibi veya admin baglanti yaz"
  on public.device_bindings for insert
  with check (
    owner_id = auth.uid() or public.is_admin()
  );

create policy "sahibi veya admin baglanti sil"
  on public.device_bindings for delete
  using (
    owner_id = auth.uid() or public.is_admin()
  );

--  UPDATE: yalnız admin (ya da sahibi "sadece kendi satırını" güncellemesi
--  gerekiyorsa o da) — burada mülkiyet devri yalnız admins'e bırakılır.
drop policy if exists "admin baglanti guncelle" on public.device_bindings;
create policy "admin baglanti guncelle"
  on public.device_bindings for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------- 5) Yeni kullanıcı kaydı: admin rolünü de birlikte yazalım ------
--  (trigger profiles'i dolduruyor; rol ataması da orada yapılıyor)
--  NOT: İlk kullanıcı admin olduğu için ekstra bir şeye gerek yok.

-- ==========================================================================
--  BİTTİ. Doğrulamak için aşağı çalıştırın:
--    select * from public.profiles;
--    select * from public.device_bindings;
-- ==========================================================================
