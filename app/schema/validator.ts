import Ajv, { type AnySchema, type ErrorObject, type ValidateFunction } from "ajv";

export type SchemaPlatform = "Kubernetes" | "OpenShift";

type SchemaIndexEntry = {
  resources: Record<string, string>;
};

type SchemaIndex = {
  platforms: Record<SchemaPlatform, Record<string, SchemaIndexEntry>>;
};

export type SchemaValidationResult = {
  status: "valid" | "invalid" | "error";
  errors: string[];
};

const ajv = new Ajv({
  allErrors: true,
  allowUnionTypes: true,
  strict: false,
  validateFormats: false,
});

let schemaIndexPromise: Promise<SchemaIndex> | undefined;
const validatorPromises = new Map<string, Promise<ValidateFunction>>();

function normalizeKubernetesSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeKubernetesSchema);
  if (!value || typeof value !== "object") return value;
  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, normalizeKubernetesSchema(child)]),
  );
  if (
    normalized["x-kubernetes-int-or-string"] === true ||
    normalized.format === "int-or-string"
  ) {
    delete normalized.type;
    delete normalized.format;
    normalized.anyOf = [{ type: "integer" }, { type: "string" }];
  }
  return normalized;
}

async function loadSchemaIndex() {
  if (!schemaIndexPromise) {
    schemaIndexPromise = fetch("/schemas/index.json", { cache: "force-cache" }).then(
      async (response) => {
        if (!response.ok) {
          throw new Error(`Unable to load the schema index (${response.status}).`);
        }
        return response.json() as Promise<SchemaIndex>;
      },
    );
  }
  return schemaIndexPromise;
}

async function loadValidator(platform: SchemaPlatform, version: string, kind: string) {
  const cacheKey = `${platform}/${version}/${kind}`;
  if (!validatorPromises.has(cacheKey)) {
    validatorPromises.set(
      cacheKey,
      (async () => {
        const index = await loadSchemaIndex();
        const schemaUrl = index.platforms[platform]?.[version]?.resources[kind];
        if (!schemaUrl) {
          throw new Error(`No schema is available for ${platform} ${version} ${kind}.`);
        }
        const response = await fetch(schemaUrl, { cache: "force-cache" });
        if (!response.ok) {
          throw new Error(`Unable to load the ${kind} schema (${response.status}).`);
        }
        const schema = normalizeKubernetesSchema(await response.json()) as AnySchema;
        return ajv.compile(schema);
      })(),
    );
  }
  return validatorPromises.get(cacheKey)!;
}

function formatSchemaError(error: ErrorObject) {
  const location = error.instancePath || "resource";
  if (error.keyword === "required" && "missingProperty" in error.params) {
    return `${location} is missing required field ${String(error.params.missingProperty)}.`;
  }
  return `${location} ${error.message ?? "is invalid"}.`;
}

export async function validateResourceSchema(
  platform: SchemaPlatform,
  version: string,
  kind: string,
  resource: unknown,
): Promise<SchemaValidationResult> {
  try {
    const validate = await loadValidator(platform, version, kind);
    if (validate(resource)) return { status: "valid", errors: [] };
    return {
      status: "invalid",
      errors: (validate.errors ?? []).map(formatSchemaError),
    };
  } catch (error) {
    return {
      status: "error",
      errors: [error instanceof Error ? error.message : "Unable to validate against the API schema."],
    };
  }
}
