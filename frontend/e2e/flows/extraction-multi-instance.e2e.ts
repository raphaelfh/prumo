import { expect, test } from "@playwright/test";

import { loadE2EEnv, missingEnvKeys } from "../_fixtures/env";
import { recordResource } from "../_fixtures/registry";
import {
  adminInsert,
  adminSelect,
  resolveActiveExtractionTemplateId,
} from "../_fixtures/supabase-admin";

type FieldTypeSpec = {
  name: string;
  label: string;
  fieldType: "text" | "number" | "boolean" | "date" | "select" | "multiselect";
  isRequired?: boolean;
  validationSchema?: Record<string, unknown>;
  allowedValues?: Array<{ value: string; label: string }>;
  unit?: string;
  allowedUnits?: string[];
  allowOther?: boolean;
};

const FIELD_TYPE_SPECS: FieldTypeSpec[] = [
  {
    name: "model_name",
    label: "Model name",
    fieldType: "text",
    isRequired: true,
    validationSchema: { minLength: 1, maxLength: 200 },
  },
  {
    name: "auc_value",
    label: "Discrimination AUC",
    fieldType: "number",
    isRequired: true,
    validationSchema: { minimum: 0, maximum: 1 },
    unit: "ratio",
    allowedUnits: ["ratio", "%"],
  },
  {
    name: "internally_validated",
    label: "Was internally validated?",
    fieldType: "boolean",
  },
  {
    name: "publication_date",
    label: "Publication date",
    fieldType: "date",
  },
  {
    name: "framework",
    label: "Reporting framework",
    fieldType: "select",
    allowedValues: [
      { value: "TRIPOD", label: "TRIPOD" },
      { value: "TRIPOD-AI", label: "TRIPOD-AI" },
      { value: "CHARMS", label: "CHARMS" },
    ],
    allowOther: true,
  },
  {
    name: "outcomes_predicted",
    label: "Outcomes predicted",
    fieldType: "multiselect",
    allowedValues: [
      { value: "mortality", label: "Mortality" },
      { value: "readmission", label: "Readmission" },
      { value: "los", label: "Length of stay" },
    ],
  },
];

