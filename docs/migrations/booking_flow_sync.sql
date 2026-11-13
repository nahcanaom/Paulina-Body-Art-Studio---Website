-- Run once in the SQL Editor for project celusvfynfnszmhjgqwj.
-- This transaction preserves records and stops if existing data has duplicate
-- request tokens or active slots. Resolve such duplicates before retrying.
BEGIN;

ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reference_image_url text NOT NULL DEFAULT '';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS reference_file_name text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS booking_reference_unique ON public.bookings (reference);
CREATE UNIQUE INDEX IF NOT EXISTS request_reference_unique ON public.custom_requests (reference);
CREATE UNIQUE INDEX IF NOT EXISTS booking_request_token_unique ON public.bookings (client_request_id)
  WHERE coalesce(client_request_id, '') <> '';
CREATE UNIQUE INDEX IF NOT EXISTS booking_active_slot_unique ON public.bookings
  (date, lower(trim(artist)), lower(trim(time)))
  WHERE status IN ('pending_confirmation', 'confirmed', 'late', 'completed');

CREATE OR REPLACE FUNCTION public.is_studio_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND (
    coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin'
    OR lower(coalesce(auth.jwt() ->> 'email', '')) IN ('paulinabodyartstudio@gmail.com', 'faye08022005@gmail.com')
  );
$$;

-- The server verifies admin identity. Browser reads are admin-only for realtime.
DO $$
DECLARE tbl text; pol record;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['bookings', 'custom_requests', 'notifications'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tbl);
    FOR pol IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = tbl LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', pol.policyname, tbl);
    END LOOP;
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', tbl);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', tbl);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', tbl);
    EXECUTE format('CREATE POLICY studio_admin_read ON public.%I FOR SELECT TO authenticated USING (public.is_studio_admin())', tbl);
  END LOOP;
END;
$$;

-- Payment receipts and customer reference pictures are delivered as expiring
-- signed URLs by the authenticated admin API.
UPDATE storage.buckets SET public = false WHERE id = 'custom-requests';
DROP POLICY IF EXISTS studio_private_attachments ON storage.objects;
CREATE POLICY studio_private_attachments ON storage.objects AS RESTRICTIVE
  FOR ALL TO anon, authenticated
  USING (bucket_id <> 'custom-requests') WITH CHECK (bucket_id <> 'custom-requests');

CREATE OR REPLACE FUNCTION public.sync_booking_request() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.custom_requests WHERE reference = OLD.reference;
    RETURN OLD;
  END IF;
  INSERT INTO public.custom_requests (
    booking_id, reference, full_name, email, phone, service, service_type, artist,
    date, time, concept_description, placement, dimensions, style, tattoo_form_type,
    reference_image_url, reference_file_name, receipt_image_url, receipt_file_name,
    status, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.reference, NEW.full_name, NEW.email, NEW.phone, NEW.service, NEW.service_type, NEW.artist,
    NEW.date::text, NEW.time, NEW.notes, NEW.placement, NEW.tattoo_size, NEW.tattoo_style, NEW.tattoo_form_type,
    NEW.reference_image_url, NEW.reference_file_name, NEW.receipt_url, NEW.receipt_file_name,
    CASE WHEN NEW.status IN ('confirmed', 'completed', 'late', 'noshow') THEN 'accepted'
         WHEN NEW.status IN ('cancelled', 'canceled') THEN 'declined' ELSE 'pending' END,
    NEW.created_at, now()
  ) ON CONFLICT (reference) DO UPDATE SET
    booking_id = EXCLUDED.booking_id, full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    phone = EXCLUDED.phone, service = EXCLUDED.service, service_type = EXCLUDED.service_type,
    artist = EXCLUDED.artist, date = EXCLUDED.date, time = EXCLUDED.time,
    concept_description = EXCLUDED.concept_description, placement = EXCLUDED.placement,
    dimensions = EXCLUDED.dimensions, style = EXCLUDED.style, tattoo_form_type = EXCLUDED.tattoo_form_type,
    reference_image_url = EXCLUDED.reference_image_url, reference_file_name = EXCLUDED.reference_file_name,
    receipt_image_url = EXCLUDED.receipt_image_url, receipt_file_name = EXCLUDED.receipt_file_name,
    status = EXCLUDED.status, updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_request_sync ON public.bookings;
CREATE TRIGGER booking_request_sync AFTER INSERT OR UPDATE OR DELETE ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.sync_booking_request();

CREATE OR REPLACE FUNCTION public.decide_booking_request(p_reference text, p_decision text, p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE current_request public.custom_requests; changed public.custom_requests;
BEGIN
  -- Lock the booking first, matching the booking -> request trigger lock order.
  PERFORM 1 FROM public.bookings WHERE reference = p_reference FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO current_request FROM public.custom_requests WHERE reference = p_reference FOR UPDATE;
  IF current_request.reference IS NULL THEN RAISE EXCEPTION 'Request not found' USING ERRCODE = 'P0002'; END IF;
  IF current_request.status IN ('accepted', 'declined') THEN
    RAISE EXCEPTION 'This request was already reviewed' USING ERRCODE = 'P0001';
  END IF;
  IF p_decision NOT IN ('accept', 'decline') OR (p_decision = 'decline' AND trim(coalesce(p_reason, '')) = '') THEN
    RAISE EXCEPTION 'Invalid decision' USING ERRCODE = '22023';
  END IF;
  UPDATE public.bookings SET
    status = CASE WHEN p_decision = 'accept' THEN 'confirmed' ELSE 'cancelled' END,
    deposit_status = CASE WHEN p_decision = 'accept' THEN 'paid' ELSE deposit_status END,
    updated_at = now()
    WHERE reference = p_reference;
  UPDATE public.custom_requests SET
    reviewed_at = coalesce(reviewed_at, now()), decided_at = now(),
    decline_reason = CASE WHEN p_decision = 'decline' THEN p_reason ELSE '' END,
    updated_at = now()
    WHERE reference = p_reference RETURNING * INTO changed;
  RETURN to_jsonb(changed);
END;
$$;

CREATE OR REPLACE FUNCTION public.booking_flow_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgname = 'booking_request_sync' AND NOT tgisinternal);
$$;
REVOKE ALL ON FUNCTION public.sync_booking_request() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.decide_booking_request(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.booking_flow_ready() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_booking_request() TO service_role;
GRANT EXECUTE ON FUNCTION public.decide_booking_request(text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.booking_flow_ready() TO service_role;

-- Seed missing queue entries and refresh matching fields using the same trigger.
UPDATE public.bookings SET updated_at = updated_at WHERE coalesce(reference, '') <> '';

NOTIFY pgrst, 'reload schema';
COMMIT;
