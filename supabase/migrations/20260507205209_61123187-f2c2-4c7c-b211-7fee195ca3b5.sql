-- Settings (single row, auth-protected)
CREATE TABLE public.evolution_settings (
  id BOOLEAN PRIMARY KEY DEFAULT true,
  url TEXT NOT NULL DEFAULT '',
  api_key TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id = true)
);

ALTER TABLE public.evolution_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view settings" ON public.evolution_settings
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can insert settings" ON public.evolution_settings
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "Authenticated can update settings" ON public.evolution_settings
  FOR UPDATE TO authenticated USING (true);

-- Instances (public RLS, temporary)
CREATE TABLE public.instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.instances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view instances" ON public.instances
  FOR SELECT USING (true);
CREATE POLICY "Public can insert instances" ON public.instances
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Public can update instances" ON public.instances
  FOR UPDATE USING (true);
CREATE POLICY "Public can delete instances" ON public.instances
  FOR DELETE USING (true);

-- Timestamp trigger
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_evolution_settings_updated_at
  BEFORE UPDATE ON public.evolution_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_instances_updated_at
  BEFORE UPDATE ON public.instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();