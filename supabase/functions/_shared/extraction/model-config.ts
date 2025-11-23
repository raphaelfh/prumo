/**
 * Copyright (c) 2025 Raphael Federicci Haddad.
 * Licensed under the GNU Affero General Public License v3.0 (AGPLv3).
 * Commercial licenses are available upon request.
 */

/**
 * Model Config para Extração
 * 
 * Configuração centralizada de modelos LLM com suporte a limitações específicas.
 * 
 * CARACTERÍSTICAS:
 * - Configuração por modelo (temperature, maxTokens, etc.)
 * - Tratamento de limitações específicas (ex: GPT-5 não aceita temperature customizada)
 * - Validação de modelos suportados
 */

import { ChatOpenAI } from "npm:@langchain/openai@1";

/**
 * Modelos suportados
 */
export type SupportedModel = "gpt-4o-mini" | "gpt-4o" | "gpt-5";

/**
 * Verifica se um modelo é suportado
 */
export function isSupportedModel(model: string): model is SupportedModel {
  return ["gpt-4o-mini", "gpt-4o", "gpt-5"].includes(model);
}

/**
 * Opções de configuração do modelo
 */
export interface ModelConfigOptions {
  temperature?: number;
  maxTokens?: number;
}

/**
 * Obtém configuração do modelo com tratamento de limitações específicas
 * 
 * @param model - Nome do modelo
 * @param apiKey - API key da OpenAI
 * @param options - Opções de configuração (temperature, maxTokens)
 * @returns Configuração do ChatOpenAI
 */
export function getModelConfig(
  model: SupportedModel,
  apiKey: string,
  options: ModelConfigOptions = {},
): ConstructorParameters<typeof ChatOpenAI>[0] {
  const baseConfig: ConstructorParameters<typeof ChatOpenAI>[0] = {
    modelName: model,
    apiKey,
  };

  // GPT-5 tem limitações específicas (ex: não aceita temperature customizada)
  // Ajustar configuração baseado no modelo
  if (model === "gpt-5") {
    // GPT-5: usar configuração padrão (sem temperature customizada)
    return {
      ...baseConfig,
      maxTokens: options.maxTokens || 4096,
      // Não definir temperature para GPT-5
    };
  }

  // Outros modelos: aceitam configuração completa
  return {
    ...baseConfig,
    temperature: options.temperature ?? 0.0,
    maxTokens: options.maxTokens || 4096,
  };
}

