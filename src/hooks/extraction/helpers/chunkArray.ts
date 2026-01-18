/**
 * Helper para dividir array em chunks
 * 
 * Utilitário reutilizável para dividir arrays em grupos menores.
 * Usado para chunking de extração em batch.
 */

/**
 * Divide um array em chunks de tamanho fixo
 * 
 * @param array - Array a ser dividido
 * @param chunkSize - Tamanho de cada chunk
 * @returns Array de chunks
 * 
 * @example
 * ```ts
 * chunkArray([1, 2, 3, 4, 5], 2) // [[1, 2], [3, 4], [5]]
 * ```
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    throw new Error('chunkSize must be greater than 0');
  }

  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

