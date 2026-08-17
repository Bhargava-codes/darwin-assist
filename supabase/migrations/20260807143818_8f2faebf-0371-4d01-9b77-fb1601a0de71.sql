CREATE TABLE public.feedback (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  turn_index integer NOT NULL,
  rating text NOT NULL CHECK (rating IN ('up','down')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (conversation_id, turn_index)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.feedback TO authenticated;
GRANT ALL ON public.feedback TO service_role;

ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY via_conversation ON public.feedback
  FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = feedback.conversation_id
      AND (c.employee_id = public.current_employee_id() OR public.is_hr_ops())
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.conversations c
    WHERE c.id = feedback.conversation_id
      AND (c.employee_id = public.current_employee_id() OR public.is_hr_ops())
  ));

CREATE INDEX feedback_conversation_idx ON public.feedback (conversation_id);
CREATE INDEX feedback_created_at_idx ON public.feedback (created_at DESC);