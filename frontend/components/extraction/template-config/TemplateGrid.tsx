import {Fragment} from 'react';
import {
  Check,
  ChevronDown,
  ChevronRight,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';

import {Input} from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {Tooltip, TooltipContent, TooltipTrigger} from '@/components/ui/tooltip';
import {t} from '@/lib/copy';
import {cn} from '@/lib/utils';

import type {GridField, GridSection, TemplateMatchHint} from './templateTree';

/**
 * The template configuration grid (spec §2, mock `manager-grid-v3-polish`).
 *
 * B-1 renders and selects; it does not edit. A second click or Enter on a
 * field raises `onEditField`, which the parent bridges to the existing
 * dialog — inline cell editing waits for B-4 to stop the per-edit
 * republish, because Enter-chaining against today's republish would mint
 * one version per cell.
 */

export interface TemplateGridSelection {
  kind: 'field' | 'section';
  id: string;
}

/**
 * Section-level actions the accordion used to expose through its `⋮` menu.
 * Kept whole so replacing the accordion is not a capability regression;
 * rename stays inline (one commit, one republish — exactly today's cadence).
 */
export interface TemplateSectionActions {
  renamingId: string | null;
  renameValue: string;
  onRenameValueChange: (value: string) => void;
  onStartRename: (section: GridSection) => void;
  onCommitRename: (sectionId: string) => void;
  onCancelRename: () => void;
  onDelete: (section: GridSection) => void;
  onAddField: (sectionId: string) => void;
}

interface TemplateGridProps {
  sections: GridSection[];
  selection: TemplateGridSelection | null;
  onSelect: (selection: TemplateGridSelection) => void;
  onEditField: (field: GridField) => void;
  onDeleteField: (field: GridField) => void;
  sectionActions: TemplateSectionActions;
  onAddSection: () => void;
  collapsed: ReadonlySet<string>;
  onToggleCollapse: (sectionId: string) => void;
  showKeyColumn: boolean;
  showOptionsColumn: boolean;
  isFiltering: boolean;
}

type MatchHintCopyKey =
  | 'matchHintKey'
  | 'matchHintDescription'
  | 'matchHintAiInstruction'
  | 'matchHintOptions';

/** The label hit needs no hint — the user can see why it matched. */
const MATCH_HINT_COPY: Record<TemplateMatchHint, MatchHintCopyKey | null> = {
  label: null,
  key: 'matchHintKey',
  description: 'matchHintDescription',
  aiInstruction: 'matchHintAiInstruction',
  options: 'matchHintOptions',
};

/** Indentation ladder from the mock: identity 22px, sub-header 14px, child fields 36px. */
const INDENT = {
  rootField: 'pl-2',
  identityField: 'pl-[22px]',
  childHeader: 'pl-[14px]',
  childField: 'pl-[36px]',
} as const;

function TypePill({field}: {field: GridField}) {
  const label =
    field.optionCount > 0 ? `${field.fieldType} · ${field.optionCount}` : field.fieldType;
  return (
    <span className="inline-block truncate rounded-full border bg-muted/50 px-[7px] py-px text-[10.5px] capitalize text-muted-foreground">
      {label}
    </span>
  );
}

function RequiredBox({checked}: {checked: boolean}) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-[14px] items-center justify-center rounded border-[1.5px] align-middle',
        checked ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
      )}
    >
      {checked && <Check className="size-2.5" strokeWidth={3} aria-hidden />}
    </span>
  );
}

