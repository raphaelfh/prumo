/**
 * Tipos para targets de assessment
 * 
 * Usa Discriminated Union para type safety completo:
 * - AssessmentArticleTarget: assessment do artigo inteiro
 * - AssessmentInstanceTarget: assessment de uma instância específica (ex: um modelo)
 */

import { ExtractionInstance } from './extraction';

// Interface base compartilhada
interface BaseAssessmentTarget {
  id: string;
  label: string;
  article_id: string;
  article_title: string;
}

// Target: artigo completo
export interface AssessmentArticleTarget extends BaseAssessmentTarget {
  type: 'article';
  extraction_instance_id: null;
}

// Target: instância específica de extraction
export interface AssessmentInstanceTarget extends BaseAssessmentTarget {
  type: 'extraction_instance';
  extraction_instance_id: string;
  instance: ExtractionInstance;
  instance_label: string;
}

// Discriminated Union para type safety
export type AssessmentTarget = 
  | AssessmentArticleTarget 
  | AssessmentInstanceTarget;

// Type guards para uso seguro
export function isInstanceTarget(
  target: AssessmentTarget
): target is AssessmentInstanceTarget {
  return target.type === 'extraction_instance';
}

export function isArticleTarget(
  target: AssessmentTarget
): target is AssessmentArticleTarget {
  return target.type === 'article';
}

// Helper para criar targets
export function createArticleTarget(
  articleId: string,
  articleTitle: string
): AssessmentArticleTarget {
  return {
    type: 'article',
    id: articleId,
    label: articleTitle,
    article_id: articleId,
    article_title: articleTitle,
    extraction_instance_id: null
  };
}

export function createInstanceTarget(
  instance: ExtractionInstance,
  articleTitle: string
): AssessmentInstanceTarget {
  return {
    type: 'extraction_instance',
    id: instance.id,
    label: `${articleTitle} > ${instance.label}`,
    article_id: instance.article_id,
    article_title: articleTitle,
    extraction_instance_id: instance.id,
    instance: instance,
    instance_label: instance.label
  };
}


