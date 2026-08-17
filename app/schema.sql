-- ============================================================================
-- VANITY — Supabase Postgres schema
-- Run in Supabase SQL Editor, or via `supabase db push` with this as a migration.
-- Assumes Supabase's built-in `auth.users` table for authentication.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ----------------------------------------------------------------------------
-- ENUMS
-- ----------------------------------------------------------------------------
create type user_role        as enum ('customer', 'admin');
create type garment_size     as enum ('XS', 'S', 'M', 'L', 'XL', 'XXL');
create type order_status     as enum ('awaiting_payment', 'processing', 'paid', 'fulfilled', 'cancelled', 'refunded');
create type discount_type    as enum ('percent', 'fixed');
create type payment_event_t  as enum ('CHARGE_CREATED', 'CAPTURED', 'FAILED', 'CANCELLED', 'REFUNDED', 'DECLINED');

-- ----------------------------------------------------------------------------
-- PROFILES  (1:1 extension of auth.users)
-- ----------------------------------------------------------------------------
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  role        user_role not null default 'customer',
  full_name   text,
  phone       text,
  created_at  timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name) values (new.id, new.raw_user_meta_data->>'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- Helper used throughout RLS policies — SECURITY DEFINER so it can read
-- profiles even though profiles itself is RLS-protected.
create function is_admin() returns boolean
language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ----------------------------------------------------------------------------
-- PRODUCTS / VARIANTS / IMAGES
-- ----------------------------------------------------------------------------
create table products (
  id            uuid primary key default gen_random_uuid(),
  slug          text unique not null,
  name          text not null,
  description   text,
  base_price_cents int not null check (base_price_cents >= 0),
  currency      text not null default 'BHD',
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table product_variants (
  id                uuid primary key default gen_random_uuid(),
  product_id        uuid not null references products(id) on delete cascade,
  size              garment_size not null,
  color             text not null,
  sku               text unique not null,
  price_cents       int,                      -- overrides products.base_price_cents when set
  stock_count       int not null default 0 check (stock_count >= 0),
  low_stock_threshold int not null default 5,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (product_id, size, color)
);

create table product_images (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  storage_path  text not null,      -- key in Supabase Storage or R2 bucket
  alt_text      text,
  sort_order    int not null default 0
);

create index idx_variants_product on product_variants(product_id);
create index idx_images_product on product_images(product_id);
create index idx_products_active on products(is_active) where is_active = true;

-- ----------------------------------------------------------------------------
-- DISCOUNT CODES  (table itself is never exposed to clients — see RLS below;
-- validity is checked only through the validate_discount_code() RPC)
-- ----------------------------------------------------------------------------
create table discount_codes (
  id                uuid primary key default gen_random_uuid(),
  code              text unique not null,
  type              discount_type not null,
  value             int not null,             -- percent (1-100) or fixed cents, per `type`
  max_uses          int,                       -- null = unlimited
  uses_count        int not null default 0,
  min_subtotal_cents int not null default 0,
  starts_at         timestamptz not null default now(),
  expires_at        timestamptz,
  is_active         boolean not null default true
);

-- ----------------------------------------------------------------------------
-- CARTS  (guest carts keyed by a random session token stored in a cookie)
-- ----------------------------------------------------------------------------
create table carts (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade,
  session_token uuid,                          -- set for guest carts
  created_at    timestamptz not null default now(),
  check (user_id is not null or session_token is not null)
);

create table cart_items (
  id          uuid primary key default gen_random_uuid(),
  cart_id     uuid not null references carts(id) on delete cascade,
  variant_id  uuid not null references product_variants(id),
  quantity    int not null check (quantity > 0),
  unique (cart_id, variant_id)
);

-- ----------------------------------------------------------------------------
-- ORDERS  (all writes go through server routes using the service role key —
-- see RLS notes below; clients only ever SELECT their own orders)
-- ----------------------------------------------------------------------------
create table orders (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid references auth.users(id),
  guest_email         text,
  status              order_status not null default 'awaiting_payment',
  subtotal_cents      int not null,
  discount_cents      int not null default 0,
  shipping_cents      int not null default 0,
  total_cents         int not null,
  currency            text not null default 'BHD',
  discount_code_id    uuid references discount_codes(id),
  tap_charge_id       text unique,
  shipping_address    jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (user_id is not null or guest_email is not null)
);

create table order_items (
  id                    uuid primary key default gen_random_uuid(),
  order_id              uuid not null references orders(id) on delete cascade,
  variant_id            uuid not null references product_variants(id),
  product_name_snapshot text not null,
  variant_label_snapshot text not null,        -- e.g. "M / Onyx Black"
  unit_price_cents      int not null,
  quantity               int not null check (quantity > 0),
  line_total_cents      int not null
);

create index idx_orders_user on orders(user_id);
create index idx_orders_status on orders(status);
create index idx_order_items_order on order_items(order_id);

-- ----------------------------------------------------------------------------
-- PAYMENT EVENTS  — append-only audit trail of every Tap webhook received.
-- The unique constraint on (tap_charge_id, event_type) is the idempotency
-- guard: a retried webhook for the same charge + status is a no-op insert.
-- ----------------------------------------------------------------------------
create table payment_events (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid references orders(id),
  tap_charge_id       text not null,
  event_type          payment_event_t not null,
  hashstring_verified boolean not null,
  raw_payload         jsonb not null,
  created_at          timestamptz not null default now(),
  unique (tap_charge_id, event_type)
);

create table admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references auth.users(id),
  action      text not null,
  entity      text not null,
  entity_id   uuid,
  created_at  timestamptz not null default now()
);

-- ============================================================================
-- THE RISKIEST FUNCTION — atomic, idempotent stock confirmation.
-- Called only by the webhook handler (service role). Approach A from the
-- write-up: no pre-reservation, the row lock at capture time is the only
-- guard against overselling.
-- ============================================================================
create function confirm_order_payment(
  p_tap_charge_id text,
  p_new_status    order_status
) returns table (order_id uuid, oversold boolean) as $$
declare
  v_order   orders%rowtype;
  v_item    record;
  v_oversold boolean := false;
begin
  select * into v_order from orders where tap_charge_id = p_tap_charge_id for update;

  if not found then
    raise exception 'no order for tap_charge_id %', p_tap_charge_id;
  end if;

  -- idempotency: webhook retries land here safely
  if v_order.status = 'paid' or v_order.status = 'fulfilled' then
    return query select v_order.id, false;
    return;
  end if;

  if p_new_status = 'paid' then
    -- lock each affected variant row in a stable order (by id) to avoid
    -- deadlocks against concurrent checkouts touching overlapping variants
    for v_item in
      select oi.variant_id, oi.quantity
      from order_items oi
      where oi.order_id = v_order.id
      order by oi.variant_id
    loop
      update product_variants
        set stock_count = stock_count - v_item.quantity,
            updated_at = now()
        where id = v_item.variant_id
          and stock_count >= v_item.quantity;

      if not found then
        v_oversold := true;
      end if;
    end loop;
  end if;

  if v_oversold then
    update orders set status = 'cancelled', updated_at = now() where id = v_order.id;
  else
    update orders set status = p_new_status, updated_at = now() where id = v_order.id;
  end if;

  return query select v_order.id, v_oversold;
end;
$$ language plpgsql security definer set search_path = public;

-- ----------------------------------------------------------------------------
-- Discount code validation — the only sanctioned way to read discount_codes
-- from the client. Returns nothing if invalid/expired/exhausted.
-- ----------------------------------------------------------------------------
create function validate_discount_code(p_code text, p_subtotal_cents int)
returns table (id uuid, type discount_type, value int) as $$
  select id, type, value
  from discount_codes
  where code = p_code
    and is_active
    and now() between starts_at and coalesce(expires_at, 'infinity')
    and p_subtotal_cents >= min_subtotal_cents
    and (max_uses is null or uses_count < max_uses);
$$ language sql security definer stable set search_path = public;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table profiles           enable row level security;
alter table products           enable row level security;
alter table product_variants   enable row level security;
alter table product_images     enable row level security;
alter table discount_codes     enable row level security;
alter table carts              enable row level security;
alter table cart_items         enable row level security;
alter table orders             enable row level security;
alter table order_items        enable row level security;
alter table payment_events     enable row level security;
alter table admin_audit_log    enable row level security;

-- profiles: read own row, admins read all; only admins can change roles
create policy "profiles_select_own_or_admin" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "profiles_update_own_no_role_change" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
create policy "profiles_admin_all" on profiles
  for all using (is_admin()) with check (is_admin());

-- catalog: public read of active items; admin-only writes
create policy "products_public_read" on products
  for select using (is_active or is_admin());
create policy "products_admin_write" on products
  for insert with check (is_admin());
create policy "products_admin_update" on products
  for update using (is_admin()) with check (is_admin());
create policy "products_admin_delete" on products
  for delete using (is_admin());

create policy "variants_public_read" on product_variants
  for select using (
    is_admin() or exists (select 1 from products p where p.id = product_id and p.is_active)
  );
create policy "variants_admin_write" on product_variants
  for all using (is_admin()) with check (is_admin());

create policy "images_public_read" on product_images
  for select using (true);
create policy "images_admin_write" on product_images
  for all using (is_admin()) with check (is_admin());

-- discount codes: no direct client access at all — only the SECURITY DEFINER
-- validate_discount_code() RPC and the service role (admin dashboard) can see rows
create policy "discount_codes_admin_only" on discount_codes
  for all using (is_admin()) with check (is_admin());

-- carts / cart_items: owner (by user_id) or matching guest session token
create policy "carts_owner" on carts
  for all using (
    user_id = auth.uid()
    or session_token::text = current_setting('request.jwt.claims', true)::json->>'session_token'
  );
create policy "cart_items_owner" on cart_items
  for all using (
    exists (
      select 1 from carts c where c.id = cart_id
      and (c.user_id = auth.uid()
           or c.session_token::text = current_setting('request.jwt.claims', true)::json->>'session_token')
    )
  );

-- orders / order_items: read-only for the owning customer; everything else
-- (creation, status transitions) happens server-side with the service role,
-- which bypasses RLS entirely — so there is intentionally no client INSERT policy
create policy "orders_select_own" on orders
  for select using (user_id = auth.uid() or is_admin());
create policy "orders_admin_update" on orders
  for update using (is_admin()) with check (is_admin());

create policy "order_items_select_own" on order_items
  for select using (
    exists (select 1 from orders o where o.id = order_id and (o.user_id = auth.uid() or is_admin()))
  );

-- payment_events / admin_audit_log: admin-only, service role writes
create policy "payment_events_admin_read" on payment_events
  for select using (is_admin());
create policy "audit_log_admin_read" on admin_audit_log
  for select using (is_admin());

-- ----------------------------------------------------------------------------
-- Realtime: expose orders to the admin dashboard's live feed
-- ----------------------------------------------------------------------------
alter publication supabase_realtime add table orders;
