# Scope — portable template import/export slice

Run id: 2026-08-23-1530-portable-templates
Trigger: /ship-spec Phase 4 (architectural-quality-loop on the touched slice),
branch worktree-portable-template-import-export @ 31058691

Files:
- backend/app/services/template_portable_service.py
- backend/app/services/template_delete_service.py
- backend/app/services/project_template_active_service.py
- backend/app/schemas/template_portable.py
- backend/app/api/v1/endpoints/project_templates.py
- backend/app/core/integrity.py
- frontend/components/extraction/dialogs/ImportTemplateDialog.tsx
- frontend/components/extraction/dialogs/ImportTemplateFilePane.tsx
- frontend/components/extraction/dialogs/ProjectTemplatesList.tsx
- frontend/components/extraction/template-config/TemplateExportButton.tsx
- frontend/services/templateImportService.ts