function FieldRow({
  field,
  indent,
  selected,
  onSelect,
  onEdit,
  onDelete,
  showKeyColumn,
  showOptionsColumn,
}: {
  field: GridField;
  indent: string;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onDelete: () => void;
  showKeyColumn: boolean;
  showOptionsColumn: boolean;
}) {
  const hintKey = field.matchHint ? MATCH_HINT_COPY[field.matchHint] : null;
  return (
    <tr
      data-testid="template-grid-field-row"
      className={cn(
        'group/row h-[30px] border-b border-border/50 hover:bg-muted/40',
        selected && 'bg-muted/60',
      )}
    >
      <td className="w-3.5 px-2 text-muted-foreground/60">
        <GripVertical className="size-3" aria-hidden />
      </td>
      <td className={cn('min-w-0 px-2', indent)}>
        {/* The focusable element is the button, not the row: a keyboard user
            must be able to reach and select every field. Double-click (mouse)
            edits; from the keyboard, select then use the inspector's Edit. */}
        {/* The row itself carries no handlers: a click target that also lives
            on the <tr> fires twice for nested controls, and `stopPropagation`
            on `click` does NOT stop `dblclick` — double-clicking the ⋯ menu
            used to open the edit dialog behind it. */}
        <button
          type="button"
          onClick={onSelect}
          onDoubleClick={onEdit}
          aria-current={selected ? 'true' : undefined}
          className={cn(
            'flex w-full max-w-full items-baseline gap-1.5 rounded text-left',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            selected && 'outline outline-2 -outline-offset-2 outline-ring',
          )}
        >
          <span className={cn('truncate', field.isRequired && 'font-medium')}>
            {field.label}
          </span>
          {hintKey && (
            <span className="shrink-0 text-[10.5px] text-muted-foreground">
              · {t('extraction', hintKey)}
            </span>
          )}
        </button>
      </td>
      {showKeyColumn && (
        <td className="max-w-[160px] truncate px-2 font-mono text-[10px] text-muted-foreground">
          {field.key}
        </td>
      )}
      <td className="w-[110px] px-2">
        <TypePill field={field} />
      </td>
      {showOptionsColumn && (
        <td className="max-w-[200px] truncate px-2 text-[10.5px] text-muted-foreground">
          {(field.allowedValues ?? []).join(', ')}
        </td>
      )}
      <td className="w-10 px-2">
        <RequiredBox checked={field.isRequired} />
        <span className="sr-only">
          {t(
            'extraction',
            field.isRequired ? 'inspectorRequiredYes' : 'inspectorRequiredNo',
          )}
        </span>
      </td>
      <td className="w-[26px] px-2">
        {field.hasAiInstruction && (
          <Sparkles className="size-3 text-primary" aria-label={t('extraction', 'gridColAi')} />
        )}
      </td>
      <td className="w-[34px] px-1 text-right">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={t('extraction', 'actionsForFieldAria').replace(
                '{{label}}',
                field.label,
              )}
              className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 data-[state=open]:opacity-100"
            >
              <MoreHorizontal className="size-3.5" aria-hidden />
            </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('extraction', 'gridRowActions')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'gridEditFieldTooltip')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={onDelete}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'deleteField')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function SectionHeaderRow({
  section,
  columnCount,
  indent,
  collapsed,
  selected,
  onToggle,
  onSelect,
  actions,
}: {
  section: GridSection;
  columnCount: number;
  indent: string;
  collapsed: boolean;
  selected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  actions: TemplateSectionActions;
}) {
  const isRenaming = actions.renamingId === section.id;
  const Chevron = collapsed ? ChevronRight : ChevronDown;
  const meta = [
    ...section.metaKeys.map((key) => t('extraction', key)),
    String(section.fieldCount),
  ];
  return (
    <tr
      data-testid="template-grid-section-row"
      className="h-8 border-b border-border/50 bg-muted/50"
    >
      <td className="w-3.5 px-2 text-muted-foreground/60">
        <GripVertical className="size-3" aria-hidden />
      </td>
      <td colSpan={columnCount - 2} className={cn('px-2', indent)}>
        <div className="flex items-center gap-[7px] overflow-hidden whitespace-nowrap">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-label={`${t('extraction', collapsed ? 'gridExpandSection' : 'gridCollapseSection')} — ${section.label}`}
            className="rounded text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Chevron className="size-3.5" aria-hidden />
          </button>
          {isRenaming ? (
            <Input
              value={actions.renameValue}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => actions.onRenameValueChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') actions.onCommitRename(section.id);
                if (event.key === 'Escape') {
                  event.stopPropagation();
                  actions.onCancelRename();
                }
              }}
              onBlur={() => actions.onCommitRename(section.id)}
              className="h-6 max-w-[220px] text-xs"
            />
          ) : (
            <button
              type="button"
              onClick={onSelect}
              aria-current={selected ? 'true' : undefined}
              className="truncate rounded text-left font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.label}
            </button>
          )}
          {section.hasDescription && (
            <span className="shrink-0 text-primary" aria-hidden>
              ●
            </span>
          )}
          <span className="truncate text-[10.5px] text-muted-foreground">
            · {meta.join(' · ')}
          </span>
        </div>
      </td>
      <td className="px-2 text-right">
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${t('extraction', 'gridAddMenu')} — ${section.label}`}
              className="inline-flex items-center gap-0.5 whitespace-nowrap rounded-md border bg-card px-[7px] py-px text-[10.5px] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Plus className="size-3" aria-hidden />
              <ChevronDown className="size-2.5" aria-hidden />
            </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>{t('extraction', 'gridAddMenu')}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="text-xs">
            <DropdownMenuItem onSelect={() => actions.onAddField(section.id)}>
              <Plus className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'gridNewField')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.onStartRename(section)}>
              <Pencil className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'editLabelButton')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => actions.onDelete(section)}
              className="text-destructive focus:text-destructive"
            >
              <Trash2 className="mr-2 size-3.5" aria-hidden />
              {t('extraction', 'removeButton')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function GhostRow({
  columnCount,
  indent,
  label,
  onClick,
  testId,
}: {
  columnCount: number;
  indent: string;
  label: string;
  onClick: () => void;
  testId: string;
}) {
  return (
    <tr className="h-[30px] border-b border-border/50">
      <td />
      <td colSpan={columnCount - 1} className={cn('px-2', indent)}>
        <button
          type="button"
          data-testid={testId}
          onClick={onClick}
          className="inline-flex items-center gap-1 rounded italic text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus className="size-3" aria-hidden />
          {label}
        </button>
      </td>
    </tr>
  );
}

export function TemplateGrid({
  sections,
  selection,
  onSelect,
  onEditField,
  onDeleteField,
  sectionActions,
  onAddSection,
  collapsed,
  onToggleCollapse,
  showKeyColumn,
  showOptionsColumn,
  isFiltering,
}: TemplateGridProps) {
  // grab · label · [key] · type · [options] · required · ai · row actions
  const columnCount = 6 + (showKeyColumn ? 1 : 0) + (showOptionsColumn ? 1 : 0);

  const isSelected = (kind: 'field' | 'section', id: string) =>
    selection?.kind === kind && selection.id === id;

  const renderFields = (fields: GridField[], indent: string) =>
    fields.map((field) => (
      <FieldRow
        key={field.id}
        field={field}
        indent={indent}
        selected={isSelected('field', field.id)}
        onSelect={() => onSelect({kind: 'field', id: field.id})}
        onEdit={() => onEditField(field)}
        onDelete={() => onDeleteField(field)}
        showKeyColumn={showKeyColumn}
        showOptionsColumn={showOptionsColumn}
      />
    ));

  return (
    <table className="w-full table-fixed border-collapse text-xs">
      <thead>
        <tr className="h-[26px] border-b border-border/50 text-[9.5px] uppercase tracking-[0.04em] text-muted-foreground">
          <th className="w-3.5" />
          <th className="px-2 text-left font-semibold">{t('extraction', 'gridColLabel')}</th>
          {showKeyColumn && (
            <th className="px-2 text-left font-semibold">{t('extraction', 'gridColKey')}</th>
          )}
          <th className="w-[110px] px-2 text-left font-semibold">
            {t('extraction', 'gridColType')}
          </th>
          {showOptionsColumn && (
            <th className="px-2 text-left font-semibold">
              {t('extraction', 'gridColOptions')}
            </th>
          )}
          <th className="w-10 px-2 text-left font-semibold">
            {t('extraction', 'gridColRequired')}
          </th>
          <th className="w-[26px] px-2" aria-label={t('extraction', 'gridColAi')} />
          <th className="w-[34px]" aria-label={t('extraction', 'gridRowActions')} />
        </tr>
      </thead>

      {sections.map((section) => {
        const isCollapsed = collapsed.has(section.id);
        const isGroup = section.kind === 'group';
        return (
          <tbody
            key={section.id}
            // A repeating group is ONE bounded block: a single accent rule on
            // its left edge, never interior verticals (mock v3 polish).
            className={cn(
              isGroup &&
                '[&>tr>td:first-child]:border-l-2 [&>tr>td:first-child]:border-l-primary',
            )}
          >
            <SectionHeaderRow
              section={section}
              columnCount={columnCount}
              indent="pl-0"
              collapsed={isCollapsed}
              selected={isSelected('section', section.id)}
              onToggle={() => onToggleCollapse(section.id)}
              onSelect={() => onSelect({kind: 'section', id: section.id})}
              actions={sectionActions}
            />
            {!isCollapsed && (
              <>
                {renderFields(
                  section.fields,
                  isGroup ? INDENT.identityField : INDENT.rootField,
                )}
                {!isFiltering && (
                  <GhostRow
                    columnCount={columnCount}
                    indent={isGroup ? INDENT.identityField : INDENT.rootField}
                    label={t('extraction', 'gridNewField')}
                    onClick={() => sectionActions.onAddField(section.id)}
                    testId={`template-grid-add-field-${section.id}`}
                  />
                )}
                {section.children.map((child) => {
                  const childCollapsed = collapsed.has(child.id);
                  return (
                    <Fragment key={child.id}>
                      <SectionHeaderRow
                        section={child}
                        columnCount={columnCount}
                        indent={INDENT.childHeader}
                        collapsed={childCollapsed}
                        selected={isSelected('section', child.id)}
                        onToggle={() => onToggleCollapse(child.id)}
                        onSelect={() => onSelect({kind: 'section', id: child.id})}
                        actions={sectionActions}
                      />
                      {!childCollapsed && renderFields(child.fields, INDENT.childField)}
                    </Fragment>
                  );
                })}
              </>
            )}
          </tbody>
        );
      })}

      {!isFiltering && (
        <tbody>
          <GhostRow
            columnCount={columnCount}
            indent="pl-2"
            label={t('extraction', 'gridNewSection')}
            onClick={onAddSection}
            testId="template-grid-add-section"
          />
        </tbody>
      )}
    </table>
  );
}
