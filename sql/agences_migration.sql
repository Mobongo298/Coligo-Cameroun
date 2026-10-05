-- COLIGO — Agences gérées par l'administrateur (ajout / retrait)
-- À exécuter une fois : SQL Editor > New query > Run. Peut être relancé sans risque.
create table if not exists agences (
  id         bigserial primary key,
  nom        text not null unique,
  code       text not null unique check (code ~ '^[A-Z]{3}$'),
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);
insert into agences (nom, code) values ('Douala','DLA'), ('Yaoundé','YDE')
  on conflict do nothing;
alter table agences enable row level security;
drop policy if exists agences_lecture on agences;
drop policy if exists agences_ecriture on agences;
drop policy if exists agences_maj on agences;
create policy agences_lecture  on agences for select using (true);
create policy agences_ecriture on agences for insert with check (true);
create policy agences_maj      on agences for update using (true) with check (true);
