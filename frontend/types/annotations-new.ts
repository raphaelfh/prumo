// ========================================
// TYPES FOR NEW ANNOTATIONS ARCHITECTURE
// ========================================

export interface Position {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ColorData {
  r?: number;
  g?: number;
  b?: number;
  color?: string;
  opacity: number;
}

// ========================================
// TIPOS DO BANCO DE DADOS
// ========================================

export interface ArticleHighlightRow {
  id: string;
  article_id: string;
  page_number: number;
  selected_text: string;
  scaled_position: Position;
  color: ColorData;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleBoxRow {
  id: string;
  article_id: string;
  page_number: number;
  scaled_position: Position;
  color: ColorData;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArticleCommentRow {
  id: string;
  article_id: string;
  highlight_id: string | null;
  box_id: string | null;
  parent_id: string | null;
  content: string;
  author_id: string | null;
  is_resolved: boolean;
  created_at: string;
  updated_at: string;
}

// ========================================
// TIPOS DO STORE (FRONTEND)
// ========================================

// ✅ Tipos corrigidos para corresponder ao schema do banco
export type AnnotationType = 'text' | 'area' | 'highlight' | 'note' | 'underline';
export type AnnotationStatus = 'active' | 'deleted';

export interface DrawingState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  pageNumber: number;
}

export interface BaseAnnotation {
  id: string;
  articleId: string;
  pageNumber: number;
  position: Position;
  color: string;
  opacity: number;
  authorId?: string;
  status: AnnotationStatus;
  createdAt: string;
  updatedAt: string;
  // UI state
  isSelected?: boolean;
  isHovered?: boolean;
}

export interface HighlightAnnotation extends BaseAnnotation {
  type: 'highlight';
  selectedText: string;
  textRanges?: Array<{
    start: number;
    end: number;
    rect: DOMRect;
  }>;
}

export interface AreaAnnotation extends BaseAnnotation {
  type: 'area';
  shapeType?: 'rectangle' | 'circle' | 'polygon';
  shapeData?: any;
}

export interface NoteAnnotation extends BaseAnnotation {
  type: 'note';
  content: string;
}

export type Annotation = HighlightAnnotation | AreaAnnotation | NoteAnnotation;

export interface Comment {
  id: string;
  annotationId: string;
  parentId?: string;
  content: string;
  authorId?: string;
  authorName?: string;
  isResolved: boolean;
  createdAt: string;
  updatedAt: string;
    // For threads
  replies?: Comment[];
}

// ========================================
// TYPES FOR DB INSERT
// ========================================

export interface HighlightInsert {
  id?: string;
  article_id: string;
  page_number: number;
  selected_text: string;
  scaled_position: Position;
  color: ColorData;
  author_id: string | null;
}

export interface BoxInsert {
  id?: string;
  article_id: string;
  page_number: number;
  scaled_position: Position;
  color: ColorData;
  author_id: string | null;
}

export interface CommentInsert {
  id?: string;
  article_id: string;
  highlight_id?: string | null;
  box_id?: string | null;
  parent_id?: string | null;
  content: string;
  author_id: string | null;
  is_resolved?: boolean;
}

// ========================================
// UTILITÁRIOS
// ========================================

export function isHighlight(annotation: Annotation): annotation is HighlightAnnotation {
  return annotation.type === 'highlight';
}

export function isArea(annotation: Annotation): annotation is AreaAnnotation {
  return annotation.type === 'area';
}

export function isNote(annotation: Annotation): annotation is NoteAnnotation {
  return annotation.type === 'note';
}

export function colorToRGB(color: string, opacity: number): ColorData {
  if (color.startsWith('#')) {
    const hex = color.replace('#', '');
    const r = parseInt(hex.substr(0, 2), 16);
    const g = parseInt(hex.substr(2, 2), 16);
    const b = parseInt(hex.substr(4, 2), 16);
    return { r, g, b, opacity };
  }
  return { color, opacity };
}

export function colorFromRGB(colorData: ColorData): { color: string; opacity: number } {
  if (colorData.r !== undefined && colorData.g !== undefined && colorData.b !== undefined) {
    const color = `rgb(${colorData.r}, ${colorData.g}, ${colorData.b})`;
    return { color, opacity: colorData.opacity };
  }
  return { color: colorData.color || '#FFEB3B', opacity: colorData.opacity };
}
