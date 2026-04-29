/**
 * Back-compat re-export. The canonical implementation now lives under
 * ``components/hitl/`` so it can be imported from either the Data
 * Extraction header or the Quality Assessment header without coupling
 * to the extraction folder. New code should import from
 * ``@/components/hitl/HeaderAIActions`` directly.
 */
export { HeaderAIActions } from "@/components/hitl/HeaderAIActions";
