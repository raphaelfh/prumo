export type AnnotationType = 'highlight' | 'note' | 'area' | 'underline';
export type AnnotationStatus = 'active' | 'deleted';

export interface AnnotationPosition {
  x: number;        // 0 = left, 1 = right (relative)
  y: number;        // 0 = top, 1 = bottom (relative)
  width: number;    // proportion of page width
  height: number;   // proportion of page height
}

export interface Annotation {
  id: string;
  pageNumber: number;
  type: AnnotationType;
  
  // Relative position (0-1) - works at any scale
  position: AnnotationPosition;
  
  // Content
  text?: string;
  comment?: string;
  
  // Style
  color: string;
  opacity: number;
  
  // Metadata
  createdAt: string;
  updatedAt: string;
  authorId?: string;
  status: AnnotationStatus;
}

export interface DrawingState {
  start: { x: number; y: number; page: number };
  current?: { x: number; y: number };
}
