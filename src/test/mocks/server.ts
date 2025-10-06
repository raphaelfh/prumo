import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';

// Mock handlers para APIs
export const handlers = [
  // Mock do Supabase Auth
  http.post('*/auth/v1/token', () => {
    return HttpResponse.json({
      access_token: 'mock-access-token',
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: 'mock-refresh-token',
      user: {
        id: 'mock-user-id',
        email: 'test@example.com',
        created_at: new Date().toISOString(),
      },
    });
  }),

  // Mock de projetos
  http.get('*/rest/v1/projects*', () => {
    return HttpResponse.json([
      {
        id: 'mock-project-id',
        name: 'Projeto Teste',
        description: 'Descrição do projeto teste',
        created_by_id: 'mock-user-id',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }),

  // Mock de artigos
  http.get('*/rest/v1/articles*', () => {
    return HttpResponse.json([
      {
        id: 'mock-article-id',
        title: 'Artigo Teste',
        abstract: 'Resumo do artigo teste',
        authors: ['Autor 1', 'Autor 2'],
        publication_year: 2024,
        project_id: 'mock-project-id',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }),

  // Mock de instrumentos de avaliação
  http.get('*/rest/v1/assessment_instruments*', () => {
    return HttpResponse.json([
      {
        id: 'mock-instrument-id',
        name: 'Instrumento Teste',
        description: 'Descrição do instrumento',
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }),

  // Mock de itens de avaliação
  http.get('*/rest/v1/assessment_items*', () => {
    return HttpResponse.json([
      {
        id: 'mock-item-id',
        instrument_id: 'mock-instrument-id',
        item_code: 'Q1',
        question: 'Pergunta de teste?',
        allowed_levels: ['Sim', 'Não', 'Não se aplica'],
        sort_order: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }),

  // Mock de avaliações
  http.get('*/rest/v1/assessments*', () => {
    return HttpResponse.json([
      {
        id: 'mock-assessment-id',
        project_id: 'mock-project-id',
        article_id: 'mock-article-id',
        user_id: 'mock-user-id',
        instrument_id: 'mock-instrument-id',
        tool_type: 'manual',
        responses: {
          Q1: { level: 'Sim', comment: 'Comentário de teste' },
        },
        status: 'in_progress',
        completion_percentage: 50,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ]);
  }),

  // Mock de upload de arquivos
  http.post('*/storage/v1/object/articles*', () => {
    return HttpResponse.json({
      path: 'mock-file-path.pdf',
      fullPath: 'articles/mock-file-path.pdf',
    });
  }),

  // Mock de download de arquivos
  http.get('*/storage/v1/object/articles*', () => {
    return new Response(new Blob(['mock pdf content'], { type: 'application/pdf' }), {
      headers: {
        'Content-Type': 'application/pdf',
      },
    });
  }),

  // Mock de Edge Functions (AI Assessment)
  http.post('*/functions/v1/ai-assessment', () => {
    return HttpResponse.json({
      success: true,
      assessment: {
        id: 'mock-ai-assessment-id',
        selected_level: 'Sim',
        confidence_score: 0.95,
        justification: 'Justificativa da IA',
        evidence_passages: [
          {
            text: 'Evidência encontrada no texto',
            page_number: 1,
            relevance_score: 0.9,
          },
        ],
      },
      traceId: 'mock-trace-id',
    });
  }),
];

// Configurar o servidor MSW
export const server = setupServer(...handlers);
