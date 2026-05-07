CREATE POLICY "Public can view settings" ON public.evolution_settings
  FOR SELECT USING (true);