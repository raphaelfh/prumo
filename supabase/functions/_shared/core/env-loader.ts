/**
 * Environment Variable Loader
 * 
 * Utilitário para carregar variáveis de ambiente de arquivos .env
 * com suporte a múltiplos formatos e caminhos.
 */

/**
 * Carrega uma variável de ambiente do sistema ou de arquivo .env
 * 
 * @param varName - Nome da variável (ex: "OPENAI_API_KEY")
 * @param envPath - Caminho opcional para o arquivo .env (tenta múltiplos caminhos se não especificado)
 * @returns Valor da variável ou undefined se não encontrada
 */
export async function loadEnvVar(
  varName: string,
  envPath?: string,
): Promise<string | undefined> {
  // 1. Primeiro, verificar variável de ambiente do sistema
  const systemValue = Deno.env.get(varName);
  if (systemValue) return systemValue;

  // 2. Tentar carregar do arquivo .env
  const pathsToTry = envPath
    ? [envPath]
    : [
        "../../../.env", // Raiz do projeto (do diretório supabase/functions)
        "../../.env",
        "../.env",
        ".env",
      ];

  for (const path of pathsToTry) {
    try {
      const content = await Deno.readTextFile(path);
      const value = parseEnvFile(content, varName);
      if (value) return value;
    } catch (error) {
      // Continuar tentando outros caminhos
      continue;
    }
  }

  return undefined;
}

/**
 * Parse de arquivo .env e extrai valor de uma variável
 * 
 * Suporta múltiplos formatos:
 * - VAR=value
 * - VAR = value
 * - VAR='value'
 * - VAR="value"
 * - VAR='value' # comentário
 * - VAR="value" # comentário
 * 
 * @param content - Conteúdo do arquivo .env
 * @param varName - Nome da variável a procurar
 * @returns Valor da variável ou undefined
 */
function parseEnvFile(content: string, varName: string): string | undefined {
  const lines = content.split(/\r?\n/); // Suporta \r\n e \n

  for (const line of lines) {
    // Pular comentários e linhas vazias
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Regex melhorado para suportar múltiplos formatos:
    // - VAR=value
    // - VAR = value  
    // - VAR='value'
    // - VAR="value"
    // - VAR='value' # comentário
    // - VAR="value" # comentário
    // - VAR= (valor vazio - retorna string vazia, não undefined)
    // 
    // Escapa caracteres especiais no nome da variável
    const escapedVarName = varName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(
      `^${escapedVarName}\\s*=\\s*(.*?)(?:\\s*#.*)?$`,
      "m",
    );
    const match = trimmed.match(regex);

    if (match) {
      let value = match[1].trim();

      // Remover aspas simples ou duplas (mas preservar conteúdo interno)
      // Suporta: "value", 'value', "value with spaces"
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }

      // Retornar mesmo se vazio (algumas variáveis podem ser vazias intencionalmente)
      return value;
    }
  }

  return undefined;
}

/**
 * Carrega múltiplas variáveis de ambiente
 * 
 * @param varNames - Array de nomes de variáveis
 * @param envPath - Caminho opcional para o arquivo .env
 * @returns Objeto com as variáveis carregadas
 */
export async function loadEnvVars(
  varNames: string[],
  envPath?: string,
): Promise<Record<string, string | undefined>> {
  const result: Record<string, string | undefined> = {};

  // Carregar todas em paralelo para melhor performance
  const promises = varNames.map(async (name) => {
    result[name] = await loadEnvVar(name, envPath);
  });

  await Promise.all(promises);

  return result;
}

/**
 * Configura variável no Deno.env se valor existir
 * 
 * @param name - Nome da variável
 * @param value - Valor da variável
 * @returns true se configurada, false caso contrário
 */
export function setEnvVar(name: string, value: string | undefined): boolean {
  if (value) {
    Deno.env.set(name, value);
    return true;
  }
  return false;
}

