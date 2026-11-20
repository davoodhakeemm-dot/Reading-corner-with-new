-- Non-destructive Reading Corner Social & Direct Messaging Migration (Supabase / PostgreSQL)
-- Preserves all existing tables, users, books, reading history, bookmarks, and saved books.

ALTER TABLE public.rc_profiles
  ADD COLUMN IF NOT EXISTS email text,
  ALTER COLUMN phone_e164 DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rc_profiles_email_unique
  ON public.rc_profiles(lower(email))
  WHERE email IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rc_profiles_handle_unique
  ON public.rc_profiles(lower(display_handle));

-- Followers / Following relationships
CREATE TABLE IF NOT EXISTS public.rc_followers (
  follower_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id),
  CHECK (follower_id <> following_id)
);

CREATE INDEX IF NOT EXISTS idx_rc_followers_following ON public.rc_followers(following_id);

ALTER TABLE public.rc_followers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rc_followers_select_authed" ON public.rc_followers
  FOR SELECT TO authenticated
  USING (
    NOT public.rc_is_blocked(auth.uid(), follower_id)
    AND NOT public.rc_is_blocked(auth.uid(), following_id)
  );

CREATE POLICY "rc_followers_insert_own" ON public.rc_followers
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = follower_id
    AND NOT public.rc_is_blocked(follower_id, following_id)
  );

CREATE POLICY "rc_followers_delete_own" ON public.rc_followers
  FOR DELETE TO authenticated
  USING (auth.uid() = follower_id);

-- Extend messages for replies, edits, soft deletes, and delivery receipts
ALTER TABLE public.rc_messages
  ADD COLUMN IF NOT EXISTS reply_to_id uuid REFERENCES public.rc_messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE POLICY "rc_messages_update_sender_own" ON public.rc_messages
  FOR UPDATE TO authenticated
  USING (auth.uid() = sender_id)
  WITH CHECK (auth.uid() = sender_id);

-- Message emoji reactions
CREATE TABLE IF NOT EXISTS public.rc_message_reactions (
  message_id uuid NOT NULL REFERENCES public.rc_messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

ALTER TABLE public.rc_message_reactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rc_reactions_select_participants" ON public.rc_message_reactions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.rc_messages m
      WHERE m.id = message_id AND (m.sender_id = auth.uid() OR m.recipient_id = auth.uid())
    )
  );

CREATE POLICY "rc_reactions_upsert_own" ON public.rc_message_reactions
  FOR ALL TO authenticated
  USING (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM public.rc_messages m
      WHERE m.id = message_id AND (m.sender_id = auth.uid() OR m.recipient_id = auth.uid())
    )
  )
  WITH CHECK (auth.uid() = user_id);

-- Conversation pin & mute settings per user
CREATE TABLE IF NOT EXISTS public.rc_conversation_settings (
  user_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  peer_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  pinned boolean NOT NULL DEFAULT false,
  muted boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, peer_id)
);

ALTER TABLE public.rc_conversation_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rc_conv_settings_owner_all" ON public.rc_conversation_settings
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- User safety reports
CREATE TABLE IF NOT EXISTS public.rc_user_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  reported_user_id uuid NOT NULL REFERENCES public.rc_profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.rc_user_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rc_reports_insert_own" ON public.rc_user_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = reporter_id AND reporter_id <> reported_user_id);

CREATE POLICY "rc_reports_select_own" ON public.rc_user_reports
  FOR SELECT TO authenticated
  USING (auth.uid() = reporter_id);
