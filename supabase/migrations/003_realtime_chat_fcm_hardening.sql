-- Non-destructive Reading Corner Realtime Chat, Secret/Normal Gallery, WebRTC & FCM Migration
-- Safe to run multiple times (idempotent, additive only). Preserves all existing tables, users,
-- books, reading progress, saved books, conversations, messages, and personal NFC links.

-- 1. Secret vs Normal Gallery scope column on private media objects
ALTER TABLE public.rc_media_objects
  ADD COLUMN IF NOT EXISTS gallery_scope text NOT NULL DEFAULT 'normal'
  CHECK (gallery_scope IN ('normal', 'secret'));

CREATE INDEX IF NOT EXISTS idx_rc_media_owner_scope
  ON public.rc_media_objects(owner_id, gallery_scope, created_at DESC);

-- 2. Cursor pagination index for fast newest-first loading on mobile & desktop
CREATE INDEX IF NOT EXISTS idx_rc_messages_thread_created_id
  ON public.rc_messages(thread_key, created_at DESC, id DESC);

-- 3. Firebase Cloud Messaging (FCM) device registration tokens (owner-only RLS)
CREATE TABLE IF NOT EXISTS public.rc_notification_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  token text UNIQUE NOT NULL,
  platform text NOT NULL DEFAULT 'web',
  device_label text NOT NULL DEFAULT 'browser',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rc_notif_tokens_user
  ON public.rc_notification_tokens(user_id, updated_at DESC);

ALTER TABLE public.rc_notification_tokens ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rc_notification_tokens' AND policyname = 'rc_notif_tokens_owner_all'
  ) THEN
    CREATE POLICY "rc_notif_tokens_owner_all" ON public.rc_notification_tokens
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 4. Per-user push notification preferences (owner-only RLS)
CREATE TABLE IF NOT EXISTS public.rc_notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT true,
  message_preview boolean NOT NULL DEFAULT true,
  call_alerts boolean NOT NULL DEFAULT true,
  quiet_hours_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rc_notification_preferences ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rc_notification_preferences' AND policyname = 'rc_notif_prefs_owner_all'
  ) THEN
    CREATE POLICY "rc_notif_prefs_owner_all" ON public.rc_notification_preferences
      FOR ALL TO authenticated
      USING (auth.uid() = user_id)
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

-- 5. WebRTC Call signaling log (participant-only RLS, rejects blocked pairs)
CREATE TABLE IF NOT EXISTS public.rc_call_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id text NOT NULL,
  caller_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  callee_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  call_type text NOT NULL CHECK (call_type IN ('audio', 'video')),
  signal_type text NOT NULL CHECK (signal_type IN ('offer', 'answer', 'candidate', 'accept', 'decline', 'end', 'busy')),
  payload_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rc_call_signals_call_id
  ON public.rc_call_signals(call_id, created_at);

ALTER TABLE public.rc_call_signals ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rc_call_signals' AND policyname = 'rc_call_signals_select_participants'
  ) THEN
    CREATE POLICY "rc_call_signals_select_participants" ON public.rc_call_signals
      FOR SELECT TO authenticated
      USING (auth.uid() = caller_id OR auth.uid() = callee_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'rc_call_signals' AND policyname = 'rc_call_signals_insert_participant'
  ) THEN
    CREATE POLICY "rc_call_signals_insert_participant" ON public.rc_call_signals
      FOR INSERT TO authenticated
      WITH CHECK (
        (auth.uid() = caller_id OR auth.uid() = callee_id)
        AND NOT public.rc_is_blocked(caller_id, callee_id)
      );
  END IF;
END $$;

-- 6. Ensure private storage bucket (never public URLs) & strict object ACLs
INSERT INTO storage.buckets (id, name, public)
VALUES ('reading-corner-media', 'reading-corner-media', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rc_storage_media_select_participants'
  ) THEN
    CREATE POLICY "rc_storage_media_select_participants" ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'reading-corner-media'
        AND EXISTS (
          SELECT 1 FROM public.rc_media_objects m
          WHERE m.storage_path = name
            AND (
              m.owner_id = auth.uid()
              OR (m.recipient_id = auth.uid() AND NOT public.rc_is_blocked(m.owner_id, m.recipient_id))
            )
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rc_storage_media_insert_owner'
  ) THEN
    CREATE POLICY "rc_storage_media_insert_owner" ON storage.objects
      FOR INSERT TO authenticated
      WITH CHECK (
        bucket_id = 'reading-corner-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'rc_storage_media_delete_owner'
  ) THEN
    CREATE POLICY "rc_storage_media_delete_owner" ON storage.objects
      FOR DELETE TO authenticated
      USING (
        bucket_id = 'reading-corner-media'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
