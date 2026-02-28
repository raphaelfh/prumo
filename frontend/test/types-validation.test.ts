/**
 * Testes de validação de tipos
 * 
 * Valida que os tipos base (Article, Project) estão corretamente definidos
 * e podem ser usados sem erros de compilação.
 * 
 * Este teste valida apenas estrutura de tipos TypeScript, sem dependências externas.
 */

import {describe, expect, it} from 'vitest';
import type {Article, ArticleListItem} from '@/types/article';
import {toArticleListItem} from '@/types/article';
import type {Project, ProjectData} from '@/types/project';

describe('Type Definitions - Article', () => {
  it('deve ter tipo Article definido corretamente', () => {
    // Mock de Article baseado no tipo do Supabase
    const mockArticle: Article = {
      id: 'test-article-id',
      title: 'Test Article',
      abstract: 'Test abstract',
      article_type: null,
      arxiv_id: null,
      authors: ['Author 1', 'Author 2'],
      conflicts_of_interest: null,
      created_at: new Date().toISOString(),
      data_availability: null,
      doi: '10.1234/test',
      funding: null,
      hash_fingerprint: null,
      ingestion_source: null,
      issue: null,
      journal_eissn: null,
      journal_issn: null,
      journal_publisher: null,
      journal_title: 'Test Journal',
      keywords: ['keyword1', 'keyword2'],
      language: null,
      license: null,
      mesh_terms: null,
      open_access: null,
      pages: null,
      pii: null,
      pmcid: null,
      pmid: null,
      project_id: 'test-project-id',
      publication_day: null,
      publication_month: null,
      publication_status: null,
      publication_year: 2024,
      registration: null,
      row_version: 1,
      source_payload: null,
      study_design: null,
      updated_at: new Date().toISOString(),
      url_landing: null,
      url_pdf: null,
      volume: null,
    };

    expect(mockArticle.id).toBe('test-article-id');
    expect(mockArticle.title).toBe('Test Article');
    expect(mockArticle.project_id).toBe('test-project-id');
  });

  it('deve ter tipo ArticleListItem definido corretamente', () => {
    const mockListItem: ArticleListItem = {
      id: 'test-id',
      title: 'Test Title',
      authors: ['Author'],
      publication_year: 2024,
      journal_title: 'Journal',
      doi: '10.1234/test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    expect(mockListItem.id).toBeDefined();
    expect(mockListItem.title).toBeDefined();
    expect(typeof mockListItem.publication_year).toBe('number');
  });

  it('toArticleListItem deve converter Article para ArticleListItem', () => {
    const mockArticle: Article = {
      id: 'test-id',
      title: 'Test',
      authors: ['Author'],
      publication_year: 2024,
      journal_title: 'Journal',
      doi: '10.1234/test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      abstract: null,
      article_type: null,
      arxiv_id: null,
      conflicts_of_interest: null,
      data_availability: null,
      funding: null,
      hash_fingerprint: null,
      ingestion_source: null,
      issue: null,
      journal_eissn: null,
      journal_issn: null,
      journal_publisher: null,
      keywords: null,
      language: null,
      license: null,
      mesh_terms: null,
      open_access: null,
      pages: null,
      pii: null,
      pmcid: null,
      pmid: null,
      project_id: 'project-id',
      publication_day: null,
      publication_month: null,
      publication_status: null,
      registration: null,
      row_version: 1,
      source_payload: null,
      study_design: null,
      url_landing: null,
      url_pdf: null,
      volume: null,
    };

    const listItem = toArticleListItem(mockArticle);

    expect(listItem.id).toBe(mockArticle.id);
    expect(listItem.title).toBe(mockArticle.title);
    expect(listItem.authors).toEqual(mockArticle.authors);
    expect(listItem.publication_year).toBe(mockArticle.publication_year);
    expect(listItem.journal_title).toBe(mockArticle.journal_title);
    expect(listItem.doi).toBe(mockArticle.doi);
  });
});

describe('Type Definitions - Project', () => {
  it('deve ter tipo Project definido corretamente', () => {
    // Mock de Project baseado no tipo do Supabase
    const mockProject: Project = {
      id: 'test-project-id',
      name: 'Test Project',
      description: 'Test description',
      condition_studied: null,
      created_at: new Date().toISOString(),
      created_by_id: 'test-user-id',
      eligibility_criteria: null,
      is_active: true,
      review_context: null,
      review_keywords: null,
      review_rationale: null,
      review_title: null,
      risk_of_bias_instrument_id: null,
      search_strategy: null,
      settings: null,
      study_design: null,
      updated_at: new Date().toISOString(),
    };

    expect(mockProject.id).toBe('test-project-id');
    expect(mockProject.name).toBe('Test Project');
    expect(mockProject.is_active).toBe(true);
  });

  it('deve ter tipo ProjectData estendendo Project', () => {
    // ProjectData é usado em vários lugares do código
    // Validar que está compatível com Project
    const mockProjectData: Partial<ProjectData> = {
      id: 'test-id',
      name: 'Test',
      description: null,
      review_title: null,
      condition_studied: null,
    };

    expect(mockProjectData.id).toBeDefined();
    expect(mockProjectData.name).toBeDefined();
  });
});
