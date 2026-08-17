DROP FUNCTION IF EXISTS public.match_policy_small(vector, integer);

CREATE OR REPLACE FUNCTION public.match_policy_small(
  query_embedding vector,
  match_count integer DEFAULT 6,
  match_threshold double precision DEFAULT 0.32
)
RETURNS TABLE(chunk_id text, section text, heading text, content text, object_tags text[], similarity double precision)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  select p.chunk_id, p.section, p.heading, p.content, p.object_tags,
         1 - (p.embedding <=> query_embedding) as similarity
  from public.policy_chunks_small p
  where p.embedding is not null
    and (1 - (p.embedding <=> query_embedding)) >= match_threshold
  order by p.embedding <=> query_embedding
  limit match_count;
$$;

REVOKE EXECUTE ON FUNCTION public.match_policy_small(vector, integer, double precision) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.match_policy_small(vector, integer, double precision) TO authenticated, service_role;