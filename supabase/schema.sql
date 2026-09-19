-- =====================================================================
--  NL ⇄ FR — schéma de base de données (Supabase / PostgreSQL)
--  À coller entièrement dans : Supabase > SQL Editor > New query > Run
-- =====================================================================

-- ---------- 1. Tables ----------

-- Un profil par personne inscrite (le prénom affiché dans l'interface).
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  email        text,
  display_name text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- Une "liste" = un paquet de mots. Soit personnelle, soit partagée.
create table if not exists public.decks (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  owner_id   uuid not null references auth.users on delete cascade,
  is_shared  boolean not null default false,
  created_at timestamptz not null default now()
);

-- Qui a accès à quelle liste.
create table if not exists public.deck_members (
  deck_id    uuid not null references public.decks on delete cascade,
  user_id    uuid not null references auth.users on delete cascade,
  role       text not null default 'member',   -- 'owner' ou 'member'
  created_at timestamptz not null default now(),
  primary key (deck_id, user_id)
);

-- Les mots appartiennent à la liste, pas à la personne.
create table if not exists public.words (
  id         uuid primary key default gen_random_uuid(),
  deck_id    uuid not null references public.decks on delete cascade,
  nl         text not null,
  fr         text not null,
  created_at timestamptz not null default now()
);

-- L'apprentissage est propre à CHAQUE personne, même sur une liste
-- partagée : deux personnes peuvent étudier les mêmes mots sans que
-- les progrès de l'une changent ceux de l'autre.
create table if not exists public.progress (
  user_id    uuid not null references auth.users on delete cascade,
  word_id    uuid not null references public.words on delete cascade,
  known      boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, word_id)
);

-- Si vous aviez déjà exécuté une version précédente de ce script, cette
-- ligne ajoute la colonne manquante sans rien casser.
alter table public.profiles add column if not exists is_admin boolean not null default false;

create index if not exists words_deck_idx        on public.words (deck_id);
create index if not exists deck_members_user_idx on public.deck_members (user_id);

-- ---------- 2. Fonctions d'aide ----------
-- "security definer" = la fonction contourne les règles d'accès pour
-- éviter les boucles infinies quand une règle interroge la même table.

create or replace function public.is_deck_member(d uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.deck_members
    where deck_id = d and user_id = auth.uid()
  );
$$;

create or replace function public.is_deck_owner(d uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.decks
    where id = d and owner_id = auth.uid()
  );
$$;

-- ---------- 3. Déclencheurs automatiques ----------

-- À l'inscription, créer le profil. La toute première personne à
-- s'inscrire sur une base neuve devient automatiquement administratrice
-- (aucune manipulation SQL supplémentaire à faire) ; les suivantes non.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.profiles) into is_first;
  insert into public.profiles (id, email, display_name, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    is_first
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- À la création d'une liste, inscrire le créateur comme membre.
create or replace function public.handle_new_deck()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.deck_members (deck_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists on_deck_created on public.decks;
create trigger on_deck_created
  after insert on public.decks
  for each row execute function public.handle_new_deck();

-- Vrai uniquement s'il n'existe encore aucun compte : sert à savoir si
-- le formulaire "créer le compte administrateur" doit s'afficher.
create or replace function public.is_bootstrap_needed()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select not exists (select 1 from public.profiles);
$$;

create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- Liste de tous les comptes, réservée à l'administrateur (pour le
-- panneau d'administration du site).
create or replace function public.list_all_users()
returns table (user_id uuid, display_name text, is_admin boolean, created_at timestamptz)
language sql
security definer
stable
set search_path = public
as $$
  select id, display_name, is_admin, created_at
  from public.profiles
  where public.is_admin()
  order by created_at;
$$;

-- ---------- 4. Inviter quelqu'un par e-mail ----------
-- Appelée depuis le site. Vérifie que l'appelant est bien propriétaire
-- de la liste, puis ajoute la personne si elle a déjà un compte.

create or replace function public.add_member_by_email(d uuid, member_email text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if not public.is_deck_owner(d) then
    return 'not_owner';
  end if;

  select id into target
  from auth.users
  where lower(email) = lower(trim(member_email))
  limit 1;

  if target is null then
    return 'no_account';
  end if;

  insert into public.deck_members (deck_id, user_id, role)
  values (d, target, 'member')
  on conflict do nothing;

  -- Une liste avec plusieurs membres est forcément partagée.
  update public.decks set is_shared = true where id = d;

  return 'ok';
end;
$$;

-- Lister les membres d'une liste avec leur nom (les profils des autres
-- ne sont pas lisibles directement, d'où cette fonction).
create or replace function public.list_deck_members(d uuid)
returns table (user_id uuid, display_name text, email text, role text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_deck_member(d) then
    return;
  end if;
  return query
    select m.user_id, p.display_name, p.email, m.role
    from public.deck_members m
    join public.profiles p on p.id = m.user_id
    where m.deck_id = d
    order by m.role desc, p.display_name;
end;
$$;

-- ---------- 5. Règles d'accès (Row Level Security) ----------

alter table public.profiles     enable row level security;
alter table public.decks        enable row level security;
alter table public.deck_members enable row level security;
alter table public.words        enable row level security;
alter table public.progress     enable row level security;

-- profiles : chacun voit et modifie le sien.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- decks : visibles par leurs membres ; modifiables par le propriétaire.
drop policy if exists decks_select on public.decks;
create policy decks_select on public.decks
  for select using (owner_id = auth.uid() or public.is_deck_member(id));

drop policy if exists decks_insert on public.decks;
create policy decks_insert on public.decks
  for insert with check (owner_id = auth.uid());

drop policy if exists decks_update on public.decks;
create policy decks_update on public.decks
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists decks_delete on public.decks;
create policy decks_delete on public.decks
  for delete using (owner_id = auth.uid());

-- deck_members : visibles par les membres ; gérés par le propriétaire.
drop policy if exists members_select on public.deck_members;
create policy members_select on public.deck_members
  for select using (user_id = auth.uid() or public.is_deck_owner(deck_id));

drop policy if exists members_insert on public.deck_members;
create policy members_insert on public.deck_members
  for insert with check (public.is_deck_owner(deck_id));

drop policy if exists members_delete on public.deck_members;
create policy members_delete on public.deck_members
  for delete using (public.is_deck_owner(deck_id) or user_id = auth.uid());

-- words : lisibles et modifiables par tous les membres de la liste.
drop policy if exists words_select on public.words;
create policy words_select on public.words
  for select using (public.is_deck_member(deck_id));

drop policy if exists words_insert on public.words;
create policy words_insert on public.words
  for insert with check (public.is_deck_member(deck_id));

drop policy if exists words_update on public.words;
create policy words_update on public.words
  for update using (public.is_deck_member(deck_id));

drop policy if exists words_delete on public.words;
create policy words_delete on public.words
  for delete using (public.is_deck_member(deck_id));

-- progress : strictement privé à chaque personne.
drop policy if exists progress_all on public.progress;
create policy progress_all on public.progress
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
