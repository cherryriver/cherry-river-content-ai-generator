-- Cherry River AI — Supabase Schema
-- Run this in: Supabase Dashboard → SQL Editor → New Query

-- Products table
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  color TEXT NOT NULL,
  image TEXT,
  product_type TEXT DEFAULT 'bottle',
  status TEXT DEFAULT 'ready',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Generations table
CREATE TABLE IF NOT EXISTS generations (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  product TEXT NOT NULL,
  color TEXT DEFAULT '#888888',
  prompt TEXT DEFAULT '',
  scene TEXT DEFAULT '',
  type TEXT DEFAULT 'image',
  date TIMESTAMPTZ DEFAULT NOW()
);

-- Enable public read access (RLS disabled for simplicity with service role)
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE generations ENABLE ROW LEVEL SECURITY;

-- Allow service role full access (already default, but explicit)
CREATE POLICY "service_role_all_products" ON products FOR ALL USING (true);
CREATE POLICY "service_role_all_generations" ON generations FOR ALL USING (true);
