-- Insert PROBAST instruments with distinct versions for dev/eval and minimal items
-- Instruments
INSERT INTO assessment_instruments (name, tool_type, mode, version, allowed_levels, schema, is_active)
SELECT 'PROBAST+AI Model Development', 'PROBAST', 'human', '1.0-dev',
       '["low","high","unclear","no_information"]'::jsonb,
       '{"domains":[{"code":"D1","name":"Participants"},{"code":"D2","name":"Predictors"},{"code":"D3","name":"Outcome"},{"code":"D4","name":"Analysis"}]}'::jsonb,
       true
WHERE NOT EXISTS (
  SELECT 1 FROM assessment_instruments WHERE tool_type='PROBAST' AND version='1.0-dev' AND mode='human'
);

INSERT INTO assessment_instruments (name, tool_type, mode, version, allowed_levels, schema, is_active)
SELECT 'PROBAST+AI Model Evaluation', 'PROBAST', 'human', '1.0-eval',
       '["low","high","unclear","no_information"]'::jsonb,
       '{"domains":[{"code":"D1","name":"Participants"},{"code":"D2","name":"Predictors"},{"code":"D3","name":"Outcome"},{"code":"D4","name":"Analysis"}]}'::jsonb,
       true
WHERE NOT EXISTS (
  SELECT 1 FROM assessment_instruments WHERE tool_type='PROBAST' AND version='1.0-eval' AND mode='human'
);

-- Items for Model Development
WITH dev AS (
  SELECT id FROM assessment_instruments WHERE tool_type='PROBAST' AND version='1.0-dev' AND mode='human'
)
INSERT INTO assessment_items (instrument_id, domain, item_code, question, sort_order, required)
SELECT dev.id, x.domain, x.item_code, x.question, x.sort_order, true
FROM dev,
(VALUES
  ('D1','D1.Q1','A definição da população de participantes é apropriada?', 1),
  ('D1','D1.Q2','Os critérios de inclusão/exclusão foram claramente especificados?', 2),
  ('D2','D2.Q1','Os preditores foram claramente definidos e medidos de forma adequada?', 3),
  ('D3','D3.Q1','O desfecho foi claramente definido e medido de forma apropriada?', 4),
  ('D4','D4.Q1','O tamanho amostral e número de eventos foram adequados?', 5)
) AS x(domain, item_code, question, sort_order)
ON CONFLICT DO NOTHING;

-- Items for Model Evaluation
WITH eval AS (
  SELECT id FROM assessment_instruments WHERE tool_type='PROBAST' AND version='1.0-eval' AND mode='human'
)
INSERT INTO assessment_items (instrument_id, domain, item_code, question, sort_order, required)
SELECT eval.id, x.domain, x.item_code, x.question, x.sort_order, true
FROM eval,
(VALUES
  ('D1','D1.Q1','A população de validação é representativa do uso pretendido?', 1),
  ('D1','D1.Q2','Há diferenças sistemáticas entre coorte de desenvolvimento e de avaliação?', 2),
  ('D2','D2.Q1','Os preditores foram medidos de forma semelhante à coorte de desenvolvimento?', 3),
  ('D3','D3.Q1','O desfecho foi avaliado de forma consistente e apropriada?', 4),
  ('D4','D4.Q1','As métricas de desempenho foram reportadas adequadamente?', 5)
) AS x(domain, item_code, question, sort_order)
ON CONFLICT DO NOTHING;
