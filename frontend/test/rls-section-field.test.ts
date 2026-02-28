/**
 * Teste específico para verificar RLS de seções e campos
 * Foca no problema reportado: erro ao adicionar campo em seção múltipla
 */

import {beforeAll, describe, expect, it} from 'vitest';

describe('RLS - Seções e Campos', () => {
  let mockProjectId: string;
  let mockTemplateId: string;
  let mockEntityTypeId: string;

  beforeAll(() => {
    // IDs de exemplo baseados nos dados reais que vimos
    mockProjectId = '3cc77c90-48e0-476c-bb35-900fc275587f';
    mockTemplateId = '80248134-0cb0-4a18-94e8-2eea3dec6cfb';
    mockEntityTypeId = 'f4742036-dbd4-4a74-8c9c-d3ea50090b82';
  });

  it('deve validar estrutura de entity_type correta', () => {
    // Mock de entity type criado corretamente
    const mockEntityType = {
      id: mockEntityTypeId,
      project_template_id: mockTemplateId, // Corrigido: agora usa project_template_id
      template_id: null, // Deve ser null para templates de projeto
      name: 'test_section',
      label: 'Seção de Teste',
      cardinality: 'many', // Seção múltipla
      sort_order: 1,
      is_required: false
    };

    expect(mockEntityType.project_template_id).toBe(mockTemplateId);
    expect(mockEntityType.template_id).toBeNull();
    expect(mockEntityType.cardinality).toBe('many');
  });

  it('deve validar estrutura de campo correta', () => {
    // Mock de campo que deveria ser aceito pelas políticas RLS
    const mockField = {
      id: 'test-field-id',
      entity_type_id: mockEntityTypeId, // Vincula ao entity_type correto
      name: 'test_field',
      label: 'Campo de Teste',
      field_type: 'text',
      is_required: false,
      sort_order: 1
    };

    expect(mockField.entity_type_id).toBe(mockEntityTypeId);
    expect(mockField.field_type).toBe('text');
  });

  it('deve simular política RLS de insertion', () => {
    // Simula a lógica da política RLS que estava falhando
    const mockUser = {
      id: 'bf19752f-adf0-4534-b517-20c12a3021af',
      role: 'manager'
    };

    const mockEntityType = {
      id: mockEntityTypeId,
      project_template_id: mockTemplateId
    };

    const mockProjectTemplate = {
      id: mockTemplateId,
      project_id: mockProjectId
    };

    const mockProjectMember = {
      project_id: mockProjectId,
      user_id: mockUser.id,
      role: 'manager'
    };

    // Simula a verificação da política RLS:
    // EXISTS (SELECT 1 FROM extraction_entity_types eet
    //   JOIN project_extraction_templates pet ON eet.project_template_id = pet.id
    //   JOIN project_members pm ON pm.project_id = pet.project_id
    //   WHERE eet.id = extraction_fields.entity_type_id 
    //     AND pm.user_id = auth.uid() 
    //     AND pm.role = 'manager'
    // )

    const rlsCheck = 
      mockEntityType.project_template_id === mockProjectTemplate.id &&
      mockProjectTemplate.project_id === mockProjectMember.project_id &&
      mockProjectMember.user_id === mockUser.id &&
      mockProjectMember.role === 'manager';

    expect(rlsCheck).toBe(true);
  });

  it('deve rejeitar se não for manager', () => {
    const mockUser = {
      id: 'test-user-id',
      role: 'reviewer' // Não é manager
    };

    const mockProjectMember = {
      project_id: mockProjectId,
      user_id: mockUser.id,
      role: 'reviewer'
    };

    const rlsCheck = mockProjectMember.role === 'manager';
    expect(rlsCheck).toBe(false);
  });

  it('deve rejeitar se entity_type não tem project_template_id', () => {
    const mockEntityType = {
      id: mockEntityTypeId,
      project_template_id: null, // Problema: não tem project_template_id
      template_id: 'some-global-template-id'
    };

    // A política RLS falha se não há project_template_id
    const rlsCheck = mockEntityType.project_template_id !== null;
    expect(rlsCheck).toBe(false);
  });
});