test.describe("Extraction multi-instance + all field types", () => {
  test("cardinality=many allows multiple instances per article and cardinality=one blocks the second", async () => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_PROJECT_ID",
      "E2E_ARTICLE_ID",
      "E2E_SUPABASE_URL",
      "E2E_SUPABASE_SERVICE_ROLE_KEY",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const projectId = env.projectId!;
    const articleId = env.articleId!;
    const projectTemplateId = await resolveActiveExtractionTemplateId(projectId);

    // Two fresh entity types: one with cardinality=many, one with cardinality=one.
    // The repeating one carries an `entry_label`: 0069's
    // `ck_extraction_entity_types_noun_on_repeating` refuses a NULL noun on a
    // repeating section, because the UI names its entries with it.
    const [manyEntity, oneEntity] = await adminInsert<{ id: string }>(
      "extraction_entity_types",
      [
        {
          project_template_id: projectTemplateId,
          name: `model_card_many_${Date.now()}`,
          label: "Prediction model (many)",
          cardinality: "many",
          entry_label: "model",
          sort_order: 100,
          is_required: false,
        },
        {
          project_template_id: projectTemplateId,
          name: `study_summary_one_${Date.now()}`,
          label: "Study summary (one)",
          cardinality: "one",
          // Present and NULL, not absent: PostgREST refuses a bulk insert
          // whose objects do not share one key set (PGRST102).
          entry_label: null,
          sort_order: 101,
          is_required: false,
        },
      ]
    );
    recordResource({ kind: "extraction_entity_type", id: manyEntity.id });
    recordResource({ kind: "extraction_entity_type", id: oneEntity.id });

    // Cardinality=many: insert 3 instances for the same article. All should succeed.
    const manyInstances = await adminInsert<{ id: string; label: string }>(
      "extraction_instances",
      [1, 2, 3].map((idx) => ({
        project_id: projectId,
        article_id: articleId,
        template_id: projectTemplateId,
        entity_type_id: manyEntity.id,
        label: `Model #${idx}`,
        sort_order: idx,
        created_by: process.env.E2E_USER_ID!,
        metadata: { variant: idx },
      }))
    );
    expect(manyInstances.length).toBe(3);
    for (const inst of manyInstances) {
      recordResource({ kind: "extraction_instance", id: inst.id });
    }

    // Cardinality=one: the first insert lands, the second is refused.
    //
    // This used to probe the advisory `check_cardinality_one` RPC, which 0069
    // dropped — B2 had already retired its last caller. It also never attempted
    // the second insert, so it asserted the advice rather than the rule. The
    // rule is `trg_enforce_extraction_instance_cardinality`, which raises
    // SQLSTATE 23505 on the write itself, and that is what is asserted here.
    const singletonRow = {
      project_id: projectId,
      article_id: articleId,
      template_id: projectTemplateId,
      entity_type_id: oneEntity.id,
      sort_order: 1,
      created_by: process.env.E2E_USER_ID!,
      metadata: {},
    };

    const [oneInstance] = await adminInsert<{ id: string }>("extraction_instances", [
      { ...singletonRow, label: "Single Study Summary" },
    ]);
    recordResource({ kind: "extraction_instance", id: oneInstance.id });

    await expect(
      adminInsert<{ id: string }>("extraction_instances", [
        { ...singletonRow, label: "Second Study Summary" },
      ]),
      "cardinality=one should refuse a second instance for the same article"
    ).rejects.toThrow(/23505/);

    // Sanity: the article should now have exactly 3 'many' instances and 1 'one'.
    const fetchedMany = await adminSelect<{ id: string; label: string; sort_order: number }>(
      "extraction_instances",
      `article_id=eq.${articleId}&entity_type_id=eq.${manyEntity.id}&select=id,label,sort_order&order=sort_order.asc`
    );
    expect(fetchedMany.length).toBe(3);
    expect(fetchedMany.map((row) => row.label)).toEqual(["Model #1", "Model #2", "Model #3"]);

    const fetchedOne = await adminSelect<{ id: string }>(
      "extraction_instances",
      `article_id=eq.${articleId}&entity_type_id=eq.${oneEntity.id}&select=id`
    );
    expect(fetchedOne.length).toBe(1);
  });

  test("entity type accepts every supported extraction_field_type with metadata round-trip", async () => {
    const env = loadE2EEnv();
    const required = missingEnvKeys([
      "E2E_PROJECT_ID",
      "E2E_SUPABASE_URL",
      "E2E_SUPABASE_SERVICE_ROLE_KEY",
    ]);
    test.skip(required.length > 0, `Missing required env: ${required.join(", ")}`);

    const projectTemplateId = await resolveActiveExtractionTemplateId(env.projectId!);

    // Fresh entity_type to host all field types — a root singleton, so it
    // needs no `entry_label`.
    const [entity] = await adminInsert<{ id: string }>("extraction_entity_types", [
      {
        project_template_id: projectTemplateId,
        name: `field_zoo_${Date.now()}`,
        label: "Field Zoo",
        cardinality: "one",
        sort_order: 200,
        is_required: false,
      },
    ]);
    recordResource({ kind: "extraction_entity_type", id: entity.id });

    const inserted = await adminInsert<{ id: string; name: string; field_type: string }>(
      "extraction_fields",
      FIELD_TYPE_SPECS.map((spec, idx) => ({
        entity_type_id: entity.id,
        name: spec.name,
        label: spec.label,
        field_type: spec.fieldType,
        is_required: spec.isRequired ?? false,
        validation_schema: spec.validationSchema ?? null,
        allowed_values: spec.allowedValues ?? null,
        unit: spec.unit ?? null,
        allowed_units: spec.allowedUnits ?? null,
        sort_order: idx + 1,
        allow_other: spec.allowOther ?? false,
      }))
    );
    expect(inserted.length).toBe(FIELD_TYPE_SPECS.length);
    for (const row of inserted) {
      recordResource({ kind: "extraction_field", id: row.id });
    }

    // Verify each field persisted with the correct type + metadata.
    const persisted = await adminSelect<{
      id: string;
      name: string;
      field_type: string;
      is_required: boolean;
      validation_schema: Record<string, unknown> | null;
      allowed_values: Array<{ value: string }> | null;
      unit: string | null;
      allowed_units: string[] | null;
      allow_other: boolean;
    }>(
      "extraction_fields",
      `entity_type_id=eq.${entity.id}&select=id,name,field_type,is_required,validation_schema,allowed_values,unit,allowed_units,allow_other`
    );
    expect(persisted.length).toBe(FIELD_TYPE_SPECS.length);

    for (const spec of FIELD_TYPE_SPECS) {
      const row = persisted.find((r) => r.name === spec.name);
      expect(row, `field ${spec.name} (${spec.fieldType}) must be persisted`).toBeDefined();
      expect(row!.field_type).toBe(spec.fieldType);
      expect(row!.is_required).toBe(spec.isRequired ?? false);
      expect(row!.allow_other).toBe(spec.allowOther ?? false);
      if (spec.validationSchema) {
        expect(row!.validation_schema).toEqual(spec.validationSchema);
      }
      if (spec.allowedValues) {
        const persistedValues = row!.allowed_values?.map((v) => v.value) ?? [];
        const expectedValues = spec.allowedValues.map((v) => v.value);
        expect(persistedValues).toEqual(expectedValues);
      }
      if (spec.unit) {
        expect(row!.unit).toBe(spec.unit);
      }
      if (spec.allowedUnits) {
        expect(row!.allowed_units).toEqual(spec.allowedUnits);
      }
    }
  });
});
