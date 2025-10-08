/**
 * Utilitário para reparar projetos que foram criados sem instâncias template
 * 
 * Alguns projetos podem ter sido criados antes da correção que cria
 * automaticamente as extraction_instances com is_template=true.
 * Esta função corrige isso retroativamente.
 */

import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export async function repairProjectTemplateInstances(projectId: string, userId: string) {
  try {
    console.log('🔧 Verificando se projeto precisa de reparo:', projectId);

    // 1. Buscar templates do projeto
    const { data: projectTemplates, error: templatesError } = await supabase
      .from('project_extraction_templates')
      .select('id')
      .eq('project_id', projectId)
      .eq('is_active', true);

    if (templatesError) {
      console.error('Erro ao buscar templates:', templatesError);
      return false;
    }

    if (!projectTemplates || projectTemplates.length === 0) {
      console.log('❌ Projeto não tem templates ativos');
      return false;
    }

    for (const template of projectTemplates) {
      // 2. Verificar se já tem instâncias template
      const { data: existingInstances, error: instancesError } = await supabase
        .from('extraction_instances')
        .select('id')
        .eq('project_id', projectId)
        .eq('template_id', template.id)
        .eq('is_template', true);

      if (instancesError) {
        console.error('Erro ao verificar instâncias:', instancesError);
        continue;
      }

      if (existingInstances && existingInstances.length > 0) {
        console.log(`✅ Template ${template.id} já tem ${existingInstances.length} instâncias`);
        continue;
      }

      console.log(`🔧 Reparando template ${template.id}...`);

      // 3. Buscar entity types do template
      const { data: entityTypes, error: entityError } = await supabase
        .from('extraction_entity_types')
        .select('*')
        .eq('template_id', template.id)
        .order('sort_order', { ascending: true });

      if (entityError) {
        console.error('Erro ao buscar entity types:', entityError);
        continue;
      }

      if (!entityTypes || entityTypes.length === 0) {
        console.log(`⚠️ Template ${template.id} não tem entity types`);
        continue;
      }

      // 4. Criar instâncias template para cada entity type
      let createdCount = 0;
      for (const entityType of entityTypes) {
        const { error: createError } = await supabase
          .from('extraction_instances')
          .insert({
            project_id: projectId,
            template_id: template.id,
            entity_type_id: entityType.id,
            label: entityType.label,
            sort_order: entityType.sort_order,
            metadata: {},
            created_by: userId,
            status: 'pending',
            is_template: true,
            article_id: null
          });

        if (createError) {
          console.error(`Erro ao criar instância para ${entityType.label}:`, createError);
        } else {
          console.log(`  ✅ Instância criada: ${entityType.label}`);
          createdCount++;
        }
      }

      console.log(`🎉 Reparo concluído para template ${template.id}: ${createdCount} instâncias criadas`);
    }

    return true;

  } catch (error: any) {
    console.error('Erro durante reparo:', error);
    return false;
  }
}

export async function checkAndRepairProject(projectId: string, userId: string) {
  const success = await repairProjectTemplateInstances(projectId, userId);
  
  if (success) {
    toast.success('Template reparado com sucesso!');
  } else {
    console.log('Nenhum reparo necessário ou falha no reparo');
  }
  
  return success;
}
