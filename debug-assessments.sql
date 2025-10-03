-- Debug: Ver configuração do projeto e assessments
SELECT 
  p.id as project_id,
  p.name as project_name,
  p.settings->>'blind_mode' as blind_mode,
  COUNT(DISTINCT a.id) as total_assessments,
  COUNT(DISTINCT CASE WHEN a.is_blind = false THEN a.id END) as non_blind_assessments,
  COUNT(DISTINCT CASE WHEN a.status = 'submitted' THEN a.id END) as submitted_assessments
FROM projects p
LEFT JOIN assessments a ON a.project_id = p.id
GROUP BY p.id, p.name, p.settings;

-- Ver todos os assessments não-blind
SELECT 
  a.id,
  a.article_id,
  a.user_id,
  a.instrument_id,
  a.status,
  a.is_blind,
  a.completion_percentage,
  a.project_id,
  prof.full_name as user_name
FROM assessments a
JOIN profiles prof ON prof.id = a.user_id
WHERE a.is_blind = false
ORDER BY a.created_at DESC
LIMIT 20;
